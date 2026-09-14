import { createHash } from "node:crypto";

export type ProviderRole = "READ" | "SUBMIT";

export type ProviderHealthSample = {
  providerId: string;
  providerGroup: string;
  region: string;
  role: ProviderRole;
  tipSlot: number;
  latencyMs: number;
  errorRateBps: number;
  observedAt: string;
  healthy: boolean;
};

export type ProviderFailoverPolicy = {
  minimumHealthyReads: number;
  minimumProviderGroups: number;
  maximumTipSkewSlots: number;
  maximumLatencyMs: number;
  maximumErrorRateBps: number;
  maximumSampleAgeMs: number;
  failoverCooldownMs: number;
};

export type ProviderSelectionState = {
  generation: number;
  selectedReadProviderId: string;
  selectedSubmitProviderId: string;
  switchedAt: string;
};

function validateId(value: string, label: string) {
  if (!/^[a-zA-Z0-9:_-]{2,96}$/.test(value)) throw new Error(`Invalid ${label}`);
}

export function providerPolicyRoot(policy: ProviderFailoverPolicy) {
  for (const [label, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid provider policy ${label}`);
  }
  if (policy.minimumHealthyReads < 2) throw new Error("Provider policy requires at least two healthy read providers");
  if (policy.minimumProviderGroups < 2) throw new Error("Provider policy requires at least two provider groups");
  return createHash("sha256").update([
    policy.minimumHealthyReads,
    policy.minimumProviderGroups,
    policy.maximumTipSkewSlots,
    policy.maximumLatencyMs,
    policy.maximumErrorRateBps,
    policy.maximumSampleAgeMs,
    policy.failoverCooldownMs
  ].join("|")).digest("hex");
}

export function evaluateProviderQuorum(samples: ProviderHealthSample[], policy: ProviderFailoverPolicy, nowMs = Date.now()) {
  providerPolicyRoot(policy);
  if (!samples.length) throw new Error("Provider quorum requires health samples");
  const ids = samples.map((sample) => sample.providerId);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate provider health sample");

  const normalized = samples.map((sample) => {
    validateId(sample.providerId, "provider id");
    validateId(sample.providerGroup, "provider group");
    validateId(sample.region, "provider region");
    if (!Number.isInteger(sample.tipSlot) || sample.tipSlot <= 0) throw new Error("Invalid provider tip slot");
    if (!Number.isInteger(sample.latencyMs) || sample.latencyMs < 0) throw new Error("Invalid provider latency");
    if (!Number.isInteger(sample.errorRateBps) || sample.errorRateBps < 0 || sample.errorRateBps > 10_000) throw new Error("Invalid provider error rate");
    const observedAtMs = new Date(sample.observedAt).getTime();
    if (!Number.isFinite(observedAtMs) || observedAtMs > nowMs + 60_000) throw new Error("Invalid provider observation time");
    const fresh = nowMs - observedAtMs <= policy.maximumSampleAgeMs;
    const withinPolicy = sample.latencyMs <= policy.maximumLatencyMs && sample.errorRateBps <= policy.maximumErrorRateBps;
    return { ...sample, observedAtMs, accepted: sample.healthy && fresh && withinPolicy };
  });

  const acceptedReads = normalized.filter((sample) => sample.role === "READ" && sample.accepted);
  if (acceptedReads.length < policy.minimumHealthyReads) throw new Error("Insufficient healthy read providers");
  const readGroups = new Set(acceptedReads.map((sample) => sample.providerGroup));
  if (readGroups.size < policy.minimumProviderGroups) throw new Error("Insufficient independent provider groups");
  const tips = acceptedReads.map((sample) => sample.tipSlot);
  const maxTip = Math.max(...tips);
  const minTip = Math.min(...tips);
  if (maxTip - minTip > policy.maximumTipSkewSlots) throw new Error("Provider tips diverge beyond policy");

  const acceptedSubmit = normalized.filter((sample) => sample.role === "SUBMIT" && sample.accepted);
  if (!acceptedSubmit.length) throw new Error("No healthy submit provider");

  const rank = <T extends ProviderHealthSample & { accepted: boolean }>(items: T[]) => [...items].sort((a, b) => {
    if (b.tipSlot !== a.tipSlot) return b.tipSlot - a.tipSlot;
    if (a.errorRateBps !== b.errorRateBps) return a.errorRateBps - b.errorRateBps;
    if (a.latencyMs !== b.latencyMs) return a.latencyMs - b.latencyMs;
    return a.providerId.localeCompare(b.providerId);
  });

  const selectedRead = rank(acceptedReads)[0];
  const selectedSubmit = rank(acceptedSubmit)[0];
  const evidenceRoot = createHash("sha256").update(normalized.map((sample) => [
    sample.providerId,
    sample.providerGroup,
    sample.region,
    sample.role,
    sample.tipSlot,
    sample.latencyMs,
    sample.errorRateBps,
    sample.accepted ? 1 : 0,
    new Date(sample.observedAtMs).toISOString()
  ].join(":" )).sort().join("|")).digest("hex");

  return {
    quorumHealthy: true,
    selectedReadProviderId: selectedRead.providerId,
    selectedSubmitProviderId: selectedSubmit.providerId,
    healthyReadCount: acceptedReads.length,
    healthyProviderGroups: readGroups.size,
    tipSkewSlots: maxTip - minTip,
    evidenceRoot
  };
}

export function authorizeProviderFailover(input: {
  previous?: ProviderSelectionState;
  next: ProviderSelectionState;
  quorum: ReturnType<typeof evaluateProviderQuorum>;
  policy: ProviderFailoverPolicy;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const next = input.next;
  if (!Number.isInteger(next.generation) || next.generation < 1) throw new Error("Invalid provider selection generation");
  const switchedAt = new Date(next.switchedAt).getTime();
  if (!Number.isFinite(switchedAt) || switchedAt > nowMs + 60_000) throw new Error("Invalid provider switch time");
  if (next.selectedReadProviderId !== input.quorum.selectedReadProviderId || next.selectedSubmitProviderId !== input.quorum.selectedSubmitProviderId) {
    throw new Error("Provider selection does not match quorum result");
  }
  if (input.previous) {
    if (next.generation !== input.previous.generation + 1) throw new Error("Provider selection generation must advance exactly once");
    const previousSwitch = new Date(input.previous.switchedAt).getTime();
    const changed = next.selectedReadProviderId !== input.previous.selectedReadProviderId || next.selectedSubmitProviderId !== input.previous.selectedSubmitProviderId;
    if (!changed) throw new Error("Provider failover must actually change a selected provider");
    if (switchedAt - previousSwitch < input.policy.failoverCooldownMs) throw new Error("Provider failover cooldown not satisfied");
  }
  const digest = createHash("sha256").update([
    next.generation,
    next.selectedReadProviderId,
    next.selectedSubmitProviderId,
    new Date(switchedAt).toISOString(),
    input.quorum.evidenceRoot,
    providerPolicyRoot(input.policy)
  ].join("|")).digest("hex");
  return { authorized: true, digest, generation: next.generation };
}

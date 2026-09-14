import { createHash } from "node:crypto";

export type OracleSourceDefinition = {
  sourceId: string;
  signerId: string;
  providerGroup: string;
  region: string;
  weightBps: number;
};

export type OracleIndependencePolicy = {
  market: string;
  sources: OracleSourceDefinition[];
  minimumIndependentGroups: number;
  minimumQuorumWeightBps: number;
  maximumGroupWeightBps: number;
  maximumSourceWeightBps: number;
  maximumAgeMs: number;
  maximumDeviationBps: number;
};

export type OracleIndependentObservation = {
  sourceId: string;
  price: number;
  timestampMs: number;
  roundId: number;
};

function bps(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1 || value > 10_000) throw new Error(`Invalid ${label}`);
}

export function oracleIndependencePolicyRoot(policy: OracleIndependencePolicy) {
  if (!/^[A-Z0-9:_-]{3,32}$/i.test(policy.market)) throw new Error("Invalid oracle policy market");
  if (!policy.sources.length) throw new Error("Oracle policy requires sources");
  if (!Number.isInteger(policy.minimumIndependentGroups) || policy.minimumIndependentGroups < 2) throw new Error("Oracle policy requires at least two independent groups");
  bps(policy.minimumQuorumWeightBps, "oracle quorum weight");
  bps(policy.maximumGroupWeightBps, "oracle group weight");
  bps(policy.maximumSourceWeightBps, "oracle source weight");
  if (!Number.isInteger(policy.maximumAgeMs) || policy.maximumAgeMs < 1) throw new Error("Invalid oracle age policy");
  bps(policy.maximumDeviationBps, "oracle deviation");

  const sourceIds = new Set<string>();
  const signers = new Set<string>();
  const groupWeight = new Map<string, number>();
  let totalWeight = 0;
  for (const source of policy.sources) {
    if (!source.sourceId.trim() || !source.signerId.trim() || !source.providerGroup.trim() || !source.region.trim()) throw new Error("Oracle source metadata is incomplete");
    if (sourceIds.has(source.sourceId.toLowerCase())) throw new Error("Duplicate oracle source id");
    if (signers.has(source.signerId.toLowerCase())) throw new Error("Oracle signer is reused across sources");
    sourceIds.add(source.sourceId.toLowerCase());
    signers.add(source.signerId.toLowerCase());
    bps(source.weightBps, "oracle source weight");
    if (source.weightBps > policy.maximumSourceWeightBps) throw new Error("Oracle source weight exceeds cap");
    totalWeight += source.weightBps;
    const key = source.providerGroup.toLowerCase();
    groupWeight.set(key, (groupWeight.get(key) ?? 0) + source.weightBps);
  }
  if (totalWeight !== 10_000) throw new Error("Oracle source weights must total 10000 bps");
  if (groupWeight.size < policy.minimumIndependentGroups) throw new Error("Insufficient oracle provider diversity");
  for (const weight of groupWeight.values()) if (weight > policy.maximumGroupWeightBps) throw new Error("Oracle provider group exceeds concentration cap");

  const canonical = policy.sources.map((source) => [
    source.sourceId.toLowerCase(), source.signerId.toLowerCase(), source.providerGroup.toLowerCase(), source.region.toLowerCase(), source.weightBps
  ].join(":")) .sort();
  return createHash("sha256").update([
    policy.market.toUpperCase(), policy.minimumIndependentGroups, policy.minimumQuorumWeightBps,
    policy.maximumGroupWeightBps, policy.maximumSourceWeightBps, policy.maximumAgeMs,
    policy.maximumDeviationBps, ...canonical
  ].join("|")).digest("hex");
}

export function aggregateIndependentOracleRound(input: {
  policy: OracleIndependencePolicy;
  observations: OracleIndependentObservation[];
  expectedRoundId: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const policyRoot = oracleIndependencePolicyRoot(input.policy);
  if (!Number.isInteger(input.expectedRoundId) || input.expectedRoundId < 1) throw new Error("Invalid oracle round id");
  const bySource = new Map(input.policy.sources.map((source) => [source.sourceId.toLowerCase(), source]));
  const seen = new Set<string>();
  const active: Array<{ observation: OracleIndependentObservation; source: OracleSourceDefinition }> = [];

  for (const observation of input.observations) {
    const key = observation.sourceId.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate oracle observation source");
    seen.add(key);
    const source = bySource.get(key);
    if (!source) throw new Error("Observation came from unauthorized oracle source");
    if (observation.roundId !== input.expectedRoundId) throw new Error("Oracle observation round mismatch");
    if (!Number.isFinite(observation.price) || observation.price <= 0) throw new Error("Invalid oracle price");
    if (!Number.isFinite(observation.timestampMs) || observation.timestampMs > nowMs + 60_000) throw new Error("Oracle observation is future-dated");
    if (nowMs - observation.timestampMs > input.policy.maximumAgeMs) throw new Error("Oracle observation is stale");
    active.push({ observation, source });
  }

  const quorumWeight = active.reduce((sum, item) => sum + item.source.weightBps, 0);
  if (quorumWeight < input.policy.minimumQuorumWeightBps) throw new Error("Oracle quorum weight is insufficient");
  const groups = new Set(active.map((item) => item.source.providerGroup.toLowerCase()));
  if (groups.size < input.policy.minimumIndependentGroups) throw new Error("Oracle quorum lacks independent provider groups");

  const sorted = active.slice().sort((a, b) => a.observation.price - b.observation.price);
  const half = quorumWeight / 2;
  let cumulative = 0;
  let median = sorted.at(-1)!.observation.price;
  for (const item of sorted) {
    cumulative += item.source.weightBps;
    if (cumulative >= half) { median = item.observation.price; break; }
  }
  for (const item of active) {
    const deviationBps = Math.abs(item.observation.price - median) / median * 10_000;
    if (deviationBps > input.policy.maximumDeviationBps) throw new Error("Oracle source deviates beyond policy");
  }

  const roundDigest = createHash("sha256").update([
    policyRoot,
    input.expectedRoundId,
    median.toFixed(12),
    ...active.map((item) => `${item.source.sourceId.toLowerCase()}:${item.source.weightBps}:${item.observation.price.toFixed(12)}:${item.observation.timestampMs}`).sort()
  ].join("|")).digest("hex");
  return { verified: true, policyRoot, roundDigest, price: median, quorumWeightBps: quorumWeight, independentGroupCount: groups.size };
}

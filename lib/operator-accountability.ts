import { createHash } from "node:crypto";

export type AccountableRole = "KEEPER" | "SOLVER";
export type OperatorFaultType = "REPLAY" | "STALE_ORACLE" | "LIMIT_VIOLATION" | "UNAUTHORIZED_STATE" | "QUOTE_COMMITMENT_BREACH";
export type FaultSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type OperatorBondState = {
  operatorId: string;
  role: AccountableRole;
  bondedUnits: string;
  strikes: number;
  disabled: boolean;
  cooldownUntil?: string;
};

export type OperatorFaultProof = {
  proofId: string;
  operatorId: string;
  role: AccountableRole;
  fault: OperatorFaultType;
  severity: FaultSeverity;
  eventDigest: string;
  evidenceDigest: string;
  reviewerApprovals: string[];
  slashBps: number;
  provenAt: string;
};

export type AccountabilityPolicy = {
  minimumReviewerQuorum: number;
  minimumRemainingBondUnits: string;
  maximumSlashBps: Record<FaultSeverity, number>;
  cooldownMs: Record<FaultSeverity, number>;
  disableAtStrikes: number;
};

function units(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(value);
}
function d64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

export function applyOperatorFault(input: {
  state: OperatorBondState;
  proof: OperatorFaultProof;
  policy: AccountabilityPolicy;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const { state, proof, policy } = input;
  if (!state.operatorId.trim() || state.operatorId !== proof.operatorId || state.role !== proof.role) throw new Error("Fault proof operator identity mismatch");
  if (!Number.isInteger(state.strikes) || state.strikes < 0) throw new Error("Invalid operator strike count");
  const bonded = units(state.bondedUnits, "Operator bond");
  const minimumRemaining = units(policy.minimumRemainingBondUnits, "Minimum remaining bond");
  if (!Number.isInteger(policy.minimumReviewerQuorum) || policy.minimumReviewerQuorum < 2) throw new Error("Accountability requires multiple reviewers");
  if (!Number.isInteger(policy.disableAtStrikes) || policy.disableAtStrikes < 1) throw new Error("Invalid strike disable threshold");
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(proof.proofId)) throw new Error("Invalid fault proof id");
  d64(proof.eventDigest, "Fault event");
  d64(proof.evidenceDigest, "Fault evidence");
  if (new Set(proof.reviewerApprovals).size !== proof.reviewerApprovals.length || proof.reviewerApprovals.length < policy.minimumReviewerQuorum) {
    throw new Error("Insufficient independent fault reviewers");
  }
  const maximumSlash = policy.maximumSlashBps[proof.severity];
  const cooldownMs = policy.cooldownMs[proof.severity];
  if (!Number.isInteger(maximumSlash) || maximumSlash < 0 || maximumSlash > 10_000) throw new Error("Invalid accountability slash policy");
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) throw new Error("Invalid accountability cooldown policy");
  if (!Number.isInteger(proof.slashBps) || proof.slashBps < 0 || proof.slashBps > maximumSlash) throw new Error("Fault slash exceeds severity cap");
  const provenAt = new Date(proof.provenAt).getTime();
  if (!Number.isFinite(provenAt) || provenAt > nowMs + 60_000) throw new Error("Invalid fault proof time");

  const slashUnits = bonded * BigInt(proof.slashBps) / 10_000n;
  const remainingBond = bonded - slashUnits;
  if (remainingBond < 0n) throw new Error("Fault slash exceeds operator bond");
  const nextStrikes = state.strikes + 1;
  const disabled = remainingBond < minimumRemaining || nextStrikes >= policy.disableAtStrikes || proof.severity === "CRITICAL";
  const cooldownUntil = disabled ? undefined : new Date(provenAt + cooldownMs).toISOString();
  const next: OperatorBondState = {
    operatorId: state.operatorId,
    role: state.role,
    bondedUnits: remainingBond.toString(),
    strikes: nextStrikes,
    disabled,
    cooldownUntil
  };
  const digest = createHash("sha256").update([
    proof.proofId, proof.operatorId, proof.role, proof.fault, proof.severity,
    proof.eventDigest.toLowerCase(), proof.evidenceDigest.toLowerCase(), proof.slashBps,
    ...proof.reviewerApprovals.slice().sort(), new Date(provenAt).toISOString(),
    next.bondedUnits, next.strikes, next.disabled ? 1 : 0, next.cooldownUntil ?? ""
  ].join("|")).digest("hex");
  return { verified: true, digest, slashUnits, next };
}

export function operatorAccountabilityRoot(input: {
  states: OperatorBondState[];
  appliedProofDigests: string[];
}) {
  if (!input.states.length) throw new Error("Accountability root requires operator states");
  const identities = new Set<string>();
  const canonicalStates = input.states.map((state) => {
    const key = `${state.role}:${state.operatorId.toLowerCase()}`;
    if (identities.has(key)) throw new Error("Duplicate accountable operator state");
    identities.add(key);
    units(state.bondedUnits, "Operator bond");
    if (!Number.isInteger(state.strikes) || state.strikes < 0) throw new Error("Invalid operator strikes");
    if (state.cooldownUntil && !Number.isFinite(new Date(state.cooldownUntil).getTime())) throw new Error("Invalid operator cooldown");
    return [key, state.bondedUnits, state.strikes, state.disabled ? 1 : 0, state.cooldownUntil ?? ""].join(":");
  }).sort();
  const proofs = input.appliedProofDigests.map((digest) => d64(digest, "Applied fault proof")).sort();
  if (new Set(proofs).size !== proofs.length) throw new Error("Duplicate fault proof digest");
  return createHash("sha256").update([...canonicalStates, ...proofs].join("|")).digest("hex");
}

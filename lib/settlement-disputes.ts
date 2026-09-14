import { createHash } from "node:crypto";

export type SettlementProduct = "PERPETUAL" | "OPTIONS" | "NOTIONAL";
export type SettlementDisputeStatus = "PENDING" | "CHALLENGED" | "RESOLVED" | "FINALIZED" | "CANCELLED";
export type SettlementDecision = "UPHOLD" | "CANCEL" | "ADJUST";

export type SettlementChallenge = {
  challengerId: string;
  reasonCode: "ORACLE" | "ARITHMETIC" | "LIMIT_VIOLATION" | "DUPLICATE" | "STATE_MISMATCH";
  evidenceDigest: string;
  bondUnits: string;
  submittedAt: string;
};

export type SettlementResolution = {
  decision: SettlementDecision;
  resolverApprovals: string[];
  resolutionEvidenceDigest: string;
  adjustedSettlementDigest?: string;
  resolvedAt: string;
};

export type SettlementDisputeCase = {
  caseId: string;
  product: SettlementProduct;
  market: string;
  settlementDigest: string;
  status: SettlementDisputeStatus;
  openedAt: string;
  challengeDeadline: string;
  challenge?: SettlementChallenge;
  resolution?: SettlementResolution;
  finalizedAt?: string;
};

export type SettlementDisputePolicy = {
  minimumChallengeWindowMs: number;
  minimumChallengeBondUnits: string;
  resolverQuorum: number;
  maximumCaseAgeMs: number;
};

function d64(value: string | undefined, label: string) {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}
function units(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(value);
}
function caseDigest(value: SettlementDisputeCase) {
  return createHash("sha256").update([
    value.caseId, value.product, value.market, value.settlementDigest.toLowerCase(), value.status,
    new Date(value.openedAt).toISOString(), new Date(value.challengeDeadline).toISOString(),
    value.challenge ? [value.challenge.challengerId, value.challenge.reasonCode, value.challenge.evidenceDigest.toLowerCase(), value.challenge.bondUnits, new Date(value.challenge.submittedAt).toISOString()].join(":") : "",
    value.resolution ? [value.resolution.decision, ...value.resolution.resolverApprovals.slice().sort(), value.resolution.resolutionEvidenceDigest.toLowerCase(), value.resolution.adjustedSettlementDigest?.toLowerCase() ?? "", new Date(value.resolution.resolvedAt).toISOString()].join(":") : "",
    value.finalizedAt ? new Date(value.finalizedAt).toISOString() : ""
  ].join("|")).digest("hex");
}

export function validateSettlementDisputeCase(value: SettlementDisputeCase, policy: SettlementDisputePolicy, nowMs = Date.now()) {
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(value.caseId)) throw new Error("Invalid settlement case id");
  if (!value.market.trim()) throw new Error("Settlement market is required");
  d64(value.settlementDigest, "Settlement digest");
  if (!Number.isInteger(policy.minimumChallengeWindowMs) || policy.minimumChallengeWindowMs < 1) throw new Error("Invalid challenge window policy");
  if (!Number.isInteger(policy.resolverQuorum) || policy.resolverQuorum < 2) throw new Error("Settlement resolution requires multiple resolvers");
  if (!Number.isInteger(policy.maximumCaseAgeMs) || policy.maximumCaseAgeMs < policy.minimumChallengeWindowMs) throw new Error("Invalid settlement case age policy");
  const minimumBond = units(policy.minimumChallengeBondUnits, "Minimum challenge bond");
  const openedAt = new Date(value.openedAt).getTime();
  const deadline = new Date(value.challengeDeadline).getTime();
  if (!Number.isFinite(openedAt) || !Number.isFinite(deadline) || deadline - openedAt < policy.minimumChallengeWindowMs) throw new Error("Settlement challenge window is too short");
  if (openedAt > nowMs + 60_000) throw new Error("Settlement case is future-dated");
  if (nowMs - openedAt > policy.maximumCaseAgeMs && !["FINALIZED", "CANCELLED"].includes(value.status)) throw new Error("Unresolved settlement dispute is stale");

  if (value.challenge) {
    const submittedAt = new Date(value.challenge.submittedAt).getTime();
    if (!Number.isFinite(submittedAt) || submittedAt < openedAt || submittedAt > deadline) throw new Error("Settlement challenge is outside challenge window");
    d64(value.challenge.evidenceDigest, "Settlement challenge evidence");
    if (units(value.challenge.bondUnits, "Challenge bond") < minimumBond) throw new Error("Settlement challenge bond is below minimum");
  }
  if (["CHALLENGED", "RESOLVED", "CANCELLED"].includes(value.status) && !value.challenge) throw new Error("Challenged settlement state requires challenge evidence");

  if (value.resolution) {
    if (!value.challenge) throw new Error("Settlement resolution requires a challenge");
    if (new Set(value.resolution.resolverApprovals).size !== value.resolution.resolverApprovals.length) throw new Error("Duplicate settlement resolver approval");
    if (value.resolution.resolverApprovals.length < policy.resolverQuorum) throw new Error("Insufficient settlement resolver quorum");
    d64(value.resolution.resolutionEvidenceDigest, "Settlement resolution evidence");
    const resolvedAt = new Date(value.resolution.resolvedAt).getTime();
    if (!Number.isFinite(resolvedAt) || resolvedAt <= new Date(value.challenge.submittedAt).getTime() || resolvedAt > nowMs + 60_000) throw new Error("Invalid settlement resolution time");
    if (value.resolution.decision === "ADJUST") d64(value.resolution.adjustedSettlementDigest, "Adjusted settlement");
    else if (value.resolution.adjustedSettlementDigest) throw new Error("Only adjusted resolution may replace settlement digest");
  }
  if (["RESOLVED", "CANCELLED"].includes(value.status) && !value.resolution) throw new Error("Resolved settlement state requires resolution evidence");
  if (value.status === "CANCELLED" && value.resolution?.decision !== "CANCEL") throw new Error("Cancelled settlement requires CANCEL decision");

  if (value.status === "FINALIZED") {
    if (!value.finalizedAt) throw new Error("Finalized settlement requires finalization time");
    const finalizedAt = new Date(value.finalizedAt).getTime();
    if (!Number.isFinite(finalizedAt) || finalizedAt < deadline || finalizedAt > nowMs + 60_000) throw new Error("Invalid settlement finalization time");
    if (value.challenge && !value.resolution) throw new Error("Challenged settlement cannot finalize without resolution");
    if (value.resolution?.decision === "CANCEL") throw new Error("Cancelled settlement cannot finalize");
  } else if (value.finalizedAt) throw new Error("Non-final settlement cannot carry finalization time");

  return { verified: true, digest: caseDigest(value), status: value.status };
}

export function settlementDisputeRoot(cases: SettlementDisputeCase[], policy: SettlementDisputePolicy, nowMs = Date.now()) {
  const ids = new Set<string>();
  const settlementDigests = new Set<string>();
  const digests = cases.map((value) => {
    if (ids.has(value.caseId)) throw new Error("Duplicate settlement dispute case id");
    ids.add(value.caseId);
    if (settlementDigests.has(value.settlementDigest.toLowerCase())) throw new Error("Settlement appears in multiple dispute cases");
    settlementDigests.add(value.settlementDigest.toLowerCase());
    return validateSettlementDisputeCase(value, policy, nowMs).digest;
  }).sort();
  if (!digests.length) throw new Error("Settlement dispute root requires cases");
  return createHash("sha256").update(digests.join("|")).digest("hex");
}

import { createHash } from "node:crypto";

export type FailoverRole = "KEEPER" | "SOLVER" | "BUILDER";

export type FailoverCandidate = {
  operatorId: string;
  role: FailoverRole;
  region: string;
  providerGroup: string;
  bondUnits: string;
  strikes: number;
  heartbeatAt: string;
  disabled: boolean;
};

export type OperatorFailoverPolicy = {
  minimumCandidates: number;
  maximumRecommended: number;
  heartbeatStaleMs: number;
  minimumBondUnits: string;
  maximumStrikes: number;
  reviewLeaseSlots: number;
  minimumRegionDiversity: number;
  minimumProviderGroupDiversity: number;
};

export type FailoverReviewRound = {
  reviewId: string;
  role: FailoverRole;
  epoch: number;
  currentSlot: number;
  roundSeed: string;
  operatorRoot: string;
  candidates: FailoverCandidate[];
};

function units(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(value);
}
function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be SHA-256`);
  return value.toLowerCase();
}
function validId(value: string, label: string) {
  if (!/^[a-zA-Z0-9:_-]{2,96}$/.test(value)) throw new Error(`Invalid ${label}`);
}

export function operatorFailoverPolicyRoot(policy: OperatorFailoverPolicy) {
  if (!Number.isInteger(policy.minimumCandidates) || policy.minimumCandidates < 2) throw new Error("Failover review requires at least two candidates");
  if (!Number.isInteger(policy.maximumRecommended) || policy.maximumRecommended < 1 || policy.maximumRecommended > policy.minimumCandidates) throw new Error("Invalid recommendation count");
  if (!Number.isInteger(policy.heartbeatStaleMs) || policy.heartbeatStaleMs < 1) throw new Error("Invalid heartbeat window");
  if (!Number.isInteger(policy.maximumStrikes) || policy.maximumStrikes < 0) throw new Error("Invalid strike threshold");
  if (!Number.isInteger(policy.reviewLeaseSlots) || policy.reviewLeaseSlots < 1) throw new Error("Invalid review lease duration");
  if (!Number.isInteger(policy.minimumRegionDiversity) || policy.minimumRegionDiversity < 1) throw new Error("Invalid region diversity");
  if (!Number.isInteger(policy.minimumProviderGroupDiversity) || policy.minimumProviderGroupDiversity < 1) throw new Error("Invalid provider-group diversity");
  units(policy.minimumBondUnits, "Minimum operator bond");
  return createHash("sha256").update([
    policy.minimumCandidates,
    policy.maximumRecommended,
    policy.heartbeatStaleMs,
    policy.minimumBondUnits,
    policy.maximumStrikes,
    policy.reviewLeaseSlots,
    policy.minimumRegionDiversity,
    policy.minimumProviderGroupDiversity
  ].join("|")).digest("hex");
}

export function buildOperatorFailoverReview(round: FailoverReviewRound, policy: OperatorFailoverPolicy, nowMs = Date.now()) {
  operatorFailoverPolicyRoot(policy);
  validId(round.reviewId, "failover review id");
  if (!Number.isInteger(round.epoch) || round.epoch < 1) throw new Error("Invalid failover review epoch");
  if (!Number.isInteger(round.currentSlot) || round.currentSlot <= 0) throw new Error("Invalid failover review slot");
  const seed = digest64(round.roundSeed, "Review seed");
  const operatorRoot = digest64(round.operatorRoot, "Operator root");
  const ids = round.candidates.map((candidate) => candidate.operatorId);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate failover candidate");

  const eligible = round.candidates.filter((candidate) => {
    validId(candidate.operatorId, "operator id");
    validId(candidate.region, "operator region");
    validId(candidate.providerGroup, "operator provider group");
    if (candidate.role !== round.role || candidate.disabled || candidate.strikes > policy.maximumStrikes) return false;
    if (units(candidate.bondUnits, "Operator bond") < units(policy.minimumBondUnits, "Minimum operator bond")) return false;
    const heartbeatAt = new Date(candidate.heartbeatAt).getTime();
    if (!Number.isFinite(heartbeatAt) || heartbeatAt > nowMs + 60_000 || nowMs - heartbeatAt > policy.heartbeatStaleMs) return false;
    return true;
  });

  if (eligible.length < policy.minimumCandidates) throw new Error("Insufficient eligible failover candidates");
  if (new Set(eligible.map((candidate) => candidate.region)).size < policy.minimumRegionDiversity) throw new Error("Failover region diversity is insufficient");
  if (new Set(eligible.map((candidate) => candidate.providerGroup)).size < policy.minimumProviderGroupDiversity) throw new Error("Failover provider diversity is insufficient");

  const ranked = eligible.map((candidate) => ({
    operatorId: candidate.operatorId,
    rank: createHash("sha256").update([seed, round.epoch, round.role, candidate.operatorId].join("|")).digest("hex")
  })).sort((a, b) => a.rank.localeCompare(b.rank) || a.operatorId.localeCompare(b.operatorId));

  const recommendations = ranked.slice(0, Math.min(policy.maximumRecommended, ranked.length)).map((candidate, index) => ({
    ...candidate,
    priority: index + 1,
    reviewStartSlot: round.currentSlot,
    reviewEndSlot: round.currentSlot + policy.reviewLeaseSlots
  }));

  const root = createHash("sha256").update([
    round.reviewId,
    round.role,
    round.epoch,
    round.currentSlot,
    operatorRoot,
    operatorFailoverPolicyRoot(policy),
    ...recommendations.map((candidate) => `${candidate.priority}:${candidate.operatorId}:${candidate.rank}:${candidate.reviewStartSlot}:${candidate.reviewEndSlot}`)
  ].join("|")).digest("hex");

  return { reviewReady: true, executionAllowed: false as const, root, recommendations, eligibleCount: eligible.length };
}

import { createHash } from "node:crypto";

export type UpgradeRecoveryAction = "ROLLBACK" | "FORWARD_FIX";

export type UpgradeRecoveryPlan = {
  recoveryId: string;
  action: UpgradeRecoveryAction;
  fromEpoch: number;
  toEpoch: number;
  migrationDigest: string;
  migrationFinalityDigest: string;
  preUpgradeStateRoot: string;
  postUpgradeStateRoot: string;
  targetStateRoot: string;
  irreversibleSettlementDigests: string[];
  issueDigest: string;
  reviewerApprovals: string[];
  createdAt: string;
  executeBefore: string;
};

export type UpgradeRecoveryPolicy = {
  minimumReviewerQuorum: number;
  maximumRollbackWindowMs: number;
};

function d64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

export function validateUpgradeRecovery(plan: UpgradeRecoveryPlan, policy: UpgradeRecoveryPolicy, nowMs = Date.now()) {
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(plan.recoveryId)) throw new Error("Invalid upgrade recovery id");
  if (!Number.isInteger(plan.fromEpoch) || !Number.isInteger(plan.toEpoch) || plan.fromEpoch < 1 || plan.toEpoch !== plan.fromEpoch + 1) {
    throw new Error("Upgrade recovery must reference one exact epoch transition");
  }
  if (!Number.isInteger(policy.minimumReviewerQuorum) || policy.minimumReviewerQuorum < 2) throw new Error("Upgrade recovery requires multiple reviewers");
  if (!Number.isInteger(policy.maximumRollbackWindowMs) || policy.maximumRollbackWindowMs < 1) throw new Error("Invalid rollback window policy");
  if (new Set(plan.reviewerApprovals).size !== plan.reviewerApprovals.length || plan.reviewerApprovals.length < policy.minimumReviewerQuorum) {
    throw new Error("Insufficient independent upgrade recovery reviewers");
  }

  const migrationDigest = d64(plan.migrationDigest, "Migration");
  const migrationFinalityDigest = d64(plan.migrationFinalityDigest, "Migration finality");
  const preRoot = d64(plan.preUpgradeStateRoot, "Pre-upgrade state root");
  const postRoot = d64(plan.postUpgradeStateRoot, "Post-upgrade state root");
  const targetRoot = d64(plan.targetStateRoot, "Recovery target state root");
  const issueDigest = d64(plan.issueDigest, "Upgrade issue");
  if (preRoot === postRoot) throw new Error("Upgrade recovery requires a real state transition");

  const settlements = plan.irreversibleSettlementDigests.map((digest) => d64(digest, "Irreversible settlement"));
  if (new Set(settlements).size !== settlements.length) throw new Error("Duplicate irreversible settlement digest");

  const createdAt = new Date(plan.createdAt).getTime();
  const executeBefore = new Date(plan.executeBefore).getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(executeBefore) || executeBefore <= createdAt) throw new Error("Invalid upgrade recovery window");
  if (createdAt > nowMs + 60_000 || nowMs > executeBefore) throw new Error("Upgrade recovery plan is outside its execution window");

  if (plan.action === "ROLLBACK") {
    if (settlements.length) throw new Error("Rollback is forbidden after irreversible settlements; use forward-fix recovery");
    if (executeBefore - createdAt > policy.maximumRollbackWindowMs) throw new Error("Rollback window exceeds recovery policy");
    if (targetRoot !== preRoot) throw new Error("Rollback target must exactly reproduce the pre-upgrade state root");
  } else {
    if (!settlements.length) throw new Error("Forward-fix recovery requires evidence of irreversible post-upgrade settlement");
    if (targetRoot === postRoot) throw new Error("Forward-fix target must change the faulty post-upgrade state root");
  }

  const root = createHash("sha256").update([
    plan.recoveryId,
    plan.action,
    plan.fromEpoch,
    plan.toEpoch,
    migrationDigest,
    migrationFinalityDigest,
    preRoot,
    postRoot,
    targetRoot,
    ...settlements.slice().sort(),
    issueDigest,
    ...plan.reviewerApprovals.slice().sort(),
    new Date(createdAt).toISOString(),
    new Date(executeBefore).toISOString()
  ].join("|")).digest("hex");

  return { verified: true, root, action: plan.action, irreversibleSettlementCount: settlements.length };
}

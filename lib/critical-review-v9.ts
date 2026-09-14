import { createHash } from "node:crypto";
import { validateRegistryCriticalState, type RegistryCriticalState } from "./registry-critical-state";
import { validateReviewTransparencyLog, type ReviewTransparencyEntry, type ReviewTransparencyPolicy } from "./review-transparency";
import { verifyProtocolRecovery, type ProtocolRecoveryBundle, type RecoveryPolicy } from "./state-recovery";
import { validateProtocolEconomics, type ProtocolEconomicsSnapshot } from "./protocol-economics";
import { oracleIndependencePolicyRoot, type OracleIndependencePolicy } from "./oracle-independence";
import { settlementDisputeRoot, type SettlementDisputeCase, type SettlementDisputePolicy } from "./settlement-disputes";
import { operatorAccountabilityRoot, type OperatorBondState } from "./operator-accountability";
import { buildGlobalInvariantSnapshot, type GlobalInvariantSnapshot } from "./global-invariants";
import { validateUpgradeRecovery, type UpgradeRecoveryPlan, type UpgradeRecoveryPolicy } from "./upgrade-recovery";

export type V9CriticalReviewBundle = {
  previousCriticalReviewDigest: string;
  registry: RegistryCriticalState;
  transparencyEntries: ReviewTransparencyEntry[];
  recovery: ProtocolRecoveryBundle;
  economics: ProtocolEconomicsSnapshot;
  oraclePolicy: OracleIndependencePolicy;
  settlementCases: SettlementDisputeCase[];
  settlementPolicy: SettlementDisputePolicy;
  accountableOperators: OperatorBondState[];
  appliedFaultProofDigests: string[];
  invariants: GlobalInvariantSnapshot;
  upgradeRecovery: UpgradeRecoveryPlan;
  reviewerApprovals: string[];
  issuedAt: string;
  expiresAt: string;
};

export type V9CriticalReviewPolicy = {
  minimumReviewers: number;
  transparencyPolicy: ReviewTransparencyPolicy;
  recoveryPolicy: RecoveryPolicy;
  upgradeRecoveryPolicy: UpgradeRecoveryPolicy;
};

function d64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

export function buildV9CriticalReviewCertificate(input: {
  bundle: V9CriticalReviewBundle;
  policy: V9CriticalReviewPolicy;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const b = input.bundle;
  const previousCriticalReviewDigest = d64(b.previousCriticalReviewDigest, "Previous critical review");
  const registry = validateRegistryCriticalState(b.registry);
  if (registry.paused) throw new Error("V9 review cannot pass while Registry is paused");

  const transparency = validateReviewTransparencyLog(b.transparencyEntries, input.policy.transparencyPolicy, nowMs);
  const latestActive = [...b.transparencyEntries].reverse().find((entry) => entry.status === "ACTIVE");
  if (!latestActive || latestActive.certificateDigest.toLowerCase() !== previousCriticalReviewDigest) {
    throw new Error("Previous critical review is not the latest active transparency entry");
  }
  if (transparency.root !== registry.reviewRoot) throw new Error("Registry review root mismatch");

  const recovery = verifyProtocolRecovery(b.recovery, input.policy.recoveryPolicy, nowMs);
  if (recovery.root !== registry.recoveryRoot) throw new Error("Registry recovery root mismatch");
  if (recovery.stateRoot !== registry.stateRoot) throw new Error("Recovery snapshot does not reproduce Registry state root");

  const economics = validateProtocolEconomics(b.economics, nowMs);
  if (economics.root !== registry.economicsRoot) throw new Error("Registry economics root mismatch");
  if (b.economics.epoch !== registry.deploymentEpoch) throw new Error("Economics epoch does not match Registry epoch");

  const oraclePolicyRoot = oracleIndependencePolicyRoot(b.oraclePolicy);
  if (oraclePolicyRoot !== registry.oraclePolicyRoot) throw new Error("Registry oracle policy root mismatch");

  const disputeRoot = settlementDisputeRoot(b.settlementCases, b.settlementPolicy, nowMs);
  if (disputeRoot !== registry.disputeRoot) throw new Error("Registry dispute root mismatch");

  const accountabilityRoot = operatorAccountabilityRoot({ states: b.accountableOperators, appliedProofDigests: b.appliedFaultProofDigests });
  if (accountabilityRoot !== registry.accountabilityRoot) throw new Error("Registry accountability root mismatch");

  const invariants = buildGlobalInvariantSnapshot(b.invariants, nowMs);
  if (invariants.root !== registry.invariantRoot) throw new Error("Registry invariant root mismatch");
  if (invariants.stateRoot !== registry.stateRoot) throw new Error("Global invariant state root mismatch");
  if (invariants.economicsRoot !== registry.economicsRoot) throw new Error("Global invariant economics root mismatch");
  if (invariants.oraclePolicyRoot !== registry.oraclePolicyRoot) throw new Error("Global invariant oracle policy root mismatch");
  if (invariants.disputeRoot !== registry.disputeRoot) throw new Error("Global invariant dispute root mismatch");
  if (invariants.accountabilityRoot !== registry.accountabilityRoot) throw new Error("Global invariant accountability root mismatch");

  const upgradeRecovery = validateUpgradeRecovery(b.upgradeRecovery, input.policy.upgradeRecoveryPolicy, nowMs);
  if (upgradeRecovery.root !== registry.upgradeRecoveryRoot) throw new Error("Registry upgrade recovery root mismatch");
  if (b.upgradeRecovery.toEpoch !== registry.deploymentEpoch) throw new Error("Upgrade recovery plan does not target Registry epoch");

  if (!Number.isInteger(input.policy.minimumReviewers) || input.policy.minimumReviewers < 3) throw new Error("V9 critical review requires at least three reviewers");
  if (new Set(b.reviewerApprovals).size !== b.reviewerApprovals.length || b.reviewerApprovals.length < input.policy.minimumReviewers) {
    throw new Error("Insufficient independent V9 review approvals");
  }
  const issuedAt = new Date(b.issuedAt).getTime();
  const expiresAt = new Date(b.expiresAt).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || issuedAt > nowMs + 60_000 || nowMs > expiresAt) {
    throw new Error("V9 review certificate window is invalid");
  }

  const digest = createHash("sha256").update([
    previousCriticalReviewDigest,
    registry.digest,
    transparency.root,
    recovery.root,
    economics.root,
    oraclePolicyRoot,
    disputeRoot,
    accountabilityRoot,
    invariants.root,
    upgradeRecovery.root,
    ...b.reviewerApprovals.slice().sort(),
    new Date(issuedAt).toISOString(),
    new Date(expiresAt).toISOString()
  ].join("|")).digest("hex");

  return {
    reviewReady: true,
    activationAllowed: false as const,
    version: "V9" as const,
    digest,
    registryDigest: registry.digest,
    invariantRoot: invariants.root,
    surplusUnits: invariants.surplusUnits,
    independentRecoveryCopies: recovery.independentCopyCount,
    reviewLogEntries: transparency.entryCount
  };
}

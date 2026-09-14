import assert from "node:assert/strict";
import test from "node:test";
import { buildProtocolStateRoot } from "../lib/protocol-state-root";
import { reviewTransparencyEntryDigest, validateReviewTransparencyLog } from "../lib/review-transparency";
import { verifyProtocolRecovery } from "../lib/state-recovery";
import { validateProtocolEconomics } from "../lib/protocol-economics";
import { oracleIndependencePolicyRoot } from "../lib/oracle-independence";
import { settlementDisputeRoot } from "../lib/settlement-disputes";
import { operatorAccountabilityRoot } from "../lib/operator-accountability";
import { buildGlobalInvariantSnapshot } from "../lib/global-invariants";
import { validateUpgradeRecovery } from "../lib/upgrade-recovery";
import { buildV9CriticalReviewCertificate } from "../lib/critical-review-v9";

const NOW = new Date("2026-09-14T12:00:00.000Z").getTime();
const h = (c: string) => c.repeat(64);

test("milestone 74 V9 recomputes every critical root and remains review-only", () => {
  const checkpoint = {
    deploymentEpoch: 3, registryNonce: 12, oracleRound: 21, fundingRound: 20,
    leaves: [{ product: "COLLATERAL" as const, stateId: "acct-v9-1", utxoRef: `${"a".repeat(64)}#0`, ownerOrMarket: "account-a", nonce: 4, valueDigest: h("b") }],
    accounting: { custodyUnits: "10000", insuranceUnits: "1130", userEquityLiabilityUnits: "5000", pendingWithdrawalUnits: "500", badDebtUnits: "0", lockedPerpMarginUnits: "2000", lockedOptionCollateralUnits: "1000", optionPayoutLiabilityUnits: "500", notionalEscrowUnits: "500" },
    generatedAt: new Date(NOW - 120_000).toISOString()
  };
  const stateRoot = buildProtocolStateRoot(checkpoint).root;
  const previousCertificate = h("1");
  const firstEntry = { logId: "review-log-v9", sequence: 1, certificateDigest: previousCertificate, reviewerIds: ["r1","r2","r3"], issuedAt: new Date(NOW - 300_000).toISOString(), status: "ACTIVE" as const };
  assert.match(reviewTransparencyEntryDigest(firstEntry), /^[0-9a-f]{64}$/);
  const transparencyEntries = [firstEntry];
  const transparencyPolicy = { minimumIndependentReviewers: 3, maximumEntryAgeMs: 3_600_000 };
  const reviewRoot = validateReviewTransparencyLog(transparencyEntries, transparencyPolicy, NOW).root;

  const recovery = {
    recoveryId: "recovery-v9-epoch3", sourceCheckpoint: checkpoint, sourceFinalityDigest: h("2"), recoveredLeaves: checkpoint.leaves.map((leaf) => ({ ...leaf })),
    storageCopies: [
      { provider: "backup-a", region: "eu-west", snapshotSha256: h("3"), verifiedAt: new Date(NOW - 60_000).toISOString() },
      { provider: "backup-b", region: "us-east", snapshotSha256: h("3"), verifiedAt: new Date(NOW - 50_000).toISOString() }
    ], createdAt: new Date(NOW - 90_000).toISOString()
  };
  const recoveryPolicy = { minimumIndependentCopies: 2, maximumSnapshotAgeMs: 3_600_000 };
  const recoveryRoot = verifyProtocolRecovery(recovery, recoveryPolicy, NOW).root;

  const economics = {
    epoch: 3, collateralAsset: "USDM", insuranceOpeningUnits: "1000", insuranceClosingUnits: "1130", minimumInsuranceFloorUnits: "500",
    feeFlows: [{ id: "fee-v9-0001", source: "PERP_TRADE" as const, market: "BTC-USD", grossFeeUnits: "100", insuranceUnits: "50", treasuryUnits: "30", makerRebateUnits: "10", operatorUnits: "10", createdAt: new Date(NOW - 30_000).toISOString() }],
    insuranceMovements: [
      { id: "insurance-v9-in", kind: "CONTRIBUTION" as const, amountUnits: "100", reasonDigest: h("4"), createdAt: new Date(NOW - 20_000).toISOString() },
      { id: "insurance-v9-out", kind: "CLAIM" as const, amountUnits: "20", reasonDigest: h("5"), createdAt: new Date(NOW - 10_000).toISOString() }
    ], generatedAt: new Date(NOW - 5_000).toISOString()
  };
  const economicsRoot = validateProtocolEconomics(economics, NOW).root;

  const oraclePolicy = {
    market: "BTC-USD", minimumIndependentGroups: 3, minimumQuorumWeightBps: 7500, maximumGroupWeightBps: 4000, maximumSourceWeightBps: 3000, maximumAgeMs: 30_000, maximumDeviationBps: 100,
    sources: [
      { sourceId: "a", signerId: "sign-a", providerGroup: "provider-a", region: "eu", weightBps: 2500 }, { sourceId: "b", signerId: "sign-b", providerGroup: "provider-b", region: "us", weightBps: 2500 },
      { sourceId: "c", signerId: "sign-c", providerGroup: "provider-c", region: "ap", weightBps: 2500 }, { sourceId: "d", signerId: "sign-d", providerGroup: "provider-d", region: "eu", weightBps: 2500 }
    ]
  };
  const oraclePolicyRoot = oracleIndependencePolicyRoot(oraclePolicy);

  const settlementPolicy = { minimumChallengeWindowMs: 60_000, minimumChallengeBondUnits: "100", resolverQuorum: 2, maximumCaseAgeMs: 3_600_000 };
  const settlementCases = [{ caseId: "settlement-v9-01", product: "OPTIONS" as const, market: "BTC-USD", settlementDigest: h("6"), status: "FINALIZED" as const, openedAt: new Date(NOW - 180_000).toISOString(), challengeDeadline: new Date(NOW - 120_000).toISOString(), finalizedAt: new Date(NOW - 60_000).toISOString() }];
  const disputeRoot = settlementDisputeRoot(settlementCases, settlementPolicy, NOW);

  const accountableOperators = [{ operatorId: "keeper-a", role: "KEEPER" as const, bondedUnits: "9000", strikes: 1, disabled: false }, { operatorId: "solver-a", role: "SOLVER" as const, bondedUnits: "8000", strikes: 0, disabled: false }];
  const appliedFaultProofDigests = [h("7")];
  const accountabilityRoot = operatorAccountabilityRoot({ states: accountableOperators, appliedProofDigests: appliedFaultProofDigests });

  const invariantsInput = { checkpoint, economics, oraclePolicy, settlementCases, disputePolicy: settlementPolicy, accountableOperators, appliedFaultProofDigests, generatedAt: new Date(NOW - 1_000).toISOString() };
  const invariantRoot = buildGlobalInvariantSnapshot(invariantsInput, NOW).root;

  const upgradeRecovery = { recoveryId: "upgrade-v9-epoch3", action: "ROLLBACK" as const, fromEpoch: 2, toEpoch: 3, migrationDigest: h("8"), migrationFinalityDigest: h("9"), preUpgradeStateRoot: h("a"), postUpgradeStateRoot: h("c"), targetStateRoot: h("a"), irreversibleSettlementDigests: [], issueDigest: h("d"), reviewerApprovals: ["r1","r2"], createdAt: new Date(NOW - 60_000).toISOString(), executeBefore: new Date(NOW + 600_000).toISOString() };
  const upgradeRecoveryPolicy = { minimumReviewerQuorum: 2, maximumRollbackWindowMs: 3_600_000 };
  const upgradeRecoveryRoot = validateUpgradeRecovery(upgradeRecovery, upgradeRecoveryPolicy, NOW).root;

  const registry = {
    deploymentEpoch: 3, registryNonce: 12, stateRoot, riskRoot: h("e"), operatorRoot: h("f"), settlementRoot: h("0"), migrationRoot: h("1"),
    reviewRoot, recoveryRoot, economicsRoot, oraclePolicyRoot, disputeRoot, accountabilityRoot, invariantRoot, upgradeRecoveryRoot,
    oracleRound: 21, fundingRound: 20, paused: false
  };
  const bundle = { previousCriticalReviewDigest: previousCertificate, registry, transparencyEntries, recovery, economics, oraclePolicy, settlementCases, settlementPolicy, accountableOperators, appliedFaultProofDigests, invariants: invariantsInput, upgradeRecovery, reviewerApprovals: ["reviewer-1","reviewer-2","reviewer-3"], issuedAt: new Date(NOW - 500).toISOString(), expiresAt: new Date(NOW + 3_600_000).toISOString() };
  const policy = { minimumReviewers: 3, transparencyPolicy, recoveryPolicy, upgradeRecoveryPolicy };
  const result = buildV9CriticalReviewCertificate({ bundle, policy, nowMs: NOW });
  assert.equal(result.reviewReady, true);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.version, "V9");
  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.throws(() => buildV9CriticalReviewCertificate({ bundle: { ...bundle, registry: { ...registry, economicsRoot: h("2") } }, policy, nowMs: NOW }), /economics root mismatch/);
});

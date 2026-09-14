import assert from "node:assert/strict";
import test from "node:test";
import { applyOperatorFault, operatorAccountabilityRoot } from "../lib/operator-accountability";
import { buildGlobalInvariantSnapshot } from "../lib/global-invariants";
import { validateUpgradeRecovery } from "../lib/upgrade-recovery";

const NOW = new Date("2026-09-14T12:00:00.000Z").getTime();
const h = (c: string) => c.repeat(64);

const checkpoint = {
  deploymentEpoch: 3, registryNonce: 12, oracleRound: 21, fundingRound: 20,
  leaves: [{ product: "COLLATERAL" as const, stateId: "acct-invariant-1", utxoRef: `${"a".repeat(64)}#0`, ownerOrMarket: "account-a", nonce: 4, valueDigest: h("b") }],
  accounting: { custodyUnits: "10000", insuranceUnits: "1130", userEquityLiabilityUnits: "5000", pendingWithdrawalUnits: "500", badDebtUnits: "0", lockedPerpMarginUnits: "2000", lockedOptionCollateralUnits: "1000", optionPayoutLiabilityUnits: "500", notionalEscrowUnits: "500" },
  generatedAt: new Date(NOW - 120_000).toISOString()
};
const economics = {
  epoch: 3, collateralAsset: "USDM", insuranceOpeningUnits: "1000", insuranceClosingUnits: "1130", minimumInsuranceFloorUnits: "500",
  feeFlows: [{ id: "fee-perp-0001", source: "PERP_TRADE" as const, market: "BTC-USD", grossFeeUnits: "100", insuranceUnits: "50", treasuryUnits: "30", makerRebateUnits: "10", operatorUnits: "10", createdAt: new Date(NOW - 30_000).toISOString() }],
  insuranceMovements: [
    { id: "insurance-contrib-1", kind: "CONTRIBUTION" as const, amountUnits: "100", reasonDigest: h("6"), createdAt: new Date(NOW - 20_000).toISOString() },
    { id: "insurance-claim-01", kind: "CLAIM" as const, amountUnits: "20", reasonDigest: h("7"), createdAt: new Date(NOW - 10_000).toISOString() }
  ], generatedAt: new Date(NOW - 5_000).toISOString()
};
const oraclePolicy = {
  market: "BTC-USD", minimumIndependentGroups: 3, minimumQuorumWeightBps: 7500, maximumGroupWeightBps: 4000, maximumSourceWeightBps: 3000, maximumAgeMs: 30_000, maximumDeviationBps: 100,
  sources: [
    { sourceId: "a", signerId: "sign-a", providerGroup: "provider-a", region: "eu", weightBps: 2500 },
    { sourceId: "b", signerId: "sign-b", providerGroup: "provider-b", region: "us", weightBps: 2500 },
    { sourceId: "c", signerId: "sign-c", providerGroup: "provider-c", region: "ap", weightBps: 2500 },
    { sourceId: "d", signerId: "sign-d", providerGroup: "provider-d", region: "eu", weightBps: 2500 }
  ]
};
const disputePolicy = { minimumChallengeWindowMs: 60_000, minimumChallengeBondUnits: "100", resolverQuorum: 2, maximumCaseAgeMs: 3_600_000 };
const settlementCases = [{ caseId: "settlement-case-01", product: "OPTIONS" as const, market: "BTC-USD", settlementDigest: h("8"), status: "FINALIZED" as const, openedAt: new Date(NOW - 180_000).toISOString(), challengeDeadline: new Date(NOW - 120_000).toISOString(), finalizedAt: new Date(NOW - 60_000).toISOString() }];

test("milestone 71 operator fault proof produces bounded slash and cooldown state", () => {
  const state = { operatorId: "keeper-a", role: "KEEPER" as const, bondedUnits: "10000", strikes: 0, disabled: false };
  const proof = { proofId: "fault-proof-0001", operatorId: "keeper-a", role: "KEEPER" as const, fault: "STALE_ORACLE" as const, severity: "HIGH" as const, eventDigest: h("1"), evidenceDigest: h("2"), reviewerApprovals: ["reviewer-a", "reviewer-b"], slashBps: 1000, provenAt: new Date(NOW - 10_000).toISOString() };
  const policy = { minimumReviewerQuorum: 2, minimumRemainingBondUnits: "1000", maximumSlashBps: { LOW: 100, MEDIUM: 500, HIGH: 3000, CRITICAL: 10000 }, cooldownMs: { LOW: 60_000, MEDIUM: 300_000, HIGH: 900_000, CRITICAL: 86_400_000 }, disableAtStrikes: 3 };
  const result = applyOperatorFault({ state, proof, policy, nowMs: NOW });
  assert.equal(result.slashUnits, 1000n);
  assert.equal(result.next.bondedUnits, "9000");
  assert.match(operatorAccountabilityRoot({ states: [result.next, { operatorId: "solver-a", role: "SOLVER", bondedUnits: "8000", strikes: 0, disabled: false }], appliedProofDigests: [result.digest] }), /^[0-9a-f]{64}$/);
  assert.throws(() => applyOperatorFault({ state, proof: { ...proof, slashBps: 4000 }, policy, nowMs: NOW }), /exceeds severity cap/);
});

test("milestone 72 global invariant root reconciles economics and protocol state", () => {
  const result = buildGlobalInvariantSnapshot({ checkpoint, economics, oraclePolicy, settlementCases, disputePolicy, accountableOperators: [{ operatorId: "keeper-a", role: "KEEPER", bondedUnits: "9000", strikes: 1, disabled: false }], appliedFaultProofDigests: [h("3")], generatedAt: new Date(NOW - 1_000).toISOString() }, NOW);
  assert.equal(result.surplusUnits, 4630n);
  assert.match(result.root, /^[0-9a-f]{64}$/);
  assert.throws(() => buildGlobalInvariantSnapshot({ checkpoint, economics: { ...economics, insuranceClosingUnits: "1129" }, oraclePolicy, settlementCases, disputePolicy, accountableOperators: [{ operatorId: "keeper-a", role: "KEEPER", bondedUnits: "9000", strikes: 1, disabled: false }], appliedFaultProofDigests: [h("3")], generatedAt: new Date(NOW - 1_000).toISOString() }, NOW), /does not reconcile|does not match/);
});

test("milestone 73 rollback is forbidden after irreversible post-upgrade settlement", () => {
  const policy = { minimumReviewerQuorum: 2, maximumRollbackWindowMs: 3_600_000 };
  const rollback = { recoveryId: "upgrade-recovery-3", action: "ROLLBACK" as const, fromEpoch: 2, toEpoch: 3, migrationDigest: h("4"), migrationFinalityDigest: h("5"), preUpgradeStateRoot: h("6"), postUpgradeStateRoot: h("7"), targetStateRoot: h("6"), irreversibleSettlementDigests: [], issueDigest: h("8"), reviewerApprovals: ["reviewer-a", "reviewer-b"], createdAt: new Date(NOW - 60_000).toISOString(), executeBefore: new Date(NOW + 600_000).toISOString() };
  assert.equal(validateUpgradeRecovery(rollback, policy, NOW).action, "ROLLBACK");
  assert.throws(() => validateUpgradeRecovery({ ...rollback, irreversibleSettlementDigests: [h("9")] }, policy, NOW), /forbidden after irreversible settlements/);
  const forwardFix = { ...rollback, action: "FORWARD_FIX" as const, targetStateRoot: h("a"), irreversibleSettlementDigests: [h("9")] };
  assert.equal(validateUpgradeRecovery(forwardFix, policy, NOW).action, "FORWARD_FIX");
});

import assert from "node:assert/strict";
import test from "node:test";
import { reviewTransparencyEntryDigest, validateReviewTransparencyLog } from "../lib/review-transparency";
import { verifyProtocolRecovery } from "../lib/state-recovery";
import { validateProtocolEconomics } from "../lib/protocol-economics";
import { aggregateIndependentOracleRound, oracleIndependencePolicyRoot } from "../lib/oracle-independence";
import { settlementDisputeRoot, validateSettlementDisputeCase } from "../lib/settlement-disputes";

const NOW = new Date("2026-09-14T12:00:00.000Z").getTime();
const h = (c: string) => c.repeat(64);

const checkpoint = {
  deploymentEpoch: 3, registryNonce: 12, oracleRound: 21, fundingRound: 20,
  leaves: [{ product: "COLLATERAL" as const, stateId: "acct-restore-1", utxoRef: `${"a".repeat(64)}#0`, ownerOrMarket: "account-a", nonce: 4, valueDigest: h("b") }],
  accounting: { custodyUnits: "10000", insuranceUnits: "1130", userEquityLiabilityUnits: "5000", pendingWithdrawalUnits: "500", badDebtUnits: "0", lockedPerpMarginUnits: "2000", lockedOptionCollateralUnits: "1000", optionPayoutLiabilityUnits: "500", notionalEscrowUnits: "500" },
  generatedAt: new Date(NOW - 120_000).toISOString()
};

test("milestone 66 review transparency is append-only and predecessor-bound", () => {
  const first = { logId: "review-log-v9", sequence: 1, certificateDigest: h("1"), reviewerIds: ["r1","r2","r3"], issuedAt: new Date(NOW - 300_000).toISOString(), status: "ACTIVE" as const };
  const second = { logId: "review-log-v9", sequence: 2, certificateDigest: h("2"), previousEntryDigest: reviewTransparencyEntryDigest(first), reviewerIds: ["r1","r2","r4"], issuedAt: new Date(NOW - 240_000).toISOString(), status: "ACTIVE" as const };
  const result = validateReviewTransparencyLog([first, second], { minimumIndependentReviewers: 3, maximumEntryAgeMs: 3_600_000 }, NOW);
  assert.equal(result.latestSequence, 2);
  assert.match(result.root, /^[0-9a-f]{64}$/);
  assert.throws(() => validateReviewTransparencyLog([first, { ...second, certificateDigest: first.certificateDigest }], { minimumIndependentReviewers: 3, maximumEntryAgeMs: 3_600_000 }, NOW), /duplicated/);
});

test("milestone 67 recovery reproduces the exact canonical UTxO state root", () => {
  const bundle = {
    recoveryId: "recovery-snapshot-3", sourceCheckpoint: checkpoint, sourceFinalityDigest: h("3"), recoveredLeaves: checkpoint.leaves.map((leaf) => ({ ...leaf })),
    storageCopies: [
      { provider: "backup-a", region: "eu-west", snapshotSha256: h("4"), verifiedAt: new Date(NOW - 60_000).toISOString() },
      { provider: "backup-b", region: "us-east", snapshotSha256: h("4"), verifiedAt: new Date(NOW - 50_000).toISOString() }
    ], createdAt: new Date(NOW - 90_000).toISOString()
  };
  const result = verifyProtocolRecovery(bundle, { minimumIndependentCopies: 2, maximumSnapshotAgeMs: 3_600_000 }, NOW);
  assert.equal(result.recoveredLeafCount, 1);
  const altered = { ...bundle, recoveredLeaves: [{ ...checkpoint.leaves[0], valueDigest: h("5") }] };
  assert.throws(() => verifyProtocolRecovery(altered, { minimumIndependentCopies: 2, maximumSnapshotAgeMs: 3_600_000 }, NOW), /does not exactly reproduce/);
});

test("milestone 68 every fee and insurance unit conserves exactly", () => {
  const snapshot = {
    epoch: 3, collateralAsset: "USDM", insuranceOpeningUnits: "1000", insuranceClosingUnits: "1130", minimumInsuranceFloorUnits: "500",
    feeFlows: [{ id: "fee-perp-0001", source: "PERP_TRADE" as const, market: "BTC-USD", grossFeeUnits: "100", insuranceUnits: "50", treasuryUnits: "30", makerRebateUnits: "10", operatorUnits: "10", createdAt: new Date(NOW - 30_000).toISOString() }],
    insuranceMovements: [
      { id: "insurance-contrib-1", kind: "CONTRIBUTION" as const, amountUnits: "100", reasonDigest: h("6"), createdAt: new Date(NOW - 20_000).toISOString() },
      { id: "insurance-claim-01", kind: "CLAIM" as const, amountUnits: "20", reasonDigest: h("7"), createdAt: new Date(NOW - 10_000).toISOString() }
    ], generatedAt: new Date(NOW - 5_000).toISOString()
  };
  const result = validateProtocolEconomics(snapshot, NOW);
  assert.equal(result.insuranceClosingUnits, 1130n);
  assert.throws(() => validateProtocolEconomics({ ...snapshot, insuranceClosingUnits: "1129" }, NOW), /does not reconcile/);
});

test("milestone 69 oracle quorum requires independent weighted providers", () => {
  const policy = {
    market: "BTC-USD", minimumIndependentGroups: 3, minimumQuorumWeightBps: 7500, maximumGroupWeightBps: 4000, maximumSourceWeightBps: 3000, maximumAgeMs: 30_000, maximumDeviationBps: 100,
    sources: [
      { sourceId: "a", signerId: "sign-a", providerGroup: "provider-a", region: "eu", weightBps: 2500 },
      { sourceId: "b", signerId: "sign-b", providerGroup: "provider-b", region: "us", weightBps: 2500 },
      { sourceId: "c", signerId: "sign-c", providerGroup: "provider-c", region: "ap", weightBps: 2500 },
      { sourceId: "d", signerId: "sign-d", providerGroup: "provider-d", region: "eu", weightBps: 2500 }
    ]
  };
  assert.match(oracleIndependencePolicyRoot(policy), /^[0-9a-f]{64}$/);
  const result = aggregateIndependentOracleRound({ policy, expectedRoundId: 7, nowMs: NOW, observations: [
    { sourceId: "a", price: 60000, timestampMs: NOW - 1000, roundId: 7 }, { sourceId: "b", price: 60010, timestampMs: NOW - 900, roundId: 7 },
    { sourceId: "c", price: 59990, timestampMs: NOW - 800, roundId: 7 }
  ] });
  assert.equal(result.independentGroupCount, 3);
  const concentrated = { ...policy, sources: policy.sources.map((source, index) => index === 1 ? { ...source, signerId: "sign-a" } : source) };
  assert.throws(() => oracleIndependencePolicyRoot(concentrated), /signer is reused/);
});

test("milestone 70 settlement cannot bypass its challenge window", () => {
  const policy = { minimumChallengeWindowMs: 60_000, minimumChallengeBondUnits: "100", resolverQuorum: 2, maximumCaseAgeMs: 3_600_000 };
  const finalized = { caseId: "settlement-case-01", product: "OPTIONS" as const, market: "BTC-USD", settlementDigest: h("8"), status: "FINALIZED" as const, openedAt: new Date(NOW - 180_000).toISOString(), challengeDeadline: new Date(NOW - 120_000).toISOString(), finalizedAt: new Date(NOW - 60_000).toISOString() };
  assert.match(settlementDisputeRoot([finalized], policy, NOW), /^[0-9a-f]{64}$/);
  const challenged = { ...finalized, status: "CHALLENGED" as const, finalizedAt: undefined, challenge: { challengerId: "trader-a", reasonCode: "ORACLE" as const, evidenceDigest: h("9"), bondUnits: "100", submittedAt: new Date(NOW - 130_000).toISOString() } };
  assert.equal(validateSettlementDisputeCase(challenged, policy, NOW).status, "CHALLENGED");
  assert.throws(() => validateSettlementDisputeCase({ ...challenged, status: "FINALIZED", finalizedAt: new Date(NOW - 60_000).toISOString() }, policy, NOW), /without resolution/);
});

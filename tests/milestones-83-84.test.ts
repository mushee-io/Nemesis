import assert from "node:assert/strict";
import test from "node:test";
import { allowedActionsForMode, requiredMarketMode, validateMarketModeTransition } from "../lib/degraded-market-control";
import { buildOperatorFailoverReview } from "../lib/operator-failover-plan";

const NOW = new Date("2026-09-14T11:20:00.000Z").getTime();

const degradedPolicy = {
  maxIndexerLagNormal: 3,
  maxIndexerLagReduceOnly: 15,
  maxTxFailureBpsNormal: 100,
  maxTxFailureBpsReduceOnly: 500,
  minimumRecoveryObservations: 3,
  minimumModeDurationMs: 60_000
};

test("milestone 83 deterministically degrades market permissions under infrastructure stress", () => {
  const snapshot = {
    providerHealthy: true,
    indexerLagSlots: 6,
    oracleHealthy: true,
    finalityHealthy: true,
    keeperHealthy: true,
    solverHealthy: false,
    transactionFailureBps: 150,
    unresolvedCriticalDisputes: 0,
    insolvencyDetected: false,
    observedAt: new Date(NOW - 5_000).toISOString()
  };
  const required = requiredMarketMode(snapshot, degradedPolicy, NOW);
  assert.equal(required, "LIMIT_ONLY");
  const result = validateMarketModeTransition({
    previous: { market: "BTC-USD", mode: "NORMAL", generation: 1, enteredAt: new Date(NOW - 120_000).toISOString(), recoveryObservations: 0 },
    next: { market: "BTC-USD", mode: "LIMIT_ONLY", generation: 2, enteredAt: new Date(NOW - 1_000).toISOString(), recoveryObservations: 0 },
    requiredMode: required,
    policy: degradedPolicy,
    nowMs: NOW
  });
  assert.equal(result.mode, "LIMIT_ONLY");
  assert.equal(allowedActionsForMode("REDUCE_ONLY").includes("OPEN" as never), false);

  const critical = { ...snapshot, oracleHealthy: false };
  assert.equal(requiredMarketMode(critical, degradedPolicy, NOW), "SETTLEMENT_ONLY");
  const insolvent = { ...snapshot, insolvencyDetected: true };
  assert.equal(requiredMarketMode(insolvent, degradedPolicy, NOW), "PAUSED");
});

test("milestone 83 prevents premature relaxation without hysteresis evidence", () => {
  assert.throws(() => validateMarketModeTransition({
    previous: { market: "BTC-USD", mode: "REDUCE_ONLY", generation: 4, enteredAt: new Date(NOW - 30_000).toISOString(), recoveryObservations: 0 },
    next: { market: "BTC-USD", mode: "NORMAL", generation: 5, enteredAt: new Date(NOW - 1_000).toISOString(), recoveryObservations: 3 },
    requiredMode: "NORMAL",
    policy: degradedPolicy,
    nowMs: NOW
  }), /minimum duration/);
});

test("milestone 84 produces deterministic non-executable failover recommendations with diversity", () => {
  const policy = {
    minimumCandidates: 2,
    maximumRecommended: 2,
    heartbeatStaleMs: 60_000,
    minimumBondUnits: "1000",
    maximumStrikes: 2,
    reviewLeaseSlots: 120,
    minimumRegionDiversity: 2,
    minimumProviderGroupDiversity: 2
  };
  const round = {
    reviewId: "keeper-review-001",
    role: "KEEPER" as const,
    epoch: 4,
    currentSlot: 50_000,
    roundSeed: "a".repeat(64),
    operatorRoot: "b".repeat(64),
    candidates: [
      { operatorId: "keeper-a", role: "KEEPER" as const, region: "eu-west", providerGroup: "infra-a", bondUnits: "5000", strikes: 0, heartbeatAt: new Date(NOW - 5_000).toISOString(), disabled: false },
      { operatorId: "keeper-b", role: "KEEPER" as const, region: "us-east", providerGroup: "infra-b", bondUnits: "4000", strikes: 1, heartbeatAt: new Date(NOW - 4_000).toISOString(), disabled: false },
      { operatorId: "keeper-c", role: "KEEPER" as const, region: "ap-south", providerGroup: "infra-c", bondUnits: "3000", strikes: 3, heartbeatAt: new Date(NOW - 3_000).toISOString(), disabled: false }
    ]
  };
  const review = buildOperatorFailoverReview(round, policy, NOW);
  assert.equal(review.executionAllowed, false);
  assert.equal(review.recommendations.length, 2);
  assert.match(review.root, /^[0-9a-f]{64}$/);

  const concentrated = { ...round, candidates: round.candidates.slice(0, 2).map((candidate) => ({ ...candidate, region: "eu-west", providerGroup: "infra-a" })) };
  assert.throws(() => buildOperatorFailoverReview(concentrated, policy, NOW), /diversity/);
});

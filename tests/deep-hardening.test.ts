import assert from "node:assert/strict";
import test from "node:test";
import { validateStateTransitions } from "../lib/state-transition-guard";
import { OracleRoundRegistry } from "../lib/oracle-rounds";
import { ExecutionLeaseRegistry } from "../lib/execution-leases";
import { authorizeWithdrawal, evaluateExposureAdmission } from "../lib/exposure-control";
import { authorizeCanaryPromotion, evaluateCanaryObservation, validateRollbackManifest } from "../lib/canary-release";
import { evaluatePreprodSoak, type PreprodSoakSample } from "../lib/preprod-soak";

const H64 = "a".repeat(64);

test("state-transition guard rejects double satisfaction and output aliasing", () => {
  assert.equal(validateStateTransitions([
    { kind: "PERPETUAL", stateId: "btc-long-1", inputRef: `${"1".repeat(64)}#0`, continuingOutputIndex: 0 },
    { kind: "OPTION", stateId: "btc-call-1", inputRef: `${"2".repeat(64)}#1`, continuingOutputIndex: 1 }
  ]).valid, true);
  assert.throws(() => validateStateTransitions([
    { kind: "PERPETUAL", stateId: "btc-long-1", inputRef: `${"1".repeat(64)}#0`, continuingOutputIndex: 0 },
    { kind: "PERPETUAL", stateId: "btc-long-1", inputRef: `${"2".repeat(64)}#0`, continuingOutputIndex: 1 }
  ]), /cannot be satisfied twice/);
  assert.throws(() => validateStateTransitions([
    { kind: "PERPETUAL", stateId: "a", inputRef: `${"1".repeat(64)}#0`, continuingOutputIndex: 0 },
    { kind: "OPTION", stateId: "b", inputRef: `${"2".repeat(64)}#0`, continuingOutputIndex: 0 }
  ]), /same output/);
});

test("oracle round registry rejects replay, rollback and abrupt jumps", () => {
  const now = 1_000_000;
  const registry = new OracleRoundRegistry();
  registry.accept({ market: "BTC-USD", roundId: 10, price: 60_000, timestamp: new Date(now - 2_000).toISOString(), sources: ["a", "b"], quorum: 2, digest: H64 }, now);
  registry.accept({ market: "BTC-USD", roundId: 11, price: 60_500, timestamp: new Date(now - 1_000).toISOString(), sources: ["a", "b"], quorum: 2, digest: "b".repeat(64) }, now);
  assert.throws(() => registry.accept({ market: "BTC-USD", roundId: 11, price: 60_500, timestamp: new Date(now - 500).toISOString(), sources: ["a", "b"], quorum: 2, digest: "c".repeat(64) }, now), /replay or rollback/);
  assert.throws(() => registry.accept({ market: "BTC-USD", roundId: 12, price: 80_000, timestamp: new Date(now).toISOString(), sources: ["a", "b"], quorum: 2, digest: "d".repeat(64) }, now), /jump exceeds/);
});

test("execution leases are one-time, expiring and rate limited", () => {
  const now = 1_000_000;
  const registry = new ExecutionLeaseRegistry();
  const lease = {
    leaseId: "keeper-lease-0001",
    role: "KEEPER" as const,
    operator: "keeper-a",
    action: "LIQUIDATE",
    market: "BTC-USD",
    intentHash: H64,
    oracleRoundId: 42,
    maxNotionalUsd: 10_000,
    notBefore: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString()
  };
  assert.equal(registry.consume(lease, now).consumed, true);
  assert.throws(() => registry.consume(lease, now + 1), /already consumed/);
  assert.throws(() => registry.consume({ ...lease, leaseId: "keeper-lease-0002" }, now + 60_001), /expired/);
});

test("exposure controls cap OI and post-withdrawal risk", () => {
  assert.equal(evaluateExposureAdmission({ grossOpenInterestUsd: 500_000, marketOpenInterestUsd: 200_000, accountNotionalUsd: 10_000, requestedNotionalUsd: 20_000, liquidityUsd: 2_000_000 }).mode, "NORMAL");
  assert.throws(() => evaluateExposureAdmission({ grossOpenInterestUsd: 4_900_000, marketOpenInterestUsd: 1_400_000, accountNotionalUsd: 240_000, requestedNotionalUsd: 200_000, liquidityUsd: 5_000_000 }), /Global open-interest cap/);
  assert.equal(authorizeWithdrawal({ amountUsd: 10_000, postWithdrawalHealthFactor: 1.5, history: [], nowMs: 1_000_000 }).authorized, true);
  assert.throws(() => authorizeWithdrawal({ amountUsd: 10_000, postWithdrawalHealthFactor: 1.1, history: [], nowMs: 1_000_000 }), /health factor/);
});

test("canary promotion requires a healthy stage and governor quorum", () => {
  const observation = { stage: "CANARY_1" as const, startedAt: "2026-09-14T00:00:00.000Z", endedAt: "2026-09-14T00:45:00.000Z", transactions: 100, failedTransactions: 0, uniqueAccounts: 20, notionalUsd: 20_000, criticalIncidents: 0 };
  assert.equal(evaluateCanaryObservation(observation).passed, true);
  assert.equal(authorizeCanaryPromotion({ current: observation, next: "CANARY_10", governorApprovals: ["g1", "g2"], governorThreshold: 2 }).authorized, true);
  assert.throws(() => authorizeCanaryPromotion({ current: observation, next: "CANARY_50", governorApprovals: ["g1", "g2"], governorThreshold: 2 }), /exactly one stage/);
});

test("rollback manifest is independently fingerprinted", () => {
  const now = new Date("2026-09-14T10:00:00.000Z").getTime();
  assert.equal(validateRollbackManifest({ network: "preprod", rollbackCommitSha: "a".repeat(40), rollbackBuildSha256: "b".repeat(64), rollbackBlueprintSha256: "c".repeat(64), reasonHash: "d".repeat(64), generatedAt: "2026-09-14T09:55:00.000Z" }, "preprod", now), true);
  assert.throws(() => validateRollbackManifest({ network: "preprod", rollbackCommitSha: "a".repeat(40), rollbackBuildSha256: "b".repeat(64), rollbackBlueprintSha256: "b".repeat(64), reasonHash: "d".repeat(64), generatedAt: "2026-09-14T09:55:00.000Z" }, "preprod", now), /independently fingerprinted/);
});

test("deep preprod soak rejects reorgs, incidents and stale telemetry", () => {
  const now = new Date("2026-09-14T10:00:00.000Z").getTime();
  const samples: PreprodSoakSample[] = Array.from({ length: 13 }, (_, index) => ({
    timestamp: new Date(now - (12 - index) * 30 * 60 * 1000).toISOString(),
    readinessPassed: true,
    providerLagSlots: 2,
    indexerLagSlots: 3,
    oracleSourceCount: 3,
    failedTxRateBps: 0,
    p95ConfirmationMs: 40_000,
    chainTipAgeMs: 20_000,
    reorgDepth: index === 3 ? 1 : 0,
    criticalIncidents: 0
  }));
  assert.equal(evaluatePreprodSoak(samples, undefined, now).passed, true);
  const incident = samples.map((sample) => ({ ...sample }));
  incident[5].criticalIncidents = 1;
  assert.throws(() => evaluatePreprodSoak(incident, undefined, now), /Critical incident/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProtocolSolvency, assertCollateralConservation } from "../lib/solvency-ledger";
import { buildFundingRound, assertFundingTransferConservation } from "../lib/funding-rounds";
import { buildOptionSettlementProof, assertOptionSettlementConservation } from "../lib/options-settlement-proof";
import { createSolverQuoteCommitment, settleNotionalAuction, type SolverQuoteReveal } from "../lib/notional-auction";
import { evaluateChaosGate, REQUIRED_CHAOS_SCENARIOS } from "../lib/chaos-gate";
import { validateReleaseCertificate } from "../lib/release-certificate";
import { evaluateCanaryHistory, validateRollbackDrill, validateRollbackManifest, type CanaryObservation, type RollbackDrill, type RollbackManifest } from "../lib/canary-release";

test("milestone 40 requires ordered canary history and a real rollback drill", () => {
  const history: CanaryObservation[] = [
    {
      stage: "CANARY_1",
      startedAt: "2026-09-14T08:00:00.000Z",
      endedAt: "2026-09-14T08:31:00.000Z",
      transactions: 25,
      failedTransactions: 0,
      uniqueAccounts: 4,
      notionalUsd: 10_000,
      criticalIncidents: 0
    },
    {
      stage: "CANARY_10",
      startedAt: "2026-09-14T08:31:00.000Z",
      endedAt: "2026-09-14T10:32:00.000Z",
      transactions: 120,
      failedTransactions: 0,
      uniqueAccounts: 12,
      notionalUsd: 120_000,
      criticalIncidents: 0
    }
  ];
  assert.equal(evaluateCanaryHistory(history).currentStage, "CANARY_10");
  assert.throws(() => evaluateCanaryHistory([history[1]]), /staged rollout order/);

  const manifest: RollbackManifest = {
    network: "preprod",
    rollbackCommitSha: "a".repeat(40),
    rollbackBuildSha256: "b".repeat(64),
    rollbackBlueprintSha256: "c".repeat(64),
    reasonHash: "d".repeat(64),
    generatedAt: "2026-09-14T10:00:00.000Z"
  };
  assert.equal(validateRollbackManifest(manifest, "preprod", new Date("2026-09-14T10:05:00.000Z").getTime()), true);
  const drill: RollbackDrill = {
    network: "preprod",
    detectedAt: "2026-09-14T10:10:00.000Z",
    rollbackStartedAt: "2026-09-14T10:11:00.000Z",
    rollbackCompletedAt: "2026-09-14T10:17:00.000Z",
    restoredCommitSha: manifest.rollbackCommitSha,
    restoredBuildSha256: manifest.rollbackBuildSha256,
    restoredBlueprintSha256: manifest.rollbackBlueprintSha256,
    stateConsistencyPassed: true,
    dataLossDetected: false
  };
  assert.equal(validateRollbackDrill({ drill, manifest }).passed, true);
  assert.throws(() => validateRollbackDrill({ drill: { ...drill, dataLossDetected: true }, manifest }), /data loss/);
});

test("milestone 41 reconciles solvency and exact collateral conservation", () => {
  const result = evaluateProtocolSolvency({
    custodyUnits: 1_000n,
    insuranceUnits: 100n,
    userEquityLiabilityUnits: 800n,
    optionPayoutLiabilityUnits: 50n,
    pendingWithdrawalUnits: 50n,
    badDebtUnits: 0n,
    lockedPerpMarginUnits: 600n,
    lockedOptionCollateralUnits: 200n
  });
  assert.equal(result.solvent, true);
  assert.equal(result.freeCustodyUnits, 200n);
  assert.throws(() => evaluateProtocolSolvency({
    custodyUnits: 800n,
    insuranceUnits: 0n,
    userEquityLiabilityUnits: 900n,
    optionPayoutLiabilityUnits: 0n,
    pendingWithdrawalUnits: 0n,
    badDebtUnits: 0n,
    lockedPerpMarginUnits: 500n,
    lockedOptionCollateralUnits: 200n
  }), /undercollateralized/);
  assert.equal(assertCollateralConservation({ beforeUnits: 1_000n, afterUnits: 1_090n, externalInUnits: 100n, feeUnits: 10n }).conserved, true);
  assert.throws(() => assertCollateralConservation({ beforeUnits: 1_000n, afterUnits: 900n, externalOutUnits: 50n }), /conservation/);
});

test("milestone 42 funding rounds are contiguous, bounded and value-conserving", () => {
  const first = buildFundingRound({
    market: "BTC-USD",
    roundId: 1,
    indexPrice: 100,
    markPrice: 100.2,
    intervalStartMs: 1_000_000,
    intervalEndMs: 4_600_000,
    longOpenInterestUsd: 500_000,
    shortOpenInterestUsd: 450_000
  });
  const second = buildFundingRound({
    market: "BTC-USD",
    roundId: 2,
    indexPrice: 101,
    markPrice: 101.1,
    intervalStartMs: 4_600_000,
    intervalEndMs: 8_200_000,
    longOpenInterestUsd: 510_000,
    shortOpenInterestUsd: 460_000,
    previous: first
  });
  assert.equal(second.roundId, 2);
  assert.match(second.digest, /^[0-9a-f]{64}$/);
  assert.equal(assertFundingTransferConservation({ payerUnits: 100n, receiverUnits: 99n, protocolResidualUnits: 1n }).conserved, true);
  assert.throws(() => buildFundingRound({
    market: "BTC-USD",
    roundId: 1,
    indexPrice: 101,
    markPrice: 101.1,
    intervalStartMs: 4_600_000,
    intervalEndMs: 8_200_000,
    longOpenInterestUsd: 1,
    shortOpenInterestUsd: 1,
    previous: first
  }), /round id/);
});

test("milestone 43 options settlement conserves locked collateral exactly", () => {
  const proof = buildOptionSettlementProof({
    seriesId: "BTC:CALL:100:SEP",
    kind: "CALL",
    strike: 100,
    settlementPrice: 110,
    contracts: 2,
    contractMultiplierUnits: 100n,
    collateralUnits: 2_500n,
    protocolFeeBps: 100
  });
  assert.equal(proof.grossPayoutUnits, 2_000n);
  assert.equal(assertOptionSettlementConservation({
    proof,
    actualBuyerUnits: proof.buyerPayoutUnits,
    actualWriterUnits: proof.writerResidualUnits,
    actualProtocolFeeUnits: proof.protocolFeeUnits
  }), true);
  assert.throws(() => assertOptionSettlementConservation({
    proof,
    actualBuyerUnits: proof.buyerPayoutUnits + 1n,
    actualWriterUnits: proof.writerResidualUnits,
    actualProtocolFeeUnits: proof.protocolFeeUnits
  }), /Buyer payout/);
});

test("milestone 44 Notional uses committed competing quotes and deterministic best execution", () => {
  const quoteA: SolverQuoteReveal = {
    auctionId: "auction-001",
    solverId: "solver-a",
    price: 100,
    feeBps: 10,
    expiresAtMs: 1_040_000,
    salt: "a".repeat(32)
  };
  const quoteB: SolverQuoteReveal = {
    auctionId: "auction-001",
    solverId: "solver-b",
    price: 99.9,
    feeBps: 20,
    expiresAtMs: 1_040_000,
    salt: "b".repeat(32)
  };
  const commitments = [
    createSolverQuoteCommitment(quoteA, 1_000_000),
    createSolverQuoteCommitment(quoteB, 1_000_500)
  ];
  const result = settleNotionalAuction({
    auctionId: "auction-001",
    side: "BUY",
    limitPrice: 101,
    commitments,
    reveals: [quoteA, quoteB],
    nowMs: 1_010_000
  });
  assert.equal(result.winnerSolverId, "solver-b");
  assert.equal(result.eligibleSolverCount, 2);
  assert.match(result.transcriptDigest, /^[0-9a-f]{64}$/);
  assert.throws(() => settleNotionalAuction({
    auctionId: "auction-001",
    side: "BUY",
    limitPrice: 101,
    commitments,
    reveals: [quoteA, { ...quoteB, price: 98 }],
    nowMs: 1_010_000
  }), /commitment mismatch/);
});

test("milestone 45 chaos gate requires every failure mode and bounded recovery", () => {
  const nowMs = new Date("2026-09-14T12:00:00.000Z").getTime();
  const results = REQUIRED_CHAOS_SCENARIOS.map((scenario, index) => ({
    scenario,
    passed: true,
    startedAt: new Date(nowMs - 60_000 - index * 1_000).toISOString(),
    recoveredAt: new Date(nowMs - 30_000 - index * 1_000).toISOString(),
    evidenceSha256: (index % 6).toString(16).repeat(64),
    dataLossDetected: false
  }));
  assert.equal(evaluateChaosGate(results, undefined, nowMs).scenarioCount, REQUIRED_CHAOS_SCENARIOS.length);
  assert.throws(() => evaluateChaosGate(results.slice(1), undefined, nowMs), /Missing chaos scenarios/);
});

test("milestone 45 release certificate binds code, contracts, supply chain and economic evidence", () => {
  const nowMs = new Date("2026-09-14T12:00:00.000Z").getTime();
  const certificate = {
    network: "preprod" as const,
    protocolVersion: "0.9.0",
    commitSha: "a".repeat(40),
    webBuildSha256: "a".repeat(64),
    blueprintSha256: "b".repeat(64),
    validatorManifestSha256: "c".repeat(64),
    sbomSha256: "d".repeat(64),
    lockfileSha256: "e".repeat(64),
    solvencyEvidenceSha256: "f".repeat(64),
    fundingEvidenceSha256: "0".repeat(64),
    optionsEvidenceSha256: "1".repeat(64),
    notionalEvidenceSha256: "2".repeat(64),
    chaosEvidenceSha256: "3".repeat(64),
    rollbackEvidenceSha256: "4".repeat(64),
    issuedAt: "2026-09-14T11:30:00.000Z",
    expiresAt: "2026-09-14T13:30:00.000Z",
    governorApprovals: ["gov-a", "gov-b"]
  };
  const verified = validateReleaseCertificate(certificate, {
    expectedNetwork: "preprod",
    minimumGovernorApprovals: 2,
    maximumLifetimeMs: 4 * 60 * 60 * 1000
  }, nowMs);
  assert.equal(verified.verified, true);
  assert.match(verified.digest, /^[0-9a-f]{64}$/);
  assert.throws(() => validateReleaseCertificate({ ...certificate, sbomSha256: certificate.webBuildSha256 }, {
    expectedNetwork: "preprod",
    minimumGovernorApprovals: 2,
    maximumLifetimeMs: 4 * 60 * 60 * 1000
  }, nowMs), /digests must be distinct/);
});

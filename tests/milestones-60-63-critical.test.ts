import assert from "node:assert/strict";
import test from "node:test";
import { validateRegistryCriticalState } from "../lib/registry-critical-state";
import { validateProtocolMigration, type ProtocolMigrationPlan } from "../lib/protocol-migration";
import { authorizeRiskChange, classifyRiskChange, riskParameterDigest, type RiskParameterSet } from "../lib/risk-parameter-governance";
import { authorizeWithdrawalSettlement } from "../lib/withdrawal-settlement";
import { REQUIRED_VALIDATOR_TITLES } from "../lib/onchain-evidence";
import type { CardanoConfirmationProof } from "../lib/chain-confirmation-v2";

const NOW = new Date("2026-09-14T10:00:00.000Z").getTime();
const H64 = "a".repeat(64), H64B = "b".repeat(64), H56 = "c".repeat(56);
const ref = (n: number) => `${n.toString(16).padStart(64, "0")}#0`;

function migration(): ProtocolMigrationPlan {
  return {
    id: "migration-epoch-2", network: "preprod", mode: "UPGRADE", fromEpoch: 1, toEpoch: 2,
    previousRegistryRoot: H64, nextRegistryRoot: H64B, parameterSchemaSha256: "d".repeat(64), nextDeploymentSha256: "e".repeat(64),
    validators: REQUIRED_VALIDATOR_TITLES.map((title, i) => ({ title, previousScriptHash: (i + 1).toString(16).repeat(56).slice(0, 56), previousReference: ref(i + 1), nextScriptHash: (i + 6).toString(16).repeat(56).slice(0, 56), nextReference: ref(i + 20) })),
    state: [{ stateId: "account-state-1", product: "COLLATERAL", previousUtxoRef: ref(90), nextUtxoRef: ref(91), beforeDigest: H64, afterDigest: H64B, nonceBefore: 4, nonceAfter: 5 }],
    governorApprovals: ["gov-a", "gov-b"], proposedAt: new Date(NOW - 60_000).toISOString(), expiresAt: new Date(NOW + 3_600_000).toISOString()
  };
}

function risk(): RiskParameterSet {
  return { market: "BTC-USD", maxLeverage: 10, maintenanceMarginBps: 700, initialMarginBps: 1_000, maxOpenInterestUnits: "1000000", maxPositionUnits: "100000", fundingCapBps: 100, oracleDeviationBps: 150, liquidationPenaltyBps: 100, withdrawalDelaySlots: 120, maxWithdrawalBpsPerWindow: 1000, insuranceFloorUnits: "100000" };
}

function confirmation(depth = 50): CardanoConfirmationProof {
  return { network: "preprod", txHash: "1".repeat(64), blockHash: "2".repeat(64), slot: 10_000, blockHeight: 5_000, txIndex: 0, confirmations: 6, tipSlot: 10_000 + depth, observedAt: new Date(NOW - 5_000).toISOString(), inputRefs: [{ txHash: "3".repeat(64), outputIndex: 0 }], outputRefs: [{ txHash: "1".repeat(64), outputIndex: 0 }], referenceInputRefs: [], referenceScripts: [] };
}

test("milestone 60 registry critical state binds independent control roots", () => {
  const result = validateRegistryCriticalState({
    deploymentEpoch: 2, registryNonce: 7, stateRoot: H64, riskRoot: H64B, operatorRoot: "c".repeat(64), settlementRoot: "d".repeat(64), migrationRoot: "e".repeat(64),
    reviewRoot: "1".repeat(64), recoveryRoot: "2".repeat(64), economicsRoot: "3".repeat(64), oraclePolicyRoot: "4".repeat(64), disputeRoot: "5".repeat(64), accountabilityRoot: "6".repeat(64), invariantRoot: "7".repeat(64), upgradeRecoveryRoot: "8".repeat(64),
    oracleRound: 10, fundingRound: 9, paused: false
  });
  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.equal(result.deploymentEpoch, 2);
});

test("milestone 61 migration requires all five validators and one-step state nonces", () => {
  const plan = migration();
  const result = validateProtocolMigration(plan, 2, NOW);
  assert.equal(result.stateCount, 1);
  const missing = migration(); missing.validators.pop();
  assert.throws(() => validateProtocolMigration(missing, 2, NOW), /all validators/);
  const skipped = migration(); skipped.state[0].nonceAfter = 6;
  assert.throws(() => validateProtocolMigration(skipped, 2, NOW), /state transition/);
});

test("milestone 62 fast path only permits unambiguously tighter risk", () => {
  const previous = risk();
  const tighter = { ...previous, maxLeverage: 8, maintenanceMarginBps: 800, initialMarginBps: 1200, maxOpenInterestUnits: "900000", maxPositionUnits: "90000", fundingCapBps: 80, oracleDeviationBps: 120, withdrawalDelaySlots: 180, maxWithdrawalBpsPerWindow: 800, insuranceFloorUnits: "120000" };
  assert.equal(classifyRiskChange(previous, tighter), "TIGHTEN");
  const proposal = { id: "risk-tighten-01", previousDigest: riskParameterDigest(previous), next: tighter, proposedAt: new Date(NOW - 30_000).toISOString(), executeAfter: new Date(NOW - 30_000).toISOString(), expiresAt: new Date(NOW + 60_000).toISOString(), governorApprovals: [], guardianApprovals: ["guardian-a"] };
  const authorized = authorizeRiskChange({ previous, proposal, policy: { governorQuorum: 2, guardianQuorum: 1, relaxationDelayMs: 3_600_000, maxLeverageHardCap: 20, maxOracleDeviationBps: 250, maxLiquidationPenaltyBps: 500 }, nowMs: NOW });
  assert.equal(authorized.changeClass, "TIGHTEN");
  const penaltyChange = { ...previous, liquidationPenaltyBps: 120 };
  assert.equal(classifyRiskChange(previous, penaltyChange), "MIXED");
});

test("milestone 62 relaxation requires governor quorum and timelock", () => {
  const previous = risk(), relaxed = { ...previous, maxLeverage: 12 };
  const proposal = { id: "risk-relax-001", previousDigest: riskParameterDigest(previous), next: relaxed, proposedAt: new Date(NOW - 60_000).toISOString(), executeAfter: new Date(NOW + 3_000_000).toISOString(), expiresAt: new Date(NOW + 7_200_000).toISOString(), governorApprovals: ["gov-a", "gov-b"], guardianApprovals: [] };
  assert.throws(() => authorizeRiskChange({ previous, proposal, policy: { governorQuorum: 2, guardianQuorum: 1, relaxationDelayMs: 3_600_000, maxLeverageHardCap: 20, maxOracleDeviationBps: 250, maxLiquidationPenaltyBps: 500 }, nowMs: NOW }), /timelock/);
});

test("milestone 63 withdrawals require stable finality, maturity, health and outflow headroom", () => {
  const policy = { minimumDelaySlots: 20, maxTicketUnits: "1000", rollingWindowSlots: 100, maxWindowOutflowUnits: "1500", minimumPostWithdrawalHealthBps: 12_000 };
  const ticket = { id: "withdrawal-0001", account: "account-a", asset: "USDM", amountUnits: "500", requestedAtSlot: 10_000, earliestSettlementSlot: 10_020, accountStateRoot: H64, riskRoot: H64B };
  const finalityPolicy = { expectedNetwork: "preprod" as const, minimumConfirmations: 3, stabilityWindowSlots: 20, maximumObservationAgeMs: 60_000 };
  const result = authorizeWithdrawalSettlement({ ticket, policy, finalityProof: confirmation(), finalityPolicy, currentSlot: 10_050, postWithdrawalHealthBps: 13_000, recentSettlements: [{ id: "withdrawal-old", amountUnits: "400", settlementSlot: 10_030 }], protocolPaused: false, nowMs: NOW });
  assert.equal(result.rollingOutflowUnits, "900");
  assert.throws(() => authorizeWithdrawalSettlement({ ticket, policy, finalityProof: confirmation(5), finalityPolicy, currentSlot: 10_050, postWithdrawalHealthBps: 13_000, recentSettlements: [], protocolPaused: false, nowMs: NOW }), /not stable/);
});

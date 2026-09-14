import assert from "node:assert/strict";
import test from "node:test";
import { buildProductionReviewCertificate } from "../lib/production-review-certificate";
import { buildProtocolStateRoot } from "../lib/protocol-state-root";
import { validateProtocolMigration } from "../lib/protocol-migration";
import { riskParameterDigest } from "../lib/risk-parameter-governance";
import { operatorSetRoot, type OperatorSet } from "../lib/operator-set-governance";
import { settlementSafetyRoot } from "../lib/settlement-safety-root";
import { DEFAULT_CHAOS_POLICY, REQUIRED_CHAOS_SCENARIOS } from "../lib/chaos-gate";
import { REQUIRED_VALIDATOR_TITLES } from "../lib/onchain-evidence";

const NOW = new Date("2026-09-14T10:00:00.000Z").getTime();
const h = (c: string) => c.repeat(64);
const ref = (n: number) => `${n.toString(16).padStart(64, "0")}#0`;
const risk = { market: "BTC-USD", maxLeverage: 10, maintenanceMarginBps: 700, initialMarginBps: 1_000, maxOpenInterestUnits: "1000000", maxPositionUnits: "100000", fundingCapBps: 100, oracleDeviationBps: 150, liquidationPenaltyBps: 100, withdrawalDelaySlots: 120, maxWithdrawalBpsPerWindow: 1000, insuranceFloorUnits: "100000" };
const withdrawalPolicy = { minimumDelaySlots: 20, maxTicketUnits: "1000", rollingWindowSlots: 100, maxWindowOutflowUnits: "1500", minimumPostWithdrawalHealthBps: 12_000 };
const liquidationPolicy = { minimumQuotes: 2, maxCloseBps: 5_000, maxPriceImpactBps: 200, maxKeeperFeeBps: 50, minimumKeeperBondUnits: "1000", insuranceFloorUnits: "5000", maxInsuranceDrawUnits: "3000", allowAdl: true };

function operatorSet(): OperatorSet {
  const specs = [["gov-a","1",["GOVERNOR"]],["gov-b","2",["GOVERNOR"]],["guardian","3",["GUARDIAN"]],["oracle-a","4",["ORACLE"]],["oracle-b","5",["ORACLE"]],["keeper-a","6",["KEEPER"]],["keeper-b","7",["KEEPER"]],["solver-a","8",["SOLVER"]],["solver-b","9",["SOLVER"]],["builder","a",["BUILDER"]]] as const;
  return { epoch: 2, members: specs.map(([id,c,roles]) => ({ id, credentialDigest: c.repeat(64), roles: [...roles], activeFromSlot: 1_000 })), thresholds: { GOVERNOR: 2, GUARDIAN: 1, ORACLE: 2, KEEPER: 2, SOLVER: 2, BUILDER: 1 } };
}

test("milestone 66 recomputes every control root and remains non-executable", () => {
  const checkpoint = {
    deploymentEpoch: 2, registryNonce: 8, oracleRound: 10, fundingRound: 9,
    leaves: [{ product: "COLLATERAL" as const, stateId: "acct-state-1", utxoRef: `${"f".repeat(64)}#0`, ownerOrMarket: "account-a", nonce: 2, valueDigest: h("a") }],
    accounting: { custodyUnits: "10000", insuranceUnits: "2000", userEquityLiabilityUnits: "5000", pendingWithdrawalUnits: "500", badDebtUnits: "0", lockedPerpMarginUnits: "2000", lockedOptionCollateralUnits: "1000", optionPayoutLiabilityUnits: "500", notionalEscrowUnits: "500" },
    generatedAt: new Date(NOW - 30_000).toISOString()
  };
  const root = buildProtocolStateRoot(checkpoint).root;
  const migration = {
    id: "migration-review-2", network: "preprod" as const, mode: "UPGRADE" as const, fromEpoch: 1, toEpoch: 2,
    previousRegistryRoot: h("1"), nextRegistryRoot: root, parameterSchemaSha256: h("2"), nextDeploymentSha256: h("3"),
    validators: REQUIRED_VALIDATOR_TITLES.map((title, i) => ({ title, previousScriptHash: (i + 1).toString(16).repeat(56).slice(0, 56), previousReference: ref(i + 1), nextScriptHash: (i + 6).toString(16).repeat(56).slice(0, 56), nextReference: ref(i + 20) })),
    state: [{ stateId: "acct-state-1", product: "COLLATERAL" as const, previousUtxoRef: ref(80), nextUtxoRef: ref(81), beforeDigest: h("4"), afterDigest: h("5"), nonceBefore: 1, nonceAfter: 2 }],
    governorApprovals: ["gov-a", "gov-b"], proposedAt: new Date(NOW - 60_000).toISOString(), expiresAt: new Date(NOW + 3_600_000).toISOString()
  };
  const migrationRoot = validateProtocolMigration(migration, 2, NOW).digest;
  const operators = operatorSet();
  const settlement = { withdrawalPolicy, liquidationPolicy, pendingWithdrawalDigest: h("6"), insuranceStateDigest: h("7") };
  const registry = { deploymentEpoch: 2, registryNonce: 8, stateRoot: root, riskRoot: riskParameterDigest(risk), operatorRoot: operatorSetRoot(operators), settlementRoot: settlementSafetyRoot(settlement), migrationRoot, oracleRound: 10, fundingRound: 9, paused: false };
  const chaosResults = REQUIRED_CHAOS_SCENARIOS.map((scenario, i) => ({ scenario, passed: true, startedAt: new Date(NOW - 120_000).toISOString(), recoveredAt: new Date(NOW - 60_000).toISOString(), evidenceSha256: (i % 10).toString(16).repeat(64), dataLossDetected: false }));
  const bundle = { sourcePreprodDigest: h("8"), registry, checkpoint, migration, activeRisk: risk, operators, settlement, chaosResults, reviewerApprovals: ["reviewer-a", "reviewer-b"], issuedAt: new Date(NOW - 10_000).toISOString(), expiresAt: new Date(NOW + 3_600_000).toISOString() };
  const result = buildProductionReviewCertificate({ bundle, minimumReviewers: 2, migrationGovernorQuorum: 2, chaosPolicy: DEFAULT_CHAOS_POLICY, nowMs: NOW });
  assert.equal(result.reviewReady, true);
  assert.equal(result.activationAllowed, false);
  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.throws(() => buildProductionReviewCertificate({ bundle: { ...bundle, registry: { ...registry, riskRoot: h("9") } }, minimumReviewers: 2, migrationGovernorQuorum: 2, chaosPolicy: DEFAULT_CHAOS_POLICY, nowMs: NOW }), /risk root mismatch/);
});

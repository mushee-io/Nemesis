import assert from "node:assert/strict";
import test from "node:test";
import { validateTransactionFirewall, type HardenedPreparedTransaction } from "../lib/transaction-firewall";
import { validateOracleCircuitBreaker } from "../lib/oracle-circuit-breaker";
import { applyInsuranceLoss, rankAdlCandidates, validateMarketAdmission } from "../lib/risk-limits";
import { assertActionAllowed, authorizeEmergencyModeChange, authorizeGovernanceExecution, createGovernanceProposal } from "../lib/governance";
import { evaluateReleaseGate } from "../lib/release-gate";

const ACCOUNT = `addr_test1${"q".repeat(40)}`;
const VALIDATOR = `addr_test1${"w".repeat(40)}`;
const SCRIPT_HASH = "c".repeat(56);
const DIGEST = "a".repeat(64);

test("transaction firewall rejects excessive fees and unknown outputs", () => {
  const prepared: HardenedPreparedTransaction = {
    requestId: "perp-order-firewall",
    network: "preprod",
    unsignedTxCborHex: "a100",
    createdAt: "2026-09-14T08:00:00.000Z",
    expiresAt: "2026-09-14T08:05:00.000Z",
    intentHash: DIGEST,
    summary: {
      action: "OPEN_PERP",
      account: ACCOUNT,
      network: "preprod",
      feeLovelace: "500000",
      scriptHashes: [SCRIPT_HASH],
      outputs: [{ address: VALIDATOR, lovelace: "5000000" }, { address: ACCOUNT, lovelace: "2500000" }],
      changeAddress: ACCOUNT,
      txBodyHash: DIGEST
    }
  };
  const policy = { account: ACCOUNT, network: "preprod" as const, allowedActions: ["OPEN_PERP" as const], allowedScriptHashes: [SCRIPT_HASH], allowedOutputAddresses: [VALIDATOR], expectedChangeAddress: ACCOUNT, maxFeeLovelace: 600000n };
  assert.equal(validateTransactionFirewall({ prepared, policy }), true);
  assert.throws(() => validateTransactionFirewall({ prepared: { ...prepared, summary: { ...prepared.summary, feeLovelace: "900000" } }, policy }), /fee exceeds/);
  assert.throws(() => validateTransactionFirewall({ prepared: { ...prepared, summary: { ...prepared.summary, outputs: [{ address: `addr_test1${"e".repeat(40)}`, lovelace: "1" }] } }, policy }), /unapproved output/);
});

test("oracle circuit breaker rejects abrupt price jumps", () => {
  const nowMs = 1_000_000;
  const history = [{ price: 60_000, timestampMs: nowMs - 10_000, sources: ["oracle-a", "oracle-b"] }];
  const safe = validateOracleCircuitBreaker({ nowMs, history, samples: [{ source: "oracle-a", price: 60_100, timestampMs: nowMs - 500 }, { source: "oracle-b", price: 60_120, timestampMs: nowMs - 400 }] });
  assert(safe.price > 60_000);
  assert.throws(() => validateOracleCircuitBreaker({ nowMs, history, samples: [{ source: "oracle-a", price: 66_000, timestampMs: nowMs - 500 }, { source: "oracle-b", price: 66_020, timestampMs: nowMs - 400 }] }), /abrupt price jump/);
});

test("market risk limits enforce leverage, OI, skew and insurance floors", () => {
  const limits = { maxOpenInterestUsd: 1_000_000, maxSkewUsd: 400_000, maxPositionUsd: 250_000, leverageTiers: [{ maxNotionalUsd: 25_000, maxLeverage: 20 }, { maxNotionalUsd: 100_000, maxLeverage: 10 }, { maxNotionalUsd: 250_000, maxLeverage: 5 }], minInsuranceFundUsd: 100_000 };
  assert.equal(validateMarketAdmission({ side: "LONG", positionNotionalUsd: 20_000, leverage: 10, state: { longOpenInterestUsd: 100_000, shortOpenInterestUsd: 90_000, insuranceFundUsd: 200_000 }, limits }).allowed, true);
  assert.throws(() => validateMarketAdmission({ side: "LONG", positionNotionalUsd: 150_000, leverage: 10, state: { longOpenInterestUsd: 100_000, shortOpenInterestUsd: 90_000, insuranceFundUsd: 200_000 }, limits }), /Leverage exceeds/);
  assert.throws(() => validateMarketAdmission({ side: "LONG", positionNotionalUsd: 20_000, leverage: 5, state: { longOpenInterestUsd: 100_000, shortOpenInterestUsd: 90_000, insuranceFundUsd: 50_000 }, limits }), /reduce-only/);
});

test("insurance accounting exposes bad debt and ADL ranking", () => {
  assert.deepEqual(applyInsuranceLoss({ insuranceFundUsd: 100, liquidationLossUsd: 160 }), { coveredUsd: 100, remainingInsuranceUsd: 0, badDebtUsd: 60 });
  const ranked = rankAdlCandidates([{ account: "a", unrealizedProfitUsd: 1000, leverage: 5, notionalUsd: 10000 }, { account: "b", unrealizedProfitUsd: 500, leverage: 15, notionalUsd: 5000 }]);
  assert.equal(ranked[0].account, "b");
});

test("governance timelock and emergency roles fail closed", () => {
  const proposal = createGovernanceProposal({ id: "risk-change-0001", action: "UPDATE_RISK_LIMITS", payloadHash: DIGEST, proposer: "governor-1", role: "GOVERNOR", nowMs: 1_000_000, minimumDelayMs: 3_600_000, ttlMs: 7_200_000 });
  assert.throws(() => authorizeGovernanceExecution({ proposal, role: "GOVERNOR", payloadHash: DIGEST, nowMs: 2_000_000 }), /timelock/);
  assert.equal(authorizeGovernanceExecution({ proposal, role: "GOVERNOR", payloadHash: DIGEST, nowMs: 4_700_000 }), true);
  assert.equal(authorizeEmergencyModeChange({ role: "GUARDIAN", from: "NORMAL", to: "PAUSED" }), true);
  assert.throws(() => authorizeEmergencyModeChange({ role: "GUARDIAN", from: "PAUSED", to: "NORMAL" }), /cannot relax/);
  assert.throws(() => assertActionAllowed("REDUCE_ONLY", "OPEN_PERP"), /disabled/);
});

test("release gate requires deep milestones 50-55 and explicit mainnet enable", () => {
  const manifest = {
    network: "mainnet" as const,
    providerEndpoint: "https://provider.example",
    indexerEndpoint: "https://indexer.example",
    transactionBuilderEndpoint: "https://builder.example",
    oracleSources: ["oracle-a", "oracle-b"],
    validators: [
      { name: "collateral" as const, address: `addr1${"q".repeat(40)}`, scriptHash: SCRIPT_HASH },
      { name: "perpetual" as const, address: `addr1${"w".repeat(40)}`, scriptHash: SCRIPT_HASH },
      { name: "options" as const, address: `addr1${"e".repeat(40)}`, scriptHash: SCRIPT_HASH },
      { name: "notional" as const, address: `addr1${"r".repeat(40)}`, scriptHash: SCRIPT_HASH }
    ]
  };
  const evidence = {
    protocolTestsPassed: true,
    executionTestsPassed: true,
    hardeningTestsPassed: true,
    aikenCheckPassed: true,
    blueprintVerified: true,
    validatorArtifactsPinned: true,
    validatorDeploymentsBound: true,
    e2eLifecyclePassed: true,
    releaseProvenanceVerified: true,
    operatorPolicyVerified: true,
    incidentRecoveryConfigured: true,
    preprodSoakPassed: true,
    stateTransitionBindingPassed: true,
    oracleRoundIntegrityPassed: true,
    executionLeaseControlsPassed: true,
    exposureControlsPassed: true,
    canaryRollbackConfigured: true,
    canaryRollbackDrillPassed: true,
    solvencyConservationPassed: true,
    fundingIntegrityPassed: true,
    optionsSettlementConservationPassed: true,
    notionalAuctionFairnessPassed: true,
    chaosRecoveryPassed: true,
    releaseCertificateVerified: true,
    parameterSchemaPinned: true,
    parameterizedDeploymentVerified: true,
    referenceScriptsConfirmed: true,
    chainConfirmationProofsVerified: true,
    liveFundingConfirmed: true,
    liveOptionsSettlementConfirmed: true,
    liveNotionalSettlementConfirmed: true,
    preprodReleaseAttestationVerified: true,
    dependencyAuditReviewed: true,
    securityContactConfigured: true,
    emergencyRunbookConfigured: true
  };
  assert.equal(evaluateReleaseGate({ manifest, evidence, allowMainnet: false }).ready, false);
  assert.equal(evaluateReleaseGate({ manifest, evidence, allowMainnet: true }).ready, true);
  assert.equal(evaluateReleaseGate({ manifest, evidence: { ...evidence, preprodReleaseAttestationVerified: false }, allowMainnet: true }).ready, false);
});

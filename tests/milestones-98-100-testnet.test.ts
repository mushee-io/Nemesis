import assert from "node:assert/strict";
import test from "node:test";
import { CARDANO_PREPROD_PROFILE, validateCardanoTestnetProfile } from "../lib/cardano-testnet-profile";
import { parameterDigest } from "../lib/testnet-deployment-manifest";
import { validateTestnetFailureEvidence, REQUIRED_TESTNET_FAILURE_SCENARIOS } from "../lib/testnet-failure-evidence";
import { buildFinalizedTestnetEvidence, type FinalizedTestnetEvidenceBundle } from "../lib/testnet-final-evidence";
import { finalizeCardanoPreprodTestnet } from "../lib/testnet-finalization-v11";
import { buildProtocolStateRoot } from "../lib/protocol-state-root";
import type { TestnetActionReceipt } from "../lib/testnet-lifecycle-core";
import type { RebuildAttempt } from "../lib/transaction-rebuild";

const NOW = new Date("2026-09-14T12:00:00.000Z").getTime();
const hex64 = (n: number) => n.toString(16).padStart(64, "0");
const h = (c: string) => c.repeat(64);
const address = "addr_test1qfinalwallet00000000000000000000000000000000000000000";
const ref = (n: number) => `${hex64(n)}#0`;

function lifecycleReceipts(actions: TestnetActionReceipt["action"][], start: number): TestnetActionReceipt[] {
  return actions.map((action, i) => ({
    action,
    txHash: hex64(start + i),
    blockHash: hex64(9000 + start + i),
    slot: 1500 + start + i,
    confirmations: 10,
    planDigest: hex64(2000 + start + i),
    builderReceiptDigest: hex64(3000 + start + i),
    stateRootBefore: hex64(4000 + start + i),
    stateRootAfter: hex64(4001 + start + i),
    observedAt: new Date(NOW - 5_000).toISOString()
  })).map((receipt, i, all) => i === 0 ? receipt : { ...receipt, stateRootBefore: all[i - 1].stateRootAfter });
}

function rebuildAttempt(generation: number, tx: number, state: number, provider: number, input: number, start: number, end: number): RebuildAttempt {
  return { intentHash: h("a"), generation, transactionHash: hex64(tx), stateRoot: hex64(state), providerEvidenceRoot: hex64(provider), consumedUtxoRefs: [ref(input)], validityStartSlot: start, validityEndSlot: end, builtAt: new Date(NOW - 10_000 + generation * 1000).toISOString() };
}

function failures() {
  const badPrev = rebuildAttempt(1, 500, 600, 700, 800, 1000, 1100);
  const badNext = rebuildAttempt(2, 501, 601, 701, 801, 1001, 1101);
  const valPrev = rebuildAttempt(1, 510, 610, 710, 810, 1000, 1100);
  const valNext = rebuildAttempt(2, 511, 610, 711, 810, 1020, 1140);
  const timeoutPrev = rebuildAttempt(1, 520, 620, 720, 820, 1000, 1100);
  const timeoutNext = rebuildAttempt(2, 521, 620, 721, 820, 1001, 1101);
  return REQUIRED_TESTNET_FAILURE_SCENARIOS.map((scenario, i) => {
    const base = { scenario, passed: true, startedAt: new Date(NOW - 30_000).toISOString(), recoveredAt: new Date(NOW - 20_000).toISOString(), evidenceSha256: hex64(6000 + i), dataLossDetected: false };
    if (scenario === "BAD_INPUTS_REBUILD") return { ...base, previous: badPrev, next: badNext, failureCode: "BAD_INPUTS" as const };
    if (scenario === "VALIDITY_REBUILD") return { ...base, previous: valPrev, next: valNext, failureCode: "OUTSIDE_VALIDITY" as const };
    if (scenario === "AMBIGUOUS_TIMEOUT_LOOKUP") return { ...base, previous: timeoutPrev, next: timeoutNext, failureCode: "PROVIDER_TIMEOUT" as const, txPresenceChecked: true, txAlreadyObserved: false };
    return base;
  });
}

const rebuildPolicy = { maximumAttempts: 5, maximumAgeMs: 600_000, minimumValidityExtensionSlots: 20, requireFreshStateRootOnBadInputs: true, requireTxLookupAfterTimeout: true };

test("98 finalized failure suite requires safe rebuild semantics and zero data loss", () => {
  const result = validateTestnetFailureEvidence(failures(), { maximumRecoveryMs: 60_000, rebuildPolicy }, NOW);
  assert.equal(result.scenarioCount, 7);
  assert.equal(result.passed, true);
});

function operatorManifest() {
  const specs = [
    ["gov-a","GOVERNOR","1","g1","eu"],["guardian-a","GUARDIAN","2","g2","us"],["oracle-a","ORACLE","3","oa","eu"],["oracle-b","ORACLE","4","ob","us"],
    ["keeper-a","KEEPER","5","ka","eu"],["keeper-b","KEEPER","6","kb","us"],["solver-a","SOLVER","7","sa","eu"],["solver-b","SOLVER","8","sb","us"],["builder-a","BUILDER","9","ba","eu"]
  ] as const;
  return { network: "preprod" as const, operatorEpoch: 2, operators: specs.map(([operatorId,role,c,infrastructureGroup,region]) => ({ operatorId, role, verificationKeyHash: c.repeat(56), infrastructureGroup, region, active: true })), oracleSources: [
    { sourceId: "oracle-source-a", signerVerificationKeyHash: "a".repeat(56), providerGroup: "oracle-group-a", market: "BTC-USD", endpoint: "https://oracle-a.example.test", weight: 50 },
    { sourceId: "oracle-source-b", signerVerificationKeyHash: "b".repeat(56), providerGroup: "oracle-group-b", market: "BTC-USD", endpoint: "https://oracle-b.example.test", weight: 50 }
  ], generatedAt: new Date(NOW - 5_000).toISOString() };
}

function fullBundle(): FinalizedTestnetEvidenceBundle {
  const profile = CARDANO_PREPROD_PROFILE;
  const profileRoot = validateCardanoTestnetProfile(profile).root;
  const names = ["collateral","perpetual","options","notional","registry"] as const;
  const validators = names.map((name, i) => {
    const tx = hex64(100 + i), params = ["00",`0${i + 1}`];
    return { name, blueprintTitle: `${name}.${name}.spend`, parameterCborHex: params, parameterDigest: parameterDigest(params), sourceCompiledCodeDigest: hex64(200 + i), appliedScriptHash: (i + 1).toString(16).repeat(56).slice(0,56), address, referenceScriptUtxo: `${tx}#0`, deploymentTxHash: tx, deploymentSlot: 1000 + i };
  });
  const perpsReceipts = lifecycleReceipts(["DEPOSIT_COLLATERAL","OPEN_PERP","APPLY_FUNDING","CLOSE_PERP","OPEN_PERP","LIQUIDATE_PERP","WITHDRAW_COLLATERAL"], 1000);
  const optionsReceipts = lifecycleReceipts(["WRITE_OPTION","BUY_OPTION","SETTLE_OPTION","CLOSE_OPTION"], 1100);
  const notionalReceipts = lifecycleReceipts(["COMMIT_NOTIONAL","FILL_NOTIONAL","COMMIT_NOTIONAL","CANCEL_NOTIONAL"], 1200);
  const allLifecycle = [...perpsReceipts,...optionsReceipts,...notionalReceipts];
  const confirmation = (txHash: string, slot: number, scriptHash?: string) => ({ network: "preprod" as const, txHash, blockHash: hex64(8000 + slot), slot, blockHeight: 5000 + slot, txIndex: 0, confirmations: 10, tipSlot: 5000, observedAt: new Date(NOW - 5_000).toISOString(), inputRefs: [{ txHash: hex64(9999), outputIndex: 0 }], outputRefs: [{ txHash, outputIndex: 0 }], referenceInputRefs: [], referenceScripts: scriptHash ? [{ ref: { txHash, outputIndex: 0 }, scriptHash }] : [] });
  const checkpoint = { deploymentEpoch: 3, registryNonce: 12, oracleRound: 20, fundingRound: 19, leaves: [
    { product: "COLLATERAL" as const, stateId: "acct-state-final", utxoRef: ref(900), ownerOrMarket: "account-a", nonce: 5, valueDigest: hex64(901) },
    { product: "PERPETUAL" as const, stateId: "perp-state-final", utxoRef: ref(902), ownerOrMarket: "BTC-USD", nonce: 8, valueDigest: hex64(903) },
    { product: "OPTIONS" as const, stateId: "option-state-final", utxoRef: ref(904), ownerOrMarket: "BTC-USD", nonce: 4, valueDigest: hex64(905) },
    { product: "NOTIONAL" as const, stateId: "notional-state-final", utxoRef: ref(906), ownerOrMarket: "BTC-USD", nonce: 4, valueDigest: hex64(907) }
  ], accounting: { custodyUnits: "20000", insuranceUnits: "5000", userEquityLiabilityUnits: "12000", pendingWithdrawalUnits: "1000", badDebtUnits: "0", lockedPerpMarginUnits: "3000", lockedOptionCollateralUnits: "2000", optionPayoutLiabilityUnits: "500", notionalEscrowUnits: "1000" }, generatedAt: new Date(NOW - 5_000).toISOString() };
  const providerUtxos = [{ txHash: hex64(300), outputIndex: 0, address, lovelace: "10000000" }];
  const refs = checkpoint.leaves.map((leaf) => leaf.utxoRef);
  return {
    profile,
    providerSnapshots: [
      { providerId: "provider-a", providerGroup: "group-a", address, tipSlot: 5000, tipBlockHash: hex64(400), observedAt: new Date(NOW - 5_000).toISOString(), utxos: providerUtxos },
      { providerId: "provider-b", providerGroup: "group-b", address, tipSlot: 5001, tipBlockHash: hex64(401), observedAt: new Date(NOW - 5_000).toISOString(), utxos: providerUtxos }
    ],
    providerPolicy: { minimumProviders: 2, minimumIndependentGroups: 2, maximumTipSkewSlots: 5, maximumObservationAgeMs: 60_000 },
    walletPreflight: { networkId: 0, changeAddress: "a100", utxoCount: 1, changeAddressDigest: hex64(450), observedAt: new Date(NOW - 5_000).toISOString(), digest: hex64(451) },
    deployment: { network: "preprod", networkMagic: 1, profileRoot, blueprintSha256: hex64(500), parameterSchemaSha256: hex64(501), deployedByAddress: address, validators, generatedAt: new Date(NOW - 5_000).toISOString() },
    operators: operatorManifest(),
    perps: { market: "BTC-USD", collateralAssetUnit: "lovelace", receipts: perpsReceipts },
    options: { seriesId: "btc-call-final-01", underlying: "BTC-USD", expiryMs: NOW - 10_000, receipts: optionsReceipts, lockedCollateralUnits: "1000", buyerPayoutUnits: "250", writerResidualUnits: "740", protocolFeeUnits: "10" },
    notional: { market: "BTC-USD", receipts: notionalReceipts, fill: { side: "BUY", limitPrice: "100", executionPrice: "99", winningSolverId: "solver-a", competingSolverCount: 2, solverFeeBps: 20 } },
    finality: { deploymentConfirmations: validators.map((v) => confirmation(v.deploymentTxHash, v.deploymentSlot, v.appliedScriptHash)), lifecycleConfirmations: allLifecycle.map((r) => confirmation(r.txHash, r.slot)), currentTipSlot: 5000 },
    finalityPolicy: { minimumConfirmations: 3, stabilityWindowSlots: 20, maximumObservationAgeMs: 60_000 },
    checkpoint,
    indexers: [
      { providerId: "indexer-a", tipSlot: 5000, indexedSlot: 4998, stateUtxoRefs: refs, observedAt: new Date(NOW - 5_000).toISOString() },
      { providerId: "indexer-b", tipSlot: 5000, indexedSlot: 4999, stateUtxoRefs: refs, observedAt: new Date(NOW - 5_000).toISOString() }
    ],
    indexerPolicy: { maximumLagSlots: 5, maximumObservationAgeMs: 60_000, minimumIndependentIndexers: 2 },
    failures: failures(), failurePolicy: { maximumRecoveryMs: 60_000, rebuildPolicy }, generatedAt: new Date(NOW - 1_000).toISOString()
  };
}

test("99 full Preprod evidence graph composes deployment, lifecycles, finality, state and failures", () => {
  const result = buildFinalizedTestnetEvidence(fullBundle(), 3, NOW);
  assert.equal(result.lifecycleTransactionCount, 15);
  assert.equal(result.stable, true);
  assert.equal(result.reconciled, true);
  assert.match(result.root, /^[0-9a-f]{64}$/);
});

test("100 V11 finalizes testnet only when Registry root matches complete Cardano evidence", () => {
  const evidenceBundle = fullBundle();
  const evidence = buildFinalizedTestnetEvidence(evidenceBundle, 3, NOW);
  const stateRoot = buildProtocolStateRoot(evidenceBundle.checkpoint).root;
  const registry = {
    deploymentEpoch: 3, registryNonce: 12, stateRoot, riskRoot: hex64(700), operatorRoot: hex64(701), settlementRoot: hex64(702), migrationRoot: hex64(703),
    reviewRoot: hex64(704), recoveryRoot: hex64(705), economicsRoot: hex64(706), oraclePolicyRoot: hex64(707), disputeRoot: hex64(708), accountabilityRoot: hex64(709), invariantRoot: hex64(710), upgradeRecoveryRoot: hex64(711),
    livenessRoot: hex64(712), testnetRoot: evidence.root, oracleRound: 20, fundingRound: 19, paused: false
  };
  const bundle = { previousV10Digest: hex64(713), registry, evidence: evidenceBundle, reviewerApprovals: ["reviewer-a","reviewer-b","reviewer-c"], issuedAt: new Date(NOW - 1_000).toISOString(), expiresAt: new Date(NOW + 3_600_000).toISOString() };
  const result = finalizeCardanoPreprodTestnet({ bundle, minimumReviewers: 3, minimumLifecycleConfirmations: 3, nowMs: NOW });
  assert.equal(result.testnetFinalized, true);
  assert.equal(result.mainnetActivationAllowed, false);
  assert.equal(result.networkMagic, 1);
  assert.throws(() => finalizeCardanoPreprodTestnet({ bundle: { ...bundle, registry: { ...registry, testnetRoot: hex64(999) } }, minimumReviewers: 3, minimumLifecycleConfirmations: 3, nowMs: NOW }), /testnet root/);
});

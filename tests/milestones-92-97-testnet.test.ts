import assert from "node:assert/strict";
import test from "node:test";
import { validateTestnetPerpLifecycle } from "../lib/testnet-perp-lifecycle";
import { validateTestnetOptionsLifecycle } from "../lib/testnet-options-lifecycle";
import { validateTestnetNotionalLifecycle } from "../lib/testnet-notional-lifecycle";
import { validateTestnetOperatorManifest } from "../lib/testnet-operator-bindings";
import { validateTestnetFinality } from "../lib/testnet-finality-reconciliation";
import { reconcileTestnetIndexer } from "../lib/testnet-indexer-reconciliation";
import { validateCardanoTestnetProfile, CARDANO_PREPROD_PROFILE } from "../lib/cardano-testnet-profile";
import { parameterDigest } from "../lib/testnet-deployment-manifest";
import type { TestnetActionReceipt } from "../lib/testnet-lifecycle-core";

const NOW = new Date("2026-09-14T11:50:00.000Z").getTime();
const h = (c: string) => c.repeat(64);
const address = "addr_test1qtestwallet000000000000000000000000000000000000000000";

function receipts(actions: TestnetActionReceipt["action"][], seed = 1): TestnetActionReceipt[] {
  return actions.map((action, i) => ({
    action,
    txHash: ((seed + i) % 15 + 1).toString(16).repeat(64).slice(0,64),
    blockHash: ((seed + i + 5) % 15 + 1).toString(16).repeat(64).slice(0,64),
    slot: 1200 + seed * 20 + i,
    confirmations: 8,
    planDigest: ((seed + i + 1) % 15 + 1).toString(16).repeat(64).slice(0,64),
    builderReceiptDigest: ((seed + i + 2) % 15 + 1).toString(16).repeat(64).slice(0,64),
    stateRootBefore: ((seed + i + 3) % 15 + 1).toString(16).repeat(64).slice(0,64),
    stateRootAfter: ((seed + i + 4) % 15 + 1).toString(16).repeat(64).slice(0,64),
    observedAt: new Date(NOW - 10_000).toISOString()
  })).map((receipt, i, all) => i === 0 ? receipt : { ...receipt, stateRootBefore: all[i - 1].stateRootAfter });
}

test("92 canonical Preprod perpetual lifecycle proves close and liquidation paths", () => {
  const actions = ["DEPOSIT_COLLATERAL","OPEN_PERP","APPLY_FUNDING","CLOSE_PERP","OPEN_PERP","LIQUIDATE_PERP","WITHDRAW_COLLATERAL"] as const;
  const result = validateTestnetPerpLifecycle({ market: "BTC-USD", collateralAssetUnit: "lovelace", receipts: receipts([...actions], 1) }, 3, NOW);
  assert.equal(result.transactionCount, 7);
  assert.match(result.root, /^[0-9a-f]{64}$/);
});

test("93 options lifecycle conserves collateral through settlement", () => {
  const actions = ["WRITE_OPTION","BUY_OPTION","SETTLE_OPTION","CLOSE_OPTION"] as const;
  const result = validateTestnetOptionsLifecycle({ seriesId: "btc-call-2026-01", underlying: "BTC-USD", expiryMs: NOW - 1_000, receipts: receipts([...actions], 20), lockedCollateralUnits: "1000", buyerPayoutUnits: "250", writerResidualUnits: "740", protocolFeeUnits: "10" }, 3, NOW);
  assert.equal(result.lockedCollateralUnits, "1000");
  assert.throws(() => validateTestnetOptionsLifecycle({ seriesId: "btc-call-2026-01", underlying: "BTC-USD", expiryMs: NOW, receipts: receipts([...actions], 20), lockedCollateralUnits: "1000", buyerPayoutUnits: "250", writerResidualUnits: "750", protocolFeeUnits: "10" }, 3, NOW), /conserve/);
});

test("94 Notional lifecycle proves fill and independent cancel without breaking user limit", () => {
  const actions = ["COMMIT_NOTIONAL","FILL_NOTIONAL","COMMIT_NOTIONAL","CANCEL_NOTIONAL"] as const;
  const result = validateTestnetNotionalLifecycle({ market: "BTC-USD", receipts: receipts([...actions], 40), fill: { side: "BUY", limitPrice: "100", executionPrice: "99.5", winningSolverId: "solver-a", competingSolverCount: 3, solverFeeBps: 20 } }, 3, NOW);
  assert.equal(result.transactionCount, 4);
  assert.throws(() => validateTestnetNotionalLifecycle({ market: "BTC-USD", receipts: receipts([...actions], 40), fill: { side: "BUY", limitPrice: "100", executionPrice: "101", winningSolverId: "solver-a", competingSolverCount: 3, solverFeeBps: 20 } }, 3, NOW), /above committed limit/);
});

test("95 Preprod operator manifest requires role and infrastructure diversity", () => {
  const operators = [
    ["gov-a","GOVERNOR","1","g1","eu"],["guardian-a","GUARDIAN","2","g2","us"],["oracle-a","ORACLE","3","oa","eu"],["oracle-b","ORACLE","4","ob","us"],
    ["keeper-a","KEEPER","5","ka","eu"],["keeper-b","KEEPER","6","kb","us"],["solver-a","SOLVER","7","sa","eu"],["solver-b","SOLVER","8","sb","us"],["builder-a","BUILDER","9","ba","eu"]
  ] as const;
  const manifest = {
    network: "preprod" as const, operatorEpoch: 1,
    operators: operators.map(([operatorId,role,c,infrastructureGroup,region]) => ({ operatorId, role, verificationKeyHash: c.repeat(56), infrastructureGroup, region, active: true })),
    oracleSources: [
      { sourceId: "price-a", signerVerificationKeyHash: "a".repeat(56), providerGroup: "feed-a", market: "BTC-USD", endpoint: "https://oracle-a.example.test", weight: 50 },
      { sourceId: "price-b", signerVerificationKeyHash: "b".repeat(56), providerGroup: "feed-b", market: "BTC-USD", endpoint: "https://oracle-b.example.test", weight: 50 }
    ],
    generatedAt: new Date(NOW - 1000).toISOString()
  };
  const result = validateTestnetOperatorManifest(manifest, NOW);
  assert.match(result.root, /^[0-9a-f]{64}$/);
  assert.equal(result.operators.length, 9);
});

function deployment() {
  const names = ["collateral","perpetual","options","notional","registry"] as const;
  const profile = validateCardanoTestnetProfile(CARDANO_PREPROD_PROFILE);
  return { network: "preprod" as const, networkMagic: 1 as const, profileRoot: profile.root, blueprintSha256: h("a"), parameterSchemaSha256: h("b"), deployedByAddress: address,
    validators: names.map((name,i) => { const tx = (i + 1).toString(16).repeat(64).slice(0,64); const params = ["00",`0${i + 1}`]; return { name, blueprintTitle: `${name}.${name}.spend`, parameterCborHex: params, parameterDigest: parameterDigest(params), sourceCompiledCodeDigest: h("c"), appliedScriptHash: (i+1).toString(16).repeat(56).slice(0,56), address, referenceScriptUtxo: `${tx}#0`, deploymentTxHash: tx, deploymentSlot: 900 + i }; }), generatedAt: new Date(NOW - 1000).toISOString() };
}

function proof(txHash: string, slot: number, referenceScriptHash?: string) {
  return { network: "preprod" as const, txHash, blockHash: "f".repeat(64), slot, blockHeight: 1000, txIndex: 0, confirmations: 8, tipSlot: 2000, observedAt: new Date(NOW - 1000).toISOString(), inputRefs: [{ txHash: "e".repeat(64), outputIndex: 0 }], outputRefs: [{ txHash, outputIndex: 0 }], referenceInputRefs: [], referenceScripts: referenceScriptHash ? [{ ref: { txHash, outputIndex: 0 }, scriptHash: referenceScriptHash }] : [] };
}

test("96 finality proves all five reference scripts and stable lifecycle transactions", () => {
  const manifest = deployment();
  const deploymentConfirmations = manifest.validators.map((v) => proof(v.deploymentTxHash, v.deploymentSlot, v.appliedScriptHash));
  const lifecycleHashes = [h("9"),h("8")];
  const result = validateTestnetFinality({ manifest, bundle: { deploymentConfirmations, lifecycleConfirmations: [proof(lifecycleHashes[0],1200),proof(lifecycleHashes[1],1210)], currentTipSlot: 2000 }, policy: { minimumConfirmations: 3, stabilityWindowSlots: 20, maximumObservationAgeMs: 60_000 }, requiredLifecycleTxHashes: lifecycleHashes, nowMs: NOW });
  assert.equal(result.stable, true);
  assert.equal(result.deploymentCount, 5);
});

test("97 indexer state must exactly match canonical protocol checkpoint UTxOs", () => {
  const checkpoint = { deploymentEpoch: 2, registryNonce: 4, oracleRound: 10, fundingRound: 9, leaves: [
    { product: "COLLATERAL" as const, stateId: "acct-state-1", utxoRef: `${h("a")}#0`, ownerOrMarket: "account-a", nonce: 1, valueDigest: h("b") },
    { product: "PERPETUAL" as const, stateId: "perp-state-1", utxoRef: `${h("c")}#0`, ownerOrMarket: "BTC-USD", nonce: 2, valueDigest: h("d") }
  ], accounting: { custodyUnits: "10000", insuranceUnits: "2000", userEquityLiabilityUnits: "6000", pendingWithdrawalUnits: "500", badDebtUnits: "0", lockedPerpMarginUnits: "2000", lockedOptionCollateralUnits: "0", optionPayoutLiabilityUnits: "0", notionalEscrowUnits: "500" }, generatedAt: new Date(NOW - 1000).toISOString() };
  const refs = checkpoint.leaves.map((leaf) => leaf.utxoRef);
  const result = reconcileTestnetIndexer({ checkpoint, observations: [
    { providerId: "indexer-a", tipSlot: 2000, indexedSlot: 1998, stateUtxoRefs: refs, observedAt: new Date(NOW - 1000).toISOString() },
    { providerId: "indexer-b", tipSlot: 2000, indexedSlot: 1999, stateUtxoRefs: refs, observedAt: new Date(NOW - 1000).toISOString() }
  ], policy: { maximumLagSlots: 5, maximumObservationAgeMs: 60_000, minimumIndependentIndexers: 2 }, nowMs: NOW });
  assert.equal(result.reconciled, true);
  assert.equal(result.indexerCount, 2);
});

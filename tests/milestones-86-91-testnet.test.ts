import assert from "node:assert/strict";
import test from "node:test";
import { CARDANO_PREPROD_PROFILE, validateCardanoTestnetProfile } from "../lib/cardano-testnet-profile";
import { reconcileTestnetSnapshots, validateTestnetProviderConfig } from "../lib/testnet-provider-reconciliation";
import { runPreprodWalletPreflight } from "../lib/testnet-wallet-preflight";
import { parameterDigest, validateTestnetDeploymentManifest } from "../lib/testnet-deployment-manifest";
import { validateTestnetTransactionPlan } from "../lib/testnet-transaction-plan";
import { validateTestnetBuilderResponse } from "../lib/testnet-builder-gateway";

const NOW = new Date("2026-09-14T11:45:00.000Z").getTime();
const h = (c: string) => c.repeat(64);
const sh = (c: string) => c.repeat(56);
const address = "addr_test1qtestwallet000000000000000000000000000000000000000000";
const ref = (c: string, index = 0) => `${h(c)}#${index}`;

test("86 binds finalized network to Cardano Preprod magic 1", () => {
  const profile = validateCardanoTestnetProfile(CARDANO_PREPROD_PROFILE);
  assert.equal(profile.networkMagic, 1);
  assert.equal(profile.cip30NetworkId, 0);
  assert.match(profile.root, /^[0-9a-f]{64}$/);
  assert.throws(() => validateCardanoTestnetProfile({ ...CARDANO_PREPROD_PROFILE, networkMagic: 2 as 1 }), /magic/);
});

test("87 reconciles independent Preprod providers on one UTxO view", () => {
  validateTestnetProviderConfig({ id: "blockfrost-a", kind: "BLOCKFROST", role: "READ", endpoint: "https://cardano-preprod.blockfrost.io/api/v0", providerGroup: "blockfrost", region: "eu" });
  const utxos = [{ txHash: h("a"), outputIndex: 0, address, lovelace: "5000000" }];
  const snapshots = [
    { providerId: "provider-a", providerGroup: "group-a", address, tipSlot: 1000, tipBlockHash: h("1"), observedAt: new Date(NOW - 1000).toISOString(), utxos },
    { providerId: "provider-b", providerGroup: "group-b", address, tipSlot: 1001, tipBlockHash: h("2"), observedAt: new Date(NOW - 1000).toISOString(), utxos }
  ];
  const result = reconcileTestnetSnapshots(snapshots, { minimumProviders: 2, minimumIndependentGroups: 2, maximumTipSkewSlots: 5, maximumObservationAgeMs: 60_000 }, NOW);
  assert.equal(result.providerCount, 2);
  assert.equal(result.independentGroups, 2);
});

test("88 rejects non-Preprod CIP-30 wallet and accepts funded testnet wallet", async () => {
  const api = {
    async getNetworkId() { return 0; },
    async getChangeAddress() { return "a100"; },
    async getUtxos(_amount?: string, page?: { page: number; limit: number }) { return page?.page === 0 ? ["a100"] : []; },
    async getBalance() { return "1a00"; },
    async signTx() { return "a100"; },
    async submitTx() { return h("f"); }
  };
  const evidence = await runPreprodWalletPreflight(api, { requireUtxos: true, maximumUtxoPages: 2, pageSize: 10 }, NOW);
  assert.equal(evidence.networkId, 0);
  assert.equal(evidence.utxoCount, 1);
  await assert.rejects(() => runPreprodWalletPreflight({ ...api, getNetworkId: async () => 1 }, { requireUtxos: false, maximumUtxoPages: 1, pageSize: 10 }, NOW), /Preprod/);
});

function deploymentManifest() {
  const names = ["collateral","perpetual","options","notional","registry"] as const;
  const profile = validateCardanoTestnetProfile(CARDANO_PREPROD_PROFILE);
  return {
    network: "preprod" as const,
    networkMagic: 1 as const,
    profileRoot: profile.root,
    blueprintSha256: h("b"),
    parameterSchemaSha256: h("c"),
    deployedByAddress: address,
    validators: names.map((name, i) => {
      const tx = (i + 1).toString(16).repeat(64).slice(0,64);
      const params = ["00", `0${i + 1}`];
      return { name, blueprintTitle: `${name}.${name}.spend`, parameterCborHex: params, parameterDigest: parameterDigest(params), sourceCompiledCodeDigest: h("d"), appliedScriptHash: (i + 1).toString(16).repeat(56).slice(0,56), address, referenceScriptUtxo: `${tx}#0`, deploymentTxHash: tx, deploymentSlot: 900 + i };
    }),
    generatedAt: new Date(NOW - 5000).toISOString()
  };
}

test("89 deployment manifest binds five applied validators and reference UTxOs", () => {
  const result = validateTestnetDeploymentManifest(deploymentManifest(), NOW);
  assert.equal(result.validators.length, 5);
  assert.match(result.root, /^[0-9a-f]{64}$/);
  const bad = deploymentManifest(); bad.validators[0].referenceScriptUtxo = ref("e");
  assert.throws(() => validateTestnetDeploymentManifest(bad, NOW), /created by/);
});

test("90 strict transaction plan rejects consumed/reference overlap", () => {
  const plan = {
    planId: "perp-open-0001", network: "preprod" as const, networkMagic: 1 as const, action: "OPEN_PERP" as const,
    stateRootBefore: h("a"), inputRefs: [ref("1")], referenceInputRefs: [ref("2")], collateralInputRefs: [ref("3")],
    outputs: [{ address, values: [{ unit: "lovelace", quantity: "3000000" }], inlineDatumCborHex: "00" }],
    requiredSignerHashes: [sh("a")], redeemerCborHex: "00", validityStartSlot: 1000, validityEndSlot: 1100,
    feeLovelace: "200000", changeAddress: address, createdAt: new Date(NOW - 1000).toISOString()
  };
  const valid = validateTestnetTransactionPlan(plan, NOW);
  assert.match(valid.digest, /^[0-9a-f]{64}$/);
  assert.throws(() => validateTestnetTransactionPlan({ ...plan, referenceInputRefs: [ref("1")] }, NOW), /cannot also be consumed/);
});

test("91 builder response is cryptographically bound to exact Preprod plan digest", () => {
  const config = { endpoint: "https://builder.example.test/build", builderId: "builder-a", timeoutMs: 10_000, expectedNetworkMagic: 1 as const };
  const result = validateTestnetBuilderResponse({ builderId: "builder-a", planDigest: h("a"), network: "preprod", networkMagic: 1, unsignedTxCborHex: "a100", txBodyHash: h("b"), evaluated: true, exUnitsDigest: h("c"), builtAt: new Date(NOW - 1000).toISOString() }, h("a"), config, NOW);
  assert.match(result.receiptDigest, /^[0-9a-f]{64}$/);
  assert.throws(() => validateTestnetBuilderResponse({ builderId: "builder-a", planDigest: h("d"), network: "preprod", networkMagic: 1, unsignedTxCborHex: "a100", txBodyHash: h("b"), evaluated: true, builtAt: new Date(NOW).toISOString() }, h("a"), config, NOW), /different transaction plan/);
});

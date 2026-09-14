import assert from "node:assert/strict";
import test from "node:test";
import {
  executePreparedTransaction,
  TransactionRequestRegistry,
  validatePreparedTransaction,
  type Cip30WalletApi,
  type PreparedCardanoTransaction
} from "../lib/cardano-execution";
import { aggregateOracleQuorum } from "../lib/oracle-quorum";
import { authorizeOptionSettlement, commitOptionSettlement, OptionSettlementRegistry } from "../lib/options-lifecycle";
import { buildLiquidationJob, KeeperJobRegistry } from "../lib/keepers";
import { evaluateDeploymentReadiness } from "../lib/deployment";
import { emptyIndexerSnapshot, reduceIndexerSnapshot } from "../lib/chain-indexer";
import { validateCollateralTransition, validatePerpPositionTransition } from "../lib/validator-rules";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const SCRIPT_HASH = "c".repeat(56);

function prepared(nowMs = 1_000_000): PreparedCardanoTransaction {
  return {
    requestId: "perp-order-0001",
    network: "preprod",
    unsignedTxCborHex: "a100",
    createdAt: new Date(nowMs - 1_000).toISOString(),
    expiresAt: new Date(nowMs + 60_000).toISOString(),
    intentHash: HASH_A
  };
}

test("prepared Cardano execution signs witnesses, assembles and submits once", async () => {
  const calls: string[] = [];
  const wallet: Cip30WalletApi = {
    async getNetworkId() { return 0; },
    async getChangeAddress() { return "00"; },
    async getUtxos() { return []; },
    async getBalance() { return "00"; },
    async signTx(tx) { calls.push(`sign:${tx}`); return "a101"; },
    async submitTx(tx) { calls.push(`submit:${tx}`); return HASH_B; }
  };
  const registry = new TransactionRequestRegistry();
  const tx = prepared();
  const receipt = await executePreparedTransaction({
    api: wallet,
    prepared: tx,
    registry,
    nowMs: 1_000_000,
    assembleSignedTransaction: async ({ unsignedTxCborHex, witnessSetCborHex }) => {
      calls.push(`assemble:${unsignedTxCborHex}:${witnessSetCborHex}`);
      return "a102";
    }
  });
  assert.equal(receipt.txHash, HASH_B);
  assert.deepEqual(calls, ["sign:a100", "assemble:a100:a101", "submit:a102"]);
  await assert.rejects(() => executePreparedTransaction({
    api: wallet,
    prepared: tx,
    registry,
    nowMs: 1_000_001,
    assembleSignedTransaction: async () => "a102"
  }), /already consumed/);
});

test("prepared transactions fail closed on expiry and network mismatch", async () => {
  assert.throws(() => validatePreparedTransaction(prepared(), 2_000_000), /expired/);
  const wallet: Cip30WalletApi = {
    async getNetworkId() { return 1; },
    async getChangeAddress() { return "00"; },
    async getUtxos() { return []; },
    async getBalance() { return "00"; },
    async signTx() { return "a101"; },
    async submitTx() { return HASH_B; }
  };
  await assert.rejects(() => executePreparedTransaction({
    api: wallet,
    prepared: prepared(),
    nowMs: 1_000_000,
    assembleSignedTransaction: async () => "a102"
  }), /network mismatch/);
});

test("oracle quorum uses independent fresh sources and rejects divergence", () => {
  const nowMs = 1_000_000;
  const result = aggregateOracleQuorum({
    nowMs,
    samples: [
      { source: "oracle-a", price: 60_000, timestampMs: nowMs - 1_000, confidenceBps: 20 },
      { source: "oracle-b", price: 60_030, timestampMs: nowMs - 900, confidenceBps: 15 },
      { source: "oracle-c", price: 80_000, timestampMs: nowMs - 800, confidenceBps: 10 }
    ]
  });
  assert.equal(result.sourceCount, 2);
  assert(result.price >= 60_000 && result.price <= 60_030);
  assert.throws(() => aggregateOracleQuorum({
    nowMs,
    samples: [
      { source: "oracle-a", price: 60_000, timestampMs: nowMs - 1_000 },
      { source: "oracle-b", price: 80_000, timestampMs: nowMs - 1_000 }
    ]
  }), /diverged/);
});

test("option settlement requires expiry, quorum pricing and one-time consumption", () => {
  const nowMs = new Date("2026-10-01T00:00:02.000Z").getTime();
  const registry = new OptionSettlementRegistry();
  const record = authorizeOptionSettlement({
    series: {
      underlying: "BTC",
      kind: "CALL",
      strike: 65_000,
      expiry: "2026-10-01T00:00:00.000Z",
      contractSize: 1,
      settlementAsset: "USDM"
    },
    holder: "addr_test1holder",
    contracts: 2,
    nowMs,
    registry,
    oracleSamples: [
      { source: "oracle-a", price: 70_000, timestampMs: nowMs - 500 },
      { source: "oracle-b", price: 70_020, timestampMs: nowMs - 400 }
    ]
  });
  assert(record.payout > 9_900);
  commitOptionSettlement(registry, record);
  assert.throws(() => commitOptionSettlement(registry, record), /already consumed/);
});

test("keeper liquidation jobs require unsafe state and fresh oracle quorum", () => {
  const nowMs = 1_000_000;
  const registry = new KeeperJobRegistry();
  const position = {
    id: "btc-long",
    market: "BTC-USD",
    side: "LONG" as const,
    entryPrice: 60_000,
    markPrice: 49_000,
    sizeUsd: 10_000,
    leverage: 10
  };
  const job = buildLiquidationJob({
    account: "addr_test1account",
    position,
    accountEquityUsd: 100,
    accountMaintenanceMarginUsd: 500,
    nowMs,
    registry,
    oracleSamples: [
      { source: "oracle-a", price: 49_000, timestampMs: nowMs - 500 },
      { source: "oracle-b", price: 49_020, timestampMs: nowMs - 400 }
    ]
  });
  assert(job.closeNotionalUsd > 0);
  assert.equal(job.oracleSources.length, 2);
});

test("indexer reducer deduplicates events and never moves slot backwards", () => {
  const initial = emptyIndexerSnapshot();
  const event = { id: "event-1", txHash: HASH_A, market: "BTC-USD", type: "PERP_OPEN" as const, account: "addr_test1a", timestamp: "2026-09-14T00:00:00Z" };
  const next = reduceIndexerSnapshot(initial, {
    slot: 100,
    transaction: { txHash: HASH_A, state: "CONFIRMED", slot: 100, updatedAt: "2026-09-14T00:00:00Z" },
    events: [event, event]
  });
  assert.equal(next.events.length, 1);
  assert.throws(() => reduceIndexerSnapshot(next, { slot: 99 }), /backwards/);
});

test("deployment readiness remains false until every execution dependency exists", () => {
  const notReady = evaluateDeploymentReadiness({ network: "preprod", oracleSources: [], validators: [] });
  assert.equal(notReady.ready, false);
  const ready = evaluateDeploymentReadiness({
    network: "preprod",
    providerEndpoint: "https://provider.example",
    indexerEndpoint: "https://indexer.example",
    transactionBuilderEndpoint: "https://builder.example",
    oracleSources: ["oracle-a", "oracle-b"],
    validators: [
      { name: "collateral", address: `addr_test1${"q".repeat(40)}`, scriptHash: SCRIPT_HASH },
      { name: "perpetual", address: `addr_test1${"w".repeat(40)}`, scriptHash: SCRIPT_HASH },
      { name: "options", address: `addr_test1${"e".repeat(40)}`, scriptHash: SCRIPT_HASH }
    ]
  });
  assert.equal(ready.ready, true);
});

test("validator mirror rules enforce signer, nonce and transition identity", () => {
  assert.equal(validateCollateralTransition({
    before: { account: "owner", asset: "USDM", amount: 100n, nonce: 1n },
    after: { account: "owner", asset: "USDM", amount: 150n, nonce: 2n },
    signer: "owner",
    action: "DEPOSIT"
  }), true);
  assert.throws(() => validateCollateralTransition({
    before: { account: "owner", asset: "USDM", amount: 100n, nonce: 1n },
    after: { account: "owner", asset: "USDM", amount: 150n, nonce: 3n },
    signer: "owner",
    action: "DEPOSIT"
  }), /nonce/);

  assert.equal(validatePerpPositionTransition({
    signer: "owner",
    action: "OPEN",
    after: { account: "owner", market: "BTC-USD", side: "LONG", sizeUsd: 1_000, collateralUsd: 200, entryPrice: 60_000, nonce: 0n }
  }), true);
});

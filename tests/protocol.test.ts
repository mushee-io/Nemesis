import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFundingPayment,
  calculateFundingRate,
  calculatePerp,
  calculateTradingFee,
  validatePerpOrder
} from "../lib/perps";
import {
  optionIntrinsicValue,
  requiredWriterCollateral,
  settleEuropeanOption
} from "../lib/options";
import {
  createIntentCommitment,
  NonceRegistry,
  randomSalt,
  verifyIntentReveal,
  type HiddenIntent
} from "../lib/notional";
import { evaluatePortfolioRisk } from "../lib/risk";
import { validateOracleSample } from "../lib/protocol";
import { buildQuoteLadder } from "../lib/market-maker";

test("perpetual engine calculates pnl, funding and fees", () => {
  const position = calculatePerp({
    side: "LONG",
    entryPrice: 60_000,
    markPrice: 66_000,
    sizeUsd: 6_000,
    leverage: 6
  });
  assert.equal(position.initialMargin, 1_000);
  assert.equal(Math.round(position.unrealizedPnl), 600);
  assert.equal(position.liquidatable, false);

  const rate = calculateFundingRate({ markPrice: 60_120, indexPrice: 60_000, intervalHours: 8 });
  assert(rate > 0);
  assert(calculateFundingPayment({ side: "LONG", positionNotionalUsd: 10_000, fundingRate: rate }) < 0);
  assert(calculateFundingPayment({ side: "SHORT", positionNotionalUsd: 10_000, fundingRate: rate }) > 0);
  assert.equal(calculateTradingFee(10_000, "TAKER"), 6);
});

test("perpetual validation enforces leverage caps", () => {
  assert.throws(() => validatePerpOrder({
    market: "BTC-USD",
    side: "LONG",
    type: "MARKET",
    sizeUsd: 1_000,
    leverage: 21
  }), /Leverage exceeds/);
});

test("options engine handles collateral and expiry settlement", () => {
  assert.equal(optionIntrinsicValue("CALL", 70_000, 65_000), 5_000);
  assert.deepEqual(requiredWriterCollateral({ kind: "PUT", strike: 65_000, contracts: 2 }), {
    asset: "SETTLEMENT",
    amount: 130_000
  });

  const result = settleEuropeanOption({
    series: {
      underlying: "BTC",
      kind: "CALL",
      strike: 65_000,
      expiry: "2026-10-01T00:00:00.000Z",
      contractSize: 1,
      settlementAsset: "USDM"
    },
    contracts: 2,
    settlementPrice: 70_000,
    now: "2026-10-01T00:00:01.000Z"
  });
  assert.equal(result.payout, 10_000);
});

test("Notional commitments verify and nonce registry rejects replay", async () => {
  const intent: HiddenIntent = {
    market: "BTC-USD",
    side: "BUY",
    size: "1",
    limitPrice: "60000",
    expiry: new Date(Date.now() + 60_000).toISOString(),
    nonce: "0123456789abcdef0123456789abcdef",
    chainId: "cardano-preprod",
    maxSlippageBps: 50
  };
  const salt = randomSalt();
  const commitment = await createIntentCommitment(intent, salt);
  assert.equal(await verifyIntentReveal({ intent, salt, commitment }), true);

  const registry = new NonceRegistry();
  registry.consume(intent.nonce);
  assert.equal(registry.has(intent.nonce), true);
  assert.throws(() => registry.consume(intent.nonce), /already consumed/);
});

test("portfolio engine aggregates cross-position risk", () => {
  const risk = evaluatePortfolioRisk({
    collateralUsd: 5_000,
    positions: [
      { id: "a", market: "BTC-USD", side: "LONG", entryPrice: 60_000, markPrice: 61_000, sizeUsd: 6_000, leverage: 3 },
      { id: "b", market: "ETH-USD", side: "SHORT", entryPrice: 3_000, markPrice: 2_900, sizeUsd: 3_000, leverage: 3 }
    ],
    reservedOptionCollateralUsd: 500
  });
  assert(risk.equityUsd > 5_000);
  assert(risk.healthFactor > 1);
  assert.equal(risk.liquidatable, false);
});

test("oracle guard rejects stale and divergent samples", () => {
  const now = 1_000_000;
  assert.equal(validateOracleSample({
    primary: { price: 60_000, timestampMs: now - 1_000, confidenceBps: 20 },
    reference: { price: 60_050, timestampMs: now - 1_000 },
    nowMs: now
  }), 60_000);

  assert.throws(() => validateOracleSample({
    primary: { price: 60_000, timestampMs: now - 60_000 },
    nowMs: now
  }), /stale/);
});

test("market maker ladder respects inventory skew and ordered quotes", () => {
  const neutral = buildQuoteLadder({ midPrice: 60_000, inventoryUsd: 0 });
  const longInventory = buildQuoteLadder({ midPrice: 60_000, inventoryUsd: 200_000 });
  assert.equal(neutral.length, 5);
  assert(neutral[0].bid < neutral[0].ask);
  assert(longInventory[0].bid < neutral[0].bid);
});

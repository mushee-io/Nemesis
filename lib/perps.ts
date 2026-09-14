export type PerpSide = "LONG" | "SHORT";
export type PerpOrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT";

export type PerpInput = {
  side: PerpSide;
  entryPrice: number;
  markPrice: number;
  sizeUsd: number;
  leverage: number;
  maintenanceMarginRatio?: number;
};

export type PerpMarketConfig = {
  market: string;
  maxLeverage: number;
  maintenanceMarginRatio: number;
  makerFeeBps: number;
  takerFeeBps: number;
  maxOpenInterestUsd: number;
  maxPositionUsd: number;
  fundingClampHourly: number;
};

export type PerpOrder = {
  market: string;
  side: PerpSide;
  type: PerpOrderType;
  sizeUsd: number;
  leverage: number;
  limitPrice?: number;
  triggerPrice?: number;
  reduceOnly?: boolean;
};

export const DEFAULT_PERP_MARKET: PerpMarketConfig = {
  market: "BTC-USD",
  maxLeverage: 20,
  maintenanceMarginRatio: 0.05,
  makerFeeBps: 2,
  takerFeeBps: 6,
  maxOpenInterestUsd: 5_000_000,
  maxPositionUsd: 250_000,
  fundingClampHourly: 0.0005
};

function positive(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
}

export function calculatePerp(input: PerpInput) {
  const { side, entryPrice, markPrice, sizeUsd, leverage } = input;
  const mmr = input.maintenanceMarginRatio ?? 0.05;
  [
    ["entryPrice", entryPrice],
    ["markPrice", markPrice],
    ["sizeUsd", sizeUsd],
    ["leverage", leverage]
  ].forEach(([name, value]) => positive(String(name), Number(value)));
  if (mmr <= 0 || mmr >= 1) throw new Error("Invalid maintenance margin ratio");

  const quantity = sizeUsd / entryPrice;
  const initialMargin = sizeUsd / leverage;
  const direction = side === "LONG" ? 1 : -1;
  const unrealizedPnl = direction * quantity * (markPrice - entryPrice);
  const equity = initialMargin + unrealizedPnl;
  const currentNotional = quantity * markPrice;
  const maintenanceMargin = currentNotional * mmr;
  const marginRatio = currentNotional ? equity / currentNotional : 0;
  const marginPerUnit = initialMargin / quantity;
  const liquidationPrice = side === "LONG"
    ? Math.max(0, (entryPrice - marginPerUnit) / (1 - mmr))
    : (entryPrice + marginPerUnit) / (1 + mmr);

  return {
    quantity,
    initialMargin,
    unrealizedPnl,
    equity,
    currentNotional,
    maintenanceMargin,
    marginRatio,
    returnOnMargin: unrealizedPnl / initialMargin,
    liquidationPrice,
    liquidatable: equity <= maintenanceMargin
  };
}

export function calculateFundingRate(input: {
  markPrice: number;
  indexPrice: number;
  intervalHours?: number;
  clampHourly?: number;
}) {
  positive("markPrice", input.markPrice);
  positive("indexPrice", input.indexPrice);
  const hours = input.intervalHours ?? 8;
  positive("intervalHours", hours);
  const hourlyClamp = input.clampHourly ?? DEFAULT_PERP_MARKET.fundingClampHourly;
  if (!Number.isFinite(hourlyClamp) || hourlyClamp <= 0) throw new Error("Invalid funding clamp");

  const premium = (input.markPrice - input.indexPrice) / input.indexPrice;
  const clamp = hourlyClamp * hours;
  return Math.max(-clamp, Math.min(clamp, premium));
}

export function calculateFundingPayment(input: {
  side: PerpSide;
  positionNotionalUsd: number;
  fundingRate: number;
}) {
  positive("positionNotionalUsd", input.positionNotionalUsd);
  if (!Number.isFinite(input.fundingRate)) throw new Error("Invalid funding rate");
  const direction = input.side === "LONG" ? -1 : 1;
  return direction * input.positionNotionalUsd * input.fundingRate;
}

export function calculateTradingFee(sizeUsd: number, liquidity: "MAKER" | "TAKER", config = DEFAULT_PERP_MARKET) {
  positive("sizeUsd", sizeUsd);
  const bps = liquidity === "MAKER" ? config.makerFeeBps : config.takerFeeBps;
  return sizeUsd * bps / 10_000;
}

export function validatePerpOrder(order: PerpOrder, config = DEFAULT_PERP_MARKET) {
  if (order.market.trim().toUpperCase() !== config.market) throw new Error("Unsupported market");
  positive("sizeUsd", order.sizeUsd);
  positive("leverage", order.leverage);
  if (order.leverage > config.maxLeverage) throw new Error(`Leverage exceeds ${config.maxLeverage}x market limit`);
  if (order.sizeUsd > config.maxPositionUsd) throw new Error("Position exceeds market size limit");
  if (order.type === "LIMIT") positive("limitPrice", order.limitPrice ?? 0);
  if (order.type === "STOP_MARKET" || order.type === "TAKE_PROFIT") positive("triggerPrice", order.triggerPrice ?? 0);
  return true;
}

export function shouldTriggerConditionalOrder(order: PerpOrder, markPrice: number) {
  positive("markPrice", markPrice);
  validatePerpOrder(order);
  if (order.type === "MARKET" || order.type === "LIMIT") return false;
  const trigger = order.triggerPrice as number;
  if (order.type === "STOP_MARKET") return order.side === "LONG" ? markPrice >= trigger : markPrice <= trigger;
  return order.side === "LONG" ? markPrice <= trigger : markPrice >= trigger;
}

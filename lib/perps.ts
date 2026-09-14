export type PerpSide = "LONG" | "SHORT";

export type PerpInput = {
  side: PerpSide;
  entryPrice: number;
  markPrice: number;
  sizeUsd: number;
  leverage: number;
  maintenanceMarginRatio?: number;
};

export function calculatePerp(input: PerpInput) {
  const { side, entryPrice, markPrice, sizeUsd, leverage } = input;
  const mmr = input.maintenanceMarginRatio ?? 0.05;
  if (![entryPrice, markPrice, sizeUsd, leverage].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error("Perpetual inputs must be positive numbers");
  }
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
    maintenanceMargin,
    marginRatio,
    returnOnMargin: unrealizedPnl / initialMargin,
    liquidationPrice
  };
}

export type QuoteLevel = {
  bid: number;
  ask: number;
  sizeUsd: number;
};

export type MarketMakerConfig = {
  baseSpreadBps: number;
  levels: number;
  levelSpacingBps: number;
  baseSizeUsd: number;
  maxInventoryUsd: number;
  inventorySkewBps: number;
};

export const DEFAULT_MM_CONFIG: MarketMakerConfig = {
  baseSpreadBps: 12,
  levels: 5,
  levelSpacingBps: 8,
  baseSizeUsd: 10_000,
  maxInventoryUsd: 250_000,
  inventorySkewBps: 40
};

function positive(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

export function buildQuoteLadder(input: {
  midPrice: number;
  inventoryUsd: number;
  config?: MarketMakerConfig;
}): QuoteLevel[] {
  positive("midPrice", input.midPrice);
  const config = input.config ?? DEFAULT_MM_CONFIG;
  positive("baseSpreadBps", config.baseSpreadBps);
  positive("levels", config.levels);
  positive("levelSpacingBps", config.levelSpacingBps);
  positive("baseSizeUsd", config.baseSizeUsd);
  positive("maxInventoryUsd", config.maxInventoryUsd);
  if (!Number.isInteger(config.levels) || config.levels > 50) throw new Error("Invalid quote level count");

  const normalizedInventory = Math.max(-1, Math.min(1, input.inventoryUsd / config.maxInventoryUsd));
  const skewBps = normalizedInventory * config.inventorySkewBps;
  const center = input.midPrice * (1 - skewBps / 10_000);

  return Array.from({ length: config.levels }, (_, index) => {
    const halfSpreadBps = config.baseSpreadBps / 2 + index * config.levelSpacingBps;
    const bid = center * (1 - halfSpreadBps / 10_000);
    const ask = center * (1 + halfSpreadBps / 10_000);
    const sizeMultiplier = Math.max(0.25, 1 - index * 0.12);
    return { bid, ask, sizeUsd: config.baseSizeUsd * sizeMultiplier };
  });
}

export function validateRfqQuote(input: {
  side: "BUY" | "SELL";
  requestedSizeUsd: number;
  quotedPrice: number;
  referencePrice: number;
  maxDeviationBps: number;
  expiresAtMs: number;
  nowMs?: number;
}) {
  positive("requestedSizeUsd", input.requestedSizeUsd);
  positive("quotedPrice", input.quotedPrice);
  positive("referencePrice", input.referencePrice);
  positive("maxDeviationBps", input.maxDeviationBps);
  const now = input.nowMs ?? Date.now();
  if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= now) throw new Error("RFQ quote expired");
  const deviationBps = Math.abs(input.quotedPrice - input.referencePrice) / input.referencePrice * 10_000;
  if (deviationBps > input.maxDeviationBps) throw new Error("RFQ quote exceeds deviation limit");
  if (input.side === "BUY" && input.quotedPrice <= 0) throw new Error("Invalid buy quote");
  if (input.side === "SELL" && input.quotedPrice <= 0) throw new Error("Invalid sell quote");
  return { valid: true, deviationBps };
}

export type LeverageTier = {
  maxNotionalUsd: number;
  maxLeverage: number;
};

export type MarketRiskLimits = {
  maxOpenInterestUsd: number;
  maxSkewUsd: number;
  maxPositionUsd: number;
  leverageTiers: LeverageTier[];
  minInsuranceFundUsd: number;
};

export type MarketState = {
  longOpenInterestUsd: number;
  shortOpenInterestUsd: number;
  insuranceFundUsd: number;
};

function positive(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

export function maxLeverageForNotional(notionalUsd: number, tiers: LeverageTier[]) {
  positive("notionalUsd", notionalUsd);
  const ordered = [...tiers].sort((a, b) => a.maxNotionalUsd - b.maxNotionalUsd);
  const tier = ordered.find((item) => notionalUsd <= item.maxNotionalUsd);
  if (!tier) throw new Error("Position notional exceeds configured leverage tiers");
  positive("tier max leverage", tier.maxLeverage);
  return tier.maxLeverage;
}

export function validateMarketAdmission(input: {
  side: "LONG" | "SHORT";
  positionNotionalUsd: number;
  leverage: number;
  state: MarketState;
  limits: MarketRiskLimits;
  reduceOnly?: boolean;
}) {
  positive("positionNotionalUsd", input.positionNotionalUsd);
  positive("leverage", input.leverage);
  if (input.positionNotionalUsd > input.limits.maxPositionUsd) throw new Error("Position exceeds market maximum");
  const leverageCap = maxLeverageForNotional(input.positionNotionalUsd, input.limits.leverageTiers);
  if (input.leverage > leverageCap) throw new Error("Leverage exceeds notional risk tier");

  if (input.reduceOnly) return { allowed: true, leverageCap, reduceOnly: true };
  if (input.state.insuranceFundUsd < input.limits.minInsuranceFundUsd) throw new Error("Market is reduce-only because insurance reserves are below floor");

  const nextLong = input.state.longOpenInterestUsd + (input.side === "LONG" ? input.positionNotionalUsd : 0);
  const nextShort = input.state.shortOpenInterestUsd + (input.side === "SHORT" ? input.positionNotionalUsd : 0);
  const nextOpenInterest = nextLong + nextShort;
  const nextSkew = Math.abs(nextLong - nextShort);
  if (nextOpenInterest > input.limits.maxOpenInterestUsd) throw new Error("Market open interest cap exceeded");
  if (nextSkew > input.limits.maxSkewUsd) throw new Error("Market skew cap exceeded");

  return { allowed: true, leverageCap, nextOpenInterestUsd: nextOpenInterest, nextSkewUsd: nextSkew };
}

export function applyInsuranceLoss(input: { insuranceFundUsd: number; liquidationLossUsd: number }) {
  if (![input.insuranceFundUsd, input.liquidationLossUsd].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Insurance values must be non-negative");
  }
  const coveredUsd = Math.min(input.insuranceFundUsd, input.liquidationLossUsd);
  return {
    coveredUsd,
    remainingInsuranceUsd: input.insuranceFundUsd - coveredUsd,
    badDebtUsd: input.liquidationLossUsd - coveredUsd
  };
}

export type AdlCandidate = {
  account: string;
  unrealizedProfitUsd: number;
  leverage: number;
  notionalUsd: number;
};

export function rankAdlCandidates(candidates: AdlCandidate[]) {
  return candidates
    .filter((candidate) => candidate.unrealizedProfitUsd > 0 && candidate.leverage > 0 && candidate.notionalUsd > 0)
    .map((candidate) => ({
      ...candidate,
      score: (candidate.unrealizedProfitUsd / candidate.notionalUsd) * candidate.leverage
    }))
    .sort((a, b) => b.score - a.score);
}

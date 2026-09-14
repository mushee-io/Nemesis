export type OptionKind = "CALL" | "PUT";

export type OptionSeries = {
  underlying: string;
  kind: OptionKind;
  strike: number;
  expiry: string;
  contractSize: number;
  settlementAsset: string;
};

function normalPdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normalCdf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function positive(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
}

export function priceEuropeanOption(input: {
  kind: OptionKind;
  spot: number;
  strike: number;
  daysToExpiry: number;
  volatility: number;
  rate?: number;
}) {
  const { kind, spot, strike } = input;
  const time = Math.max(input.daysToExpiry / 365, 1 / (365 * 24));
  const vol = input.volatility;
  const rate = input.rate ?? 0;
  if ([spot, strike, vol].some((x) => !Number.isFinite(x) || x <= 0)) throw new Error("Invalid option inputs");

  const sqrtT = Math.sqrt(time);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * time) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const discount = Math.exp(-rate * time);
  const call = spot * normalCdf(d1) - strike * discount * normalCdf(d2);
  const put = strike * discount * normalCdf(-d2) - spot * normalCdf(-d1);
  const delta = kind === "CALL" ? normalCdf(d1) : normalCdf(d1) - 1;
  const gamma = normalPdf(d1) / (spot * vol * sqrtT);
  const vega = spot * normalPdf(d1) * sqrtT / 100;
  const thetaCall = (-(spot * normalPdf(d1) * vol) / (2 * sqrtT) - rate * strike * discount * normalCdf(d2)) / 365;
  const thetaPut = (-(spot * normalPdf(d1) * vol) / (2 * sqrtT) + rate * strike * discount * normalCdf(-d2)) / 365;

  return { price: kind === "CALL" ? call : put, delta, gamma, vega, theta: kind === "CALL" ? thetaCall : thetaPut };
}

export function createOptionSeriesId(series: OptionSeries) {
  positive("strike", series.strike);
  positive("contractSize", series.contractSize);
  const expiry = new Date(series.expiry);
  if (!Number.isFinite(expiry.getTime())) throw new Error("Invalid option expiry");
  return [series.underlying.trim().toUpperCase(), series.kind, series.strike, expiry.toISOString(), series.contractSize, series.settlementAsset.trim().toUpperCase()].join(":");
}

export function optionIntrinsicValue(kind: OptionKind, spot: number, strike: number) {
  positive("spot", spot);
  positive("strike", strike);
  return kind === "CALL" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

export function optionBreakEven(kind: OptionKind, strike: number, premiumPerUnit: number) {
  positive("strike", strike);
  if (!Number.isFinite(premiumPerUnit) || premiumPerUnit < 0) throw new Error("Invalid premium");
  return kind === "CALL" ? strike + premiumPerUnit : Math.max(0, strike - premiumPerUnit);
}

export function requiredWriterCollateral(input: {
  kind: OptionKind;
  strike: number;
  contracts: number;
  contractSize?: number;
}) {
  positive("strike", input.strike);
  positive("contracts", input.contracts);
  const contractSize = input.contractSize ?? 1;
  positive("contractSize", contractSize);

  return input.kind === "CALL"
    ? { asset: "UNDERLYING", amount: input.contracts * contractSize }
    : { asset: "SETTLEMENT", amount: input.strike * input.contracts * contractSize };
}

export function settleEuropeanOption(input: {
  series: OptionSeries;
  contracts: number;
  settlementPrice: number;
  now?: string;
}) {
  positive("contracts", input.contracts);
  positive("settlementPrice", input.settlementPrice);
  const expiryMs = new Date(input.series.expiry).getTime();
  const nowMs = input.now ? new Date(input.now).getTime() : Date.now();
  if (!Number.isFinite(expiryMs) || !Number.isFinite(nowMs)) throw new Error("Invalid settlement time");
  if (nowMs < expiryMs) throw new Error("Option cannot settle before expiry");

  const intrinsicPerUnit = optionIntrinsicValue(input.series.kind, input.settlementPrice, input.series.strike);
  const payout = intrinsicPerUnit * input.series.contractSize * input.contracts;
  return {
    seriesId: createOptionSeriesId(input.series),
    intrinsicPerUnit,
    payout,
    expiredWorthless: payout === 0,
    settlementPrice: input.settlementPrice
  };
}

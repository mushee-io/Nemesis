export type OptionKind = "CALL" | "PUT";

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

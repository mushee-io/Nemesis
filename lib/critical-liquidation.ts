import { createHash } from "node:crypto";

export type LiquidationSide = "LONG" | "SHORT";
export type CriticalPosition = {
  positionId: string;
  account: string;
  side: LiquidationSide;
  notionalUnits: string;
  collateralUnits: string;
  equityUnits: string;
  maintenanceMarginUnits: string;
  markPrice: number;
  indexPrice: number;
};
export type LiquidationQuote = {
  keeperId: string;
  closeNotionalUnits: string;
  executionPrice: number;
  keeperFeeBps: number;
  bondUnits: string;
  submittedAt: string;
};
export type CriticalLiquidationPolicy = {
  minimumQuotes: number;
  maxCloseBps: number;
  maxPriceImpactBps: number;
  maxKeeperFeeBps: number;
  minimumKeeperBondUnits: string;
  insuranceFloorUnits: string;
  maxInsuranceDrawUnits: string;
  allowAdl: boolean;
};

function units(v: string, label: string) {
  if (!/^\d+$/.test(v)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(v);
}
function bpsDiff(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) throw new Error("Liquidation prices must be positive");
  return Math.abs(a - b) / b * 10_000;
}
export function liquidationPolicyDigest(policy: CriticalLiquidationPolicy) {
  for (const [value, label] of [[policy.maxCloseBps, "close"], [policy.maxPriceImpactBps, "impact"], [policy.maxKeeperFeeBps, "fee"]] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 10_000) throw new Error(`Invalid liquidation ${label} bps`);
  }
  if (!Number.isInteger(policy.minimumQuotes) || policy.minimumQuotes < 1) throw new Error("Invalid liquidation quote quorum");
  units(policy.minimumKeeperBondUnits, "Keeper bond"); units(policy.insuranceFloorUnits, "Insurance floor"); units(policy.maxInsuranceDrawUnits, "Insurance draw cap");
  return createHash("sha256").update([policy.minimumQuotes, policy.maxCloseBps, policy.maxPriceImpactBps, policy.maxKeeperFeeBps, policy.minimumKeeperBondUnits, policy.insuranceFloorUnits, policy.maxInsuranceDrawUnits, policy.allowAdl ? 1 : 0].join("|")).digest("hex");
}

export function buildCriticalLiquidationPlan(input: {
  position: CriticalPosition;
  quotes: LiquidationQuote[];
  policy: CriticalLiquidationPolicy;
  insuranceAvailableUnits: string;
  badDebtUnits: string;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const p = input.position;
  if (!/^[a-zA-Z0-9:_-]{4,128}$/.test(p.positionId) || !p.account.trim()) throw new Error("Invalid liquidation position identity");
  const notional = units(p.notionalUnits, "Position notional");
  const collateral = units(p.collateralUnits, "Position collateral");
  const equity = units(p.equityUnits, "Position equity");
  const maintenance = units(p.maintenanceMarginUnits, "Maintenance margin");
  if (notional <= 0n || collateral <= 0n) throw new Error("Liquidation position must have positive notional and collateral");
  if (equity > maintenance) throw new Error("Position is not liquidatable");
  if (bpsDiff(p.markPrice, p.indexPrice) > input.policy.maxPriceImpactBps) throw new Error("Mark/index divergence exceeds liquidation policy");
  const maxClose = notional * BigInt(input.policy.maxCloseBps) / 10_000n;
  if (maxClose <= 0n) throw new Error("Liquidation close cap is zero");

  const keeperIds = input.quotes.map((q) => q.keeperId);
  if (new Set(keeperIds).size !== keeperIds.length) throw new Error("Duplicate keeper quote");
  const eligible = input.quotes.filter((q) => {
    const submittedAt = new Date(q.submittedAt).getTime();
    if (!Number.isFinite(submittedAt) || Math.abs(nowMs - submittedAt) > 60_000) return false;
    const close = units(q.closeNotionalUnits, "Quote close notional");
    const bond = units(q.bondUnits, "Keeper bond");
    if (close <= 0n || close > maxClose) return false;
    if (bond < units(input.policy.minimumKeeperBondUnits, "Minimum keeper bond")) return false;
    if (!Number.isInteger(q.keeperFeeBps) || q.keeperFeeBps < 0 || q.keeperFeeBps > input.policy.maxKeeperFeeBps) return false;
    if (bpsDiff(q.executionPrice, p.markPrice) > input.policy.maxPriceImpactBps) return false;
    return true;
  });
  if (eligible.length < input.policy.minimumQuotes) throw new Error("Insufficient eligible liquidation quotes");
  const winner = eligible.slice().sort((a, b) => p.side === "LONG" ? b.executionPrice - a.executionPrice : a.executionPrice - b.executionPrice)[0];

  const badDebt = units(input.badDebtUnits, "Bad debt");
  const insurance = units(input.insuranceAvailableUnits, "Insurance available");
  const floor = units(input.policy.insuranceFloorUnits, "Insurance floor");
  const drawable = insurance > floor ? insurance - floor : 0n;
  const cappedDraw = drawable < units(input.policy.maxInsuranceDrawUnits, "Insurance draw cap") ? drawable : units(input.policy.maxInsuranceDrawUnits, "Insurance draw cap");
  const insuranceDraw = badDebt < cappedDraw ? badDebt : cappedDraw;
  const residualBadDebt = badDebt - insuranceDraw;
  if (residualBadDebt > 0n && !input.policy.allowAdl) throw new Error("Liquidation leaves bad debt while ADL is disabled");

  const digest = createHash("sha256").update([
    p.positionId, p.account, p.side, p.notionalUnits, p.collateralUnits, p.equityUnits, p.maintenanceMarginUnits,
    p.markPrice, p.indexPrice, winner.keeperId, winner.closeNotionalUnits, winner.executionPrice, winner.keeperFeeBps,
    winner.bondUnits, insuranceDraw.toString(), residualBadDebt.toString(), liquidationPolicyDigest(input.policy)
  ].join("|")).digest("hex");
  return {
    verified: true,
    digest,
    winner,
    eligibleQuoteCount: eligible.length,
    insuranceDrawUnits: insuranceDraw.toString(),
    residualBadDebtUnits: residualBadDebt.toString(),
    adlRequired: residualBadDebt > 0n
  };
}

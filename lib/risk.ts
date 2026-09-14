import { calculatePerp, type PerpSide } from "./perps";

export type PerpPositionSnapshot = {
  id: string;
  market: string;
  side: PerpSide;
  entryPrice: number;
  markPrice: number;
  sizeUsd: number;
  leverage: number;
  maintenanceMarginRatio?: number;
};

export type PortfolioRiskInput = {
  collateralUsd: number;
  positions: PerpPositionSnapshot[];
  reservedOptionCollateralUsd?: number;
};

export type LiquidationCandidate = {
  id: string;
  market: string;
  health: number;
  equityUsd: number;
  maintenanceMarginUsd: number;
  liquidationPrice: number;
  liquidatable: boolean;
};

function nonNegative(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
}

export function evaluatePortfolioRisk(input: PortfolioRiskInput) {
  nonNegative("collateralUsd", input.collateralUsd);
  const optionReserve = input.reservedOptionCollateralUsd ?? 0;
  nonNegative("reservedOptionCollateralUsd", optionReserve);

  let unrealizedPnlUsd = 0;
  let initialMarginUsd = 0;
  let maintenanceMarginUsd = 0;
  let grossNotionalUsd = 0;

  const positions = input.positions.map((position) => {
    const risk = calculatePerp({
      side: position.side,
      entryPrice: position.entryPrice,
      markPrice: position.markPrice,
      sizeUsd: position.sizeUsd,
      leverage: position.leverage,
      maintenanceMarginRatio: position.maintenanceMarginRatio
    });
    unrealizedPnlUsd += risk.unrealizedPnl;
    initialMarginUsd += risk.initialMargin;
    maintenanceMarginUsd += risk.maintenanceMargin;
    grossNotionalUsd += risk.currentNotional;
    return { ...position, risk };
  });

  const equityUsd = input.collateralUsd + unrealizedPnlUsd;
  const marginRequirementUsd = initialMarginUsd + optionReserve;
  const availableCollateralUsd = equityUsd - marginRequirementUsd;
  const liquidationBufferUsd = equityUsd - maintenanceMarginUsd - optionReserve;
  const healthFactor = maintenanceMarginUsd + optionReserve === 0
    ? Number.POSITIVE_INFINITY
    : equityUsd / (maintenanceMarginUsd + optionReserve);

  return {
    collateralUsd: input.collateralUsd,
    equityUsd,
    unrealizedPnlUsd,
    initialMarginUsd,
    maintenanceMarginUsd,
    reservedOptionCollateralUsd: optionReserve,
    grossNotionalUsd,
    availableCollateralUsd,
    liquidationBufferUsd,
    healthFactor,
    liquidatable: liquidationBufferUsd <= 0,
    positions
  };
}

export function buildLiquidationCandidates(positions: PerpPositionSnapshot[]): LiquidationCandidate[] {
  return positions
    .map((position) => {
      const risk = calculatePerp({
        side: position.side,
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        sizeUsd: position.sizeUsd,
        leverage: position.leverage,
        maintenanceMarginRatio: position.maintenanceMarginRatio
      });
      const health = risk.maintenanceMargin > 0 ? risk.equity / risk.maintenanceMargin : Number.POSITIVE_INFINITY;
      return {
        id: position.id,
        market: position.market,
        health,
        equityUsd: risk.equity,
        maintenanceMarginUsd: risk.maintenanceMargin,
        liquidationPrice: risk.liquidationPrice,
        liquidatable: risk.liquidatable
      };
    })
    .sort((a, b) => a.health - b.health);
}

export function calculatePartialLiquidationSize(input: {
  positionSizeUsd: number;
  accountEquityUsd: number;
  maintenanceMarginUsd: number;
  targetHealth?: number;
}) {
  nonNegative("positionSizeUsd", input.positionSizeUsd);
  nonNegative("maintenanceMarginUsd", input.maintenanceMarginUsd);
  if (!Number.isFinite(input.accountEquityUsd)) throw new Error("Invalid account equity");
  const target = input.targetHealth ?? 1.25;
  if (!Number.isFinite(target) || target <= 1) throw new Error("Target health must be above 1");
  if (input.maintenanceMarginUsd === 0 || input.accountEquityUsd >= input.maintenanceMarginUsd * target) return 0;

  const requiredMaintenanceReduction = input.maintenanceMarginUsd - input.accountEquityUsd / target;
  const fraction = Math.min(1, Math.max(0, requiredMaintenanceReduction / input.maintenanceMarginUsd));
  return input.positionSizeUsd * fraction;
}

import { createHash } from "node:crypto";

export type FeeSource = "PERP_TRADE" | "PERP_FUNDING" | "LIQUIDATION" | "OPTION_PREMIUM" | "OPTION_SETTLEMENT" | "NOTIONAL_FILL";

export type FeeFlow = {
  id: string;
  source: FeeSource;
  market: string;
  grossFeeUnits: string;
  insuranceUnits: string;
  treasuryUnits: string;
  makerRebateUnits: string;
  operatorUnits: string;
  createdAt: string;
};

export type InsuranceMovement = {
  id: string;
  kind: "CONTRIBUTION" | "CLAIM";
  amountUnits: string;
  reasonDigest: string;
  createdAt: string;
};

export type ProtocolEconomicsSnapshot = {
  epoch: number;
  collateralAsset: string;
  insuranceOpeningUnits: string;
  insuranceClosingUnits: string;
  minimumInsuranceFloorUnits: string;
  feeFlows: FeeFlow[];
  insuranceMovements: InsuranceMovement[];
  generatedAt: string;
};

function units(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(value);
}

function d64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

export function validateProtocolEconomics(snapshot: ProtocolEconomicsSnapshot, nowMs = Date.now()) {
  if (!Number.isInteger(snapshot.epoch) || snapshot.epoch < 1) throw new Error("Invalid economics epoch");
  if (!snapshot.collateralAsset.trim()) throw new Error("Collateral asset is required");
  const generatedAt = new Date(snapshot.generatedAt).getTime();
  if (!Number.isFinite(generatedAt) || generatedAt > nowMs + 60_000) throw new Error("Invalid economics timestamp");

  const opening = units(snapshot.insuranceOpeningUnits, "insurance opening");
  const closing = units(snapshot.insuranceClosingUnits, "insurance closing");
  const floor = units(snapshot.minimumInsuranceFloorUnits, "insurance floor");
  if (closing < floor) throw new Error("Insurance reserve is below the configured floor");

  const feeIds = new Set<string>();
  let feeInsurance = 0n;
  let grossFees = 0n;
  let treasuryFees = 0n;
  let makerRebates = 0n;
  let operatorFees = 0n;

  for (const flow of snapshot.feeFlows) {
    if (!/^[a-zA-Z0-9:_-]{6,128}$/.test(flow.id) || feeIds.has(flow.id)) throw new Error("Duplicate or invalid fee flow id");
    feeIds.add(flow.id);
    if (!flow.market.trim()) throw new Error("Fee flow market is required");
    const createdAt = new Date(flow.createdAt).getTime();
    if (!Number.isFinite(createdAt) || createdAt > generatedAt + 60_000) throw new Error("Invalid fee flow timestamp");
    const gross = units(flow.grossFeeUnits, "gross fee");
    const insurance = units(flow.insuranceUnits, "insurance fee allocation");
    const treasury = units(flow.treasuryUnits, "treasury fee allocation");
    const maker = units(flow.makerRebateUnits, "maker rebate allocation");
    const operator = units(flow.operatorUnits, "operator fee allocation");
    if (insurance + treasury + maker + operator !== gross) throw new Error("Fee allocation does not conserve gross fee");
    grossFees += gross;
    feeInsurance += insurance;
    treasuryFees += treasury;
    makerRebates += maker;
    operatorFees += operator;
  }

  const movementIds = new Set<string>();
  let contributions = 0n;
  let claims = 0n;
  for (const movement of snapshot.insuranceMovements) {
    if (!/^[a-zA-Z0-9:_-]{6,128}$/.test(movement.id) || movementIds.has(movement.id)) throw new Error("Duplicate or invalid insurance movement id");
    movementIds.add(movement.id);
    const amount = units(movement.amountUnits, "insurance movement");
    d64(movement.reasonDigest, "Insurance reason");
    const createdAt = new Date(movement.createdAt).getTime();
    if (!Number.isFinite(createdAt) || createdAt > generatedAt + 60_000) throw new Error("Invalid insurance movement timestamp");
    if (movement.kind === "CONTRIBUTION") contributions += amount;
    else claims += amount;
  }

  const expectedClosing = opening + feeInsurance + contributions - claims;
  if (claims > opening + feeInsurance + contributions) throw new Error("Insurance claims exceed available reserve");
  if (closing !== expectedClosing) throw new Error("Insurance reserve does not reconcile exactly");

  const canonicalFees = snapshot.feeFlows.map((flow) => [
    flow.id, flow.source, flow.market, flow.grossFeeUnits, flow.insuranceUnits, flow.treasuryUnits,
    flow.makerRebateUnits, flow.operatorUnits, new Date(flow.createdAt).toISOString()
  ].join(":")) .sort();
  const canonicalMovements = snapshot.insuranceMovements.map((movement) => [
    movement.id, movement.kind, movement.amountUnits, movement.reasonDigest.toLowerCase(), new Date(movement.createdAt).toISOString()
  ].join(":")) .sort();

  const root = createHash("sha256").update([
    snapshot.epoch,
    snapshot.collateralAsset,
    opening.toString(),
    closing.toString(),
    floor.toString(),
    ...canonicalFees,
    ...canonicalMovements,
    new Date(generatedAt).toISOString()
  ].join("|")).digest("hex");

  return {
    verified: true,
    root,
    grossFeesUnits: grossFees,
    insuranceFeeUnits: feeInsurance,
    treasuryFeeUnits: treasuryFees,
    makerRebateUnits: makerRebates,
    operatorFeeUnits: operatorFees,
    insuranceClaimsUnits: claims,
    insuranceClosingUnits: closing
  };
}

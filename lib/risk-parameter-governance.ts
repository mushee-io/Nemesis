import { createHash } from "node:crypto";

export type RiskParameterSet = {
  market: string;
  maxLeverage: number;
  maintenanceMarginBps: number;
  initialMarginBps: number;
  maxOpenInterestUnits: string;
  maxPositionUnits: string;
  fundingCapBps: number;
  oracleDeviationBps: number;
  liquidationPenaltyBps: number;
  withdrawalDelaySlots: number;
  maxWithdrawalBpsPerWindow: number;
  insuranceFloorUnits: string;
};

export type RiskChangeClass = "TIGHTEN" | "RELAX" | "MIXED" | "UNCHANGED";
export type RiskChangeProposal = {
  id: string;
  previousDigest: string;
  next: RiskParameterSet;
  proposedAt: string;
  executeAfter: string;
  expiresAt: string;
  governorApprovals: string[];
  guardianApprovals: string[];
};
export type RiskGovernancePolicy = {
  governorQuorum: number;
  guardianQuorum: number;
  relaxationDelayMs: number;
  maxLeverageHardCap: number;
  maxOracleDeviationBps: number;
  maxLiquidationPenaltyBps: number;
};

function units(v: string, label: string) {
  if (!/^\d+$/.test(v)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(v);
}
function validBps(v: number, label: string, max = 10_000) {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`Invalid ${label}`);
}
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
}

export function riskParameterDigest(risk: RiskParameterSet) {
  if (!/^[A-Z0-9:_-]{3,32}$/i.test(risk.market)) throw new Error("Invalid risk market");
  if (!Number.isFinite(risk.maxLeverage) || risk.maxLeverage < 1) throw new Error("Invalid max leverage");
  validBps(risk.maintenanceMarginBps, "maintenance margin");
  validBps(risk.initialMarginBps, "initial margin");
  if (risk.initialMarginBps < risk.maintenanceMarginBps) throw new Error("Initial margin must cover maintenance margin");
  units(risk.maxOpenInterestUnits, "max open interest");
  units(risk.maxPositionUnits, "max position");
  validBps(risk.fundingCapBps, "funding cap", 5_000);
  validBps(risk.oracleDeviationBps, "oracle deviation", 5_000);
  validBps(risk.liquidationPenaltyBps, "liquidation penalty", 5_000);
  if (!Number.isInteger(risk.withdrawalDelaySlots) || risk.withdrawalDelaySlots < 0) throw new Error("Invalid withdrawal delay");
  validBps(risk.maxWithdrawalBpsPerWindow, "withdrawal rate");
  units(risk.insuranceFloorUnits, "insurance floor");
  return createHash("sha256").update([
    risk.market.toUpperCase(), risk.maxLeverage, risk.maintenanceMarginBps, risk.initialMarginBps,
    risk.maxOpenInterestUnits, risk.maxPositionUnits, risk.fundingCapBps, risk.oracleDeviationBps,
    risk.liquidationPenaltyBps, risk.withdrawalDelaySlots, risk.maxWithdrawalBpsPerWindow, risk.insuranceFloorUnits
  ].join("|")).digest("hex");
}

export function classifyRiskChange(previous: RiskParameterSet, next: RiskParameterSet): RiskChangeClass {
  if (previous.market.toUpperCase() !== next.market.toUpperCase()) throw new Error("Risk change cannot change market identity");
  riskParameterDigest(previous); riskParameterDigest(next);
  const directions = [
    Math.sign(previous.maxLeverage - next.maxLeverage),
    Math.sign(next.maintenanceMarginBps - previous.maintenanceMarginBps),
    Math.sign(next.initialMarginBps - previous.initialMarginBps),
    Number(units(previous.maxOpenInterestUnits, "previous OI") > units(next.maxOpenInterestUnits, "next OI")) - Number(units(previous.maxOpenInterestUnits, "previous OI") < units(next.maxOpenInterestUnits, "next OI")),
    Number(units(previous.maxPositionUnits, "previous position") > units(next.maxPositionUnits, "next position")) - Number(units(previous.maxPositionUnits, "previous position") < units(next.maxPositionUnits, "next position")),
    Math.sign(previous.fundingCapBps - next.fundingCapBps),
    Math.sign(previous.oracleDeviationBps - next.oracleDeviationBps),
    Math.sign(next.withdrawalDelaySlots - previous.withdrawalDelaySlots),
    Math.sign(previous.maxWithdrawalBpsPerWindow - next.maxWithdrawalBpsPerWindow),
    Number(units(next.insuranceFloorUnits, "next floor") > units(previous.insuranceFloorUnits, "previous floor")) - Number(units(next.insuranceFloorUnits, "next floor") < units(previous.insuranceFloorUnits, "previous floor"))
  ].filter((v) => v !== 0);
  if (!directions.length && previous.liquidationPenaltyBps === next.liquidationPenaltyBps) return "UNCHANGED";
  const hasTighten = directions.some((v) => v > 0);
  const hasRelax = directions.some((v) => v < 0);
  if (hasTighten && hasRelax) return "MIXED";
  if (hasRelax) return "RELAX";
  return "TIGHTEN";
}

export function authorizeRiskChange(input: {
  previous: RiskParameterSet;
  proposal: RiskChangeProposal;
  policy: RiskGovernancePolicy;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const { previous, proposal, policy } = input;
  if (proposal.previousDigest.toLowerCase() !== riskParameterDigest(previous)) throw new Error("Risk proposal predecessor digest mismatch");
  const nextDigest = riskParameterDigest(proposal.next);
  if (proposal.next.maxLeverage > policy.maxLeverageHardCap) throw new Error("Risk leverage exceeds hard cap");
  if (proposal.next.oracleDeviationBps > policy.maxOracleDeviationBps) throw new Error("Oracle deviation exceeds hard cap");
  if (proposal.next.liquidationPenaltyBps > policy.maxLiquidationPenaltyBps) throw new Error("Liquidation penalty exceeds hard cap");
  unique(proposal.governorApprovals, "Governor approvals"); unique(proposal.guardianApprovals, "Guardian approvals");
  const proposedAt = new Date(proposal.proposedAt).getTime();
  const executeAfter = new Date(proposal.executeAfter).getTime();
  const expiresAt = new Date(proposal.expiresAt).getTime();
  if (![proposedAt, executeAfter, expiresAt].every(Number.isFinite) || expiresAt <= proposedAt || executeAfter < proposedAt) throw new Error("Invalid risk proposal window");
  if (nowMs > expiresAt || nowMs < proposedAt) throw new Error("Risk proposal is outside its authorization window");
  const changeClass = classifyRiskChange(previous, proposal.next);
  if (changeClass === "UNCHANGED") throw new Error("Risk proposal makes no change");
  if (changeClass === "TIGHTEN") {
    if (proposal.guardianApprovals.length < policy.guardianQuorum) throw new Error("Insufficient guardian quorum for fast tightening");
  } else {
    if (proposal.governorApprovals.length < policy.governorQuorum) throw new Error("Insufficient governor quorum for risk relaxation");
    if (executeAfter - proposedAt < policy.relaxationDelayMs || nowMs < executeAfter) throw new Error("Risk relaxation timelock not satisfied");
  }
  const authorizationDigest = createHash("sha256").update([proposal.id, proposal.previousDigest.toLowerCase(), nextDigest, changeClass, ...proposal.governorApprovals.slice().sort(), ...proposal.guardianApprovals.slice().sort(), new Date(executeAfter).toISOString()].join("|")).digest("hex");
  return { authorized: true, changeClass, nextDigest, authorizationDigest };
}

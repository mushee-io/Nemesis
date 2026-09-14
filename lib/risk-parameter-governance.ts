import { createHash } from "node:crypto";

export type RiskParameterSet = {
  market: string; maxLeverage: number; maintenanceMarginBps: number; initialMarginBps: number;
  maxOpenInterestUnits: string; maxPositionUnits: string; fundingCapBps: number; oracleDeviationBps: number;
  liquidationPenaltyBps: number; withdrawalDelaySlots: number; maxWithdrawalBpsPerWindow: number; insuranceFloorUnits: string;
};
export type RiskChangeClass = "TIGHTEN" | "RELAX" | "MIXED" | "UNCHANGED";
export type RiskChangeProposal = { id: string; previousDigest: string; next: RiskParameterSet; proposedAt: string; executeAfter: string; expiresAt: string; governorApprovals: string[]; guardianApprovals: string[] };
export type RiskGovernancePolicy = { governorQuorum: number; guardianQuorum: number; relaxationDelayMs: number; maxLeverageHardCap: number; maxOracleDeviationBps: number; maxLiquidationPenaltyBps: number };
function units(v: string, label: string) { if (!/^\d+$/.test(v)) throw new Error(`${label} must be a non-negative integer string`); return BigInt(v); }
function bps(v: number, label: string, max = 10_000) { if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`Invalid ${label}`); }
function unique(v: string[], label: string) { if (new Set(v).size !== v.length) throw new Error(`${label} contains duplicates`); }

export function riskParameterDigest(risk: RiskParameterSet) {
  if (!/^[A-Z0-9:_-]{3,32}$/i.test(risk.market) || !Number.isFinite(risk.maxLeverage) || risk.maxLeverage < 1) throw new Error("Invalid risk identity or leverage");
  bps(risk.maintenanceMarginBps, "maintenance margin"); bps(risk.initialMarginBps, "initial margin");
  if (risk.initialMarginBps < risk.maintenanceMarginBps) throw new Error("Initial margin must cover maintenance margin");
  units(risk.maxOpenInterestUnits, "max open interest"); units(risk.maxPositionUnits, "max position");
  bps(risk.fundingCapBps, "funding cap", 5_000); bps(risk.oracleDeviationBps, "oracle deviation", 5_000); bps(risk.liquidationPenaltyBps, "liquidation penalty", 5_000);
  if (!Number.isInteger(risk.withdrawalDelaySlots) || risk.withdrawalDelaySlots < 0) throw new Error("Invalid withdrawal delay");
  bps(risk.maxWithdrawalBpsPerWindow, "withdrawal rate"); units(risk.insuranceFloorUnits, "insurance floor");
  return createHash("sha256").update([risk.market.toUpperCase(), risk.maxLeverage, risk.maintenanceMarginBps, risk.initialMarginBps, risk.maxOpenInterestUnits, risk.maxPositionUnits, risk.fundingCapBps, risk.oracleDeviationBps, risk.liquidationPenaltyBps, risk.withdrawalDelaySlots, risk.maxWithdrawalBpsPerWindow, risk.insuranceFloorUnits].join("|")).digest("hex");
}

export function classifyRiskChange(previous: RiskParameterSet, next: RiskParameterSet): RiskChangeClass {
  if (previous.market.toUpperCase() !== next.market.toUpperCase()) throw new Error("Risk change cannot change market identity");
  riskParameterDigest(previous); riskParameterDigest(next);
  if (previous.liquidationPenaltyBps !== next.liquidationPenaltyBps) return "MIXED";
  const direction = [
    Math.sign(previous.maxLeverage - next.maxLeverage), Math.sign(next.maintenanceMarginBps - previous.maintenanceMarginBps), Math.sign(next.initialMarginBps - previous.initialMarginBps),
    Number(units(previous.maxOpenInterestUnits, "old OI") > units(next.maxOpenInterestUnits, "new OI")) - Number(units(previous.maxOpenInterestUnits, "old OI") < units(next.maxOpenInterestUnits, "new OI")),
    Number(units(previous.maxPositionUnits, "old position") > units(next.maxPositionUnits, "new position")) - Number(units(previous.maxPositionUnits, "old position") < units(next.maxPositionUnits, "new position")),
    Math.sign(previous.fundingCapBps - next.fundingCapBps), Math.sign(previous.oracleDeviationBps - next.oracleDeviationBps), Math.sign(next.withdrawalDelaySlots - previous.withdrawalDelaySlots), Math.sign(previous.maxWithdrawalBpsPerWindow - next.maxWithdrawalBpsPerWindow),
    Number(units(next.insuranceFloorUnits, "new floor") > units(previous.insuranceFloorUnits, "old floor")) - Number(units(next.insuranceFloorUnits, "new floor") < units(previous.insuranceFloorUnits, "old floor"))
  ].filter((v) => v !== 0);
  if (!direction.length) return "UNCHANGED";
  const tighten = direction.some((v) => v > 0), relax = direction.some((v) => v < 0);
  return tighten && relax ? "MIXED" : relax ? "RELAX" : "TIGHTEN";
}

export function authorizeRiskChange(input: { previous: RiskParameterSet; proposal: RiskChangeProposal; policy: RiskGovernancePolicy; nowMs?: number }) {
  const nowMs = input.nowMs ?? Date.now(), { previous, proposal, policy } = input;
  if (proposal.previousDigest.toLowerCase() !== riskParameterDigest(previous)) throw new Error("Risk predecessor digest mismatch");
  const nextDigest = riskParameterDigest(proposal.next);
  if (proposal.next.maxLeverage > policy.maxLeverageHardCap || proposal.next.oracleDeviationBps > policy.maxOracleDeviationBps || proposal.next.liquidationPenaltyBps > policy.maxLiquidationPenaltyBps) throw new Error("Risk proposal exceeds hard safety bounds");
  unique(proposal.governorApprovals, "Governor approvals"); unique(proposal.guardianApprovals, "Guardian approvals");
  const proposedAt = new Date(proposal.proposedAt).getTime(), executeAfter = new Date(proposal.executeAfter).getTime(), expiresAt = new Date(proposal.expiresAt).getTime();
  if (![proposedAt, executeAfter, expiresAt].every(Number.isFinite) || expiresAt <= proposedAt || executeAfter < proposedAt || nowMs < proposedAt || nowMs > expiresAt) throw new Error("Risk proposal is outside its authorization window");
  const changeClass = classifyRiskChange(previous, proposal.next);
  if (changeClass === "UNCHANGED") throw new Error("Risk proposal makes no change");
  if (changeClass === "TIGHTEN") {
    if (proposal.guardianApprovals.length < policy.guardianQuorum) throw new Error("Insufficient guardian quorum for fast tightening");
  } else {
    if (proposal.governorApprovals.length < policy.governorQuorum || executeAfter - proposedAt < policy.relaxationDelayMs || nowMs < executeAfter) throw new Error("Risk relaxation or mixed change requires governor quorum and timelock");
  }
  const authorizationDigest = createHash("sha256").update([proposal.id, proposal.previousDigest.toLowerCase(), nextDigest, changeClass, ...proposal.governorApprovals.slice().sort(), ...proposal.guardianApprovals.slice().sort(), new Date(executeAfter).toISOString()].join("|")).digest("hex");
  return { authorized: true, changeClass, nextDigest, authorizationDigest };
}

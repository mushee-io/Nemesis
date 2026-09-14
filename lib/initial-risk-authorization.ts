import { createHash } from "node:crypto";
import { riskParameterDigest, type RiskGovernancePolicy, type RiskParameterSet } from "./risk-parameter-governance";

export type InitialRiskAuthorization = {
  id: string;
  risk: RiskParameterSet;
  governorApprovals: string[];
  authorizedAt: string;
  expiresAt: string;
};

export function authorizeInitialRiskSet(input: {
  authorization: InitialRiskAuthorization;
  policy: RiskGovernancePolicy;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const { authorization, policy } = input;
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(authorization.id)) throw new Error("Invalid initial risk authorization id");
  const approvals = authorization.governorApprovals;
  if (new Set(approvals).size !== approvals.length || approvals.length < policy.governorQuorum) throw new Error("Initial risk set lacks governor quorum");
  if (authorization.risk.maxLeverage > policy.maxLeverageHardCap) throw new Error("Initial leverage exceeds hard cap");
  if (authorization.risk.oracleDeviationBps > policy.maxOracleDeviationBps) throw new Error("Initial oracle deviation exceeds hard cap");
  if (authorization.risk.liquidationPenaltyBps > policy.maxLiquidationPenaltyBps) throw new Error("Initial liquidation penalty exceeds hard cap");
  const authorizedAt = new Date(authorization.authorizedAt).getTime();
  const expiresAt = new Date(authorization.expiresAt).getTime();
  if (!Number.isFinite(authorizedAt) || !Number.isFinite(expiresAt) || expiresAt <= authorizedAt) throw new Error("Invalid initial risk authorization window");
  if (authorizedAt > nowMs + 60_000 || nowMs > expiresAt) throw new Error("Initial risk authorization is outside its valid window");
  const riskRoot = riskParameterDigest(authorization.risk);
  const digest = createHash("sha256").update([authorization.id, riskRoot, ...approvals.slice().sort(), new Date(authorizedAt).toISOString(), new Date(expiresAt).toISOString()].join("|")).digest("hex");
  return { authorized: true, riskRoot, digest };
}

import { createHash } from "node:crypto";
import { withdrawalPolicyDigest, type WithdrawalPolicy } from "./withdrawal-settlement";
import { liquidationPolicyDigest, type CriticalLiquidationPolicy } from "./critical-liquidation";

export type SettlementSafetyInputs = {
  withdrawalPolicy: WithdrawalPolicy;
  liquidationPolicy: CriticalLiquidationPolicy;
  pendingWithdrawalDigest: string;
  insuranceStateDigest: string;
};

function d64(v: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be SHA-256`);
  return v.toLowerCase();
}

export function settlementSafetyRoot(input: SettlementSafetyInputs) {
  const withdrawal = withdrawalPolicyDigest(input.withdrawalPolicy);
  const liquidation = liquidationPolicyDigest(input.liquidationPolicy);
  const pending = d64(input.pendingWithdrawalDigest, "Pending withdrawal digest");
  const insurance = d64(input.insuranceStateDigest, "Insurance state digest");
  return createHash("sha256").update([withdrawal, liquidation, pending, insurance].join("|")).digest("hex");
}

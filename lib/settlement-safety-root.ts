import { createHash } from "node:crypto";
import { withdrawalPolicyDigest, type WithdrawalPolicy } from "./withdrawal-settlement";
import { liquidationPolicyDigest, type CriticalLiquidationPolicy } from "./critical-liquidation";

export type SettlementSafetyInputs = { withdrawalPolicy: WithdrawalPolicy; liquidationPolicy: CriticalLiquidationPolicy; pendingWithdrawalDigest: string; insuranceStateDigest: string };
function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be SHA-256`); return v.toLowerCase(); }
export function settlementSafetyRoot(input: SettlementSafetyInputs) {
  return createHash("sha256").update([
    withdrawalPolicyDigest(input.withdrawalPolicy), liquidationPolicyDigest(input.liquidationPolicy),
    d64(input.pendingWithdrawalDigest, "Pending withdrawal digest"), d64(input.insuranceStateDigest, "Insurance state digest")
  ].join("|")).digest("hex");
}

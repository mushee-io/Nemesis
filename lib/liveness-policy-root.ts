import { createHash } from "node:crypto";
import { providerPolicyRoot, type ProviderFailoverPolicy } from "./provider-failover";
import { transactionRebuildPolicyRoot, type TransactionRebuildPolicy } from "./transaction-rebuild";
import { transactionChainPolicyRoot, type TransactionChainPolicy } from "./bounded-transaction-chain";
import { degradedMarketPolicyRoot, type DegradedMarketPolicy } from "./degraded-market-control";
import { operatorFailoverPolicyRoot, type OperatorFailoverPolicy } from "./operator-failover-plan";

export type LivenessPolicyBundle = {
  provider: ProviderFailoverPolicy;
  rebuild: TransactionRebuildPolicy;
  chain: TransactionChainPolicy;
  degradedMarket: DegradedMarketPolicy;
  operatorFailover: OperatorFailoverPolicy;
};

export function buildLivenessPolicyRoot(bundle: LivenessPolicyBundle) {
  const providerRoot = providerPolicyRoot(bundle.provider);
  const rebuildRoot = transactionRebuildPolicyRoot(bundle.rebuild);
  const chainRoot = transactionChainPolicyRoot(bundle.chain);
  const degradedRoot = degradedMarketPolicyRoot(bundle.degradedMarket);
  const operatorFailoverRoot = operatorFailoverPolicyRoot(bundle.operatorFailover);
  const root = createHash("sha256").update([
    providerRoot,
    rebuildRoot,
    chainRoot,
    degradedRoot,
    operatorFailoverRoot
  ].join("|")).digest("hex");
  return { root, providerRoot, rebuildRoot, chainRoot, degradedRoot, operatorFailoverRoot };
}

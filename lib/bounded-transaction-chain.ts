import { createHash } from "node:crypto";

export type TransactionChainPolicy = {
  maximumDepth: number;
  minimumRemainingValiditySlots: number;
  maximumSharedReferenceInputs: number;
  requireDedicatedCollateralPerScriptTx: boolean;
};

export type TransactionChainLink = {
  index: number;
  txHash: string;
  dependsOnTxHash?: string;
  consumesRef?: string;
  producedRef: string;
  validityEndSlot: number;
  collateralRef?: string;
  referenceInputs: string[];
};

export type TransactionChainPlan = {
  chainId: string;
  builtAtSlot: number;
  links: TransactionChainLink[];
};

function hash64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be 32-byte hex`);
  return value.toLowerCase();
}
function ref(value: string, label: string) {
  if (!/^[0-9a-f]{64}#[0-9]{1,5}$/i.test(value)) throw new Error(`Invalid ${label}`);
  return value.toLowerCase();
}

export function transactionChainPolicyRoot(policy: TransactionChainPolicy) {
  if (!Number.isInteger(policy.maximumDepth) || policy.maximumDepth < 1 || policy.maximumDepth > 32) throw new Error("Invalid transaction-chain depth");
  if (!Number.isInteger(policy.minimumRemainingValiditySlots) || policy.minimumRemainingValiditySlots < 1) throw new Error("Invalid transaction-chain validity budget");
  if (!Number.isInteger(policy.maximumSharedReferenceInputs) || policy.maximumSharedReferenceInputs < 0) throw new Error("Invalid transaction-chain reference-input cap");
  return createHash("sha256").update([
    policy.maximumDepth,
    policy.minimumRemainingValiditySlots,
    policy.maximumSharedReferenceInputs,
    policy.requireDedicatedCollateralPerScriptTx ? 1 : 0
  ].join("|")).digest("hex");
}

export function validateTransactionChain(plan: TransactionChainPlan, policy: TransactionChainPolicy, currentSlot: number) {
  transactionChainPolicyRoot(policy);
  if (!/^[a-zA-Z0-9:_-]{6,96}$/.test(plan.chainId)) throw new Error("Invalid transaction chain id");
  if (!Number.isInteger(plan.builtAtSlot) || plan.builtAtSlot <= 0) throw new Error("Invalid chain build slot");
  if (!Number.isInteger(currentSlot) || currentSlot < plan.builtAtSlot) throw new Error("Invalid current chain slot");
  if (!plan.links.length || plan.links.length > policy.maximumDepth) throw new Error("Transaction chain exceeds bounded depth");

  const txHashes: string[] = [];
  const producedRefs: string[] = [];
  const collateralRefs: string[] = [];
  const referenceInputSet = new Set<string>();

  for (let i = 0; i < plan.links.length; i++) {
    const link = plan.links[i];
    if (link.index !== i) throw new Error("Transaction chain indexes must be contiguous");
    const txHash = hash64(link.txHash, "Transaction chain hash");
    txHashes.push(txHash);
    const produced = ref(link.producedRef, "produced chain output");
    if (!produced.startsWith(`${txHash}#`)) throw new Error("Produced chain output must belong to its transaction");
    producedRefs.push(produced);
    if (!Number.isInteger(link.validityEndSlot) || link.validityEndSlot - currentSlot < policy.minimumRemainingValiditySlots) throw new Error("Transaction chain validity budget is too small");

    const refs = link.referenceInputs.map((value) => ref(value, "reference input"));
    if (new Set(refs).size !== refs.length) throw new Error("Duplicate reference input inside transaction chain link");
    refs.forEach((value) => referenceInputSet.add(value));
    if (referenceInputSet.size > policy.maximumSharedReferenceInputs) throw new Error("Transaction chain references too many shared inputs");

    if (policy.requireDedicatedCollateralPerScriptTx) {
      if (!link.collateralRef) throw new Error("Each chained script transaction requires dedicated collateral");
      collateralRefs.push(ref(link.collateralRef, "collateral reference"));
    }

    if (i === 0) {
      if (link.dependsOnTxHash || link.consumesRef) throw new Error("First chain link cannot depend on an unconfirmed predecessor");
    } else {
      const previous = plan.links[i - 1];
      if (hash64(link.dependsOnTxHash ?? "", "Predecessor transaction hash") !== hash64(previous.txHash, "Previous transaction hash")) throw new Error("Transaction chain predecessor mismatch");
      if (ref(link.consumesRef ?? "", "consumed predecessor output") !== ref(previous.producedRef, "previous produced output")) throw new Error("Transaction chain must consume the immediate predecessor output");
    }
  }

  if (new Set(txHashes).size !== txHashes.length) throw new Error("Transaction chain contains duplicate transaction hashes");
  if (new Set(producedRefs).size !== producedRefs.length) throw new Error("Transaction chain contains duplicate produced outputs");
  if (policy.requireDedicatedCollateralPerScriptTx && new Set(collateralRefs).size !== collateralRefs.length) throw new Error("Transaction chain reuses script collateral");

  for (const sharedRef of referenceInputSet) {
    if (producedRefs.includes(sharedRef) || plan.links.some((link) => link.consumesRef && ref(link.consumesRef, "consumed output") === sharedRef)) {
      throw new Error("Shared reference input cannot be consumed or replaced inside the chain");
    }
  }

  const root = createHash("sha256").update([
    plan.chainId,
    plan.builtAtSlot,
    transactionChainPolicyRoot(policy),
    ...plan.links.map((link) => [
      link.index,
      link.txHash.toLowerCase(),
      link.dependsOnTxHash?.toLowerCase() ?? "GENESIS",
      link.consumesRef?.toLowerCase() ?? "",
      link.producedRef.toLowerCase(),
      link.validityEndSlot,
      link.collateralRef?.toLowerCase() ?? "",
      ...link.referenceInputs.map((value) => value.toLowerCase()).sort()
    ].join(":"))
  ].join("|")).digest("hex");

  return { valid: true, depth: plan.links.length, root, lastTransactionHash: txHashes[txHashes.length - 1] };
}

export function invalidateTransactionChainFrom(plan: TransactionChainPlan, failedTxHash: string) {
  const normalized = hash64(failedTxHash, "Failed transaction hash");
  const index = plan.links.findIndex((link) => link.txHash.toLowerCase() === normalized);
  if (index < 0) throw new Error("Failed transaction is not part of the chain");
  return {
    failedIndex: index,
    invalidatedTransactionHashes: plan.links.slice(index).map((link) => link.txHash.toLowerCase()),
    rebuildFromIndex: index
  };
}

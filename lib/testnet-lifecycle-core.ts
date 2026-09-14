import { createHash } from "node:crypto";
import type { TestnetAction } from "./testnet-transaction-plan";

export type TestnetActionReceipt = {
  action: TestnetAction;
  txHash: string;
  blockHash: string;
  slot: number;
  confirmations: number;
  planDigest: string;
  builderReceiptDigest: string;
  stateRootBefore: string;
  stateRootAfter: string;
  observedAt: string;
};

function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be 64 hex`); return v.toLowerCase(); }

export function validateActionReceipt(receipt: TestnetActionReceipt, minimumConfirmations: number, nowMs = Date.now()) {
  if (!Number.isInteger(minimumConfirmations) || minimumConfirmations < 1) throw new Error("Minimum confirmations must be positive");
  const txHash = d64(receipt.txHash, `${receipt.action} tx hash`);
  const blockHash = d64(receipt.blockHash, `${receipt.action} block hash`);
  const planDigest = d64(receipt.planDigest, `${receipt.action} plan digest`);
  const builderReceiptDigest = d64(receipt.builderReceiptDigest, `${receipt.action} builder receipt digest`);
  const stateRootBefore = d64(receipt.stateRootBefore, `${receipt.action} state root before`);
  const stateRootAfter = d64(receipt.stateRootAfter, `${receipt.action} state root after`);
  if (stateRootBefore === stateRootAfter) throw new Error(`${receipt.action} must change protocol state root`);
  if (!Number.isInteger(receipt.slot) || receipt.slot < 1) throw new Error(`${receipt.action} slot must be positive`);
  if (!Number.isInteger(receipt.confirmations) || receipt.confirmations < minimumConfirmations) throw new Error(`${receipt.action} lacks required Preprod confirmations`);
  const observedAt = new Date(receipt.observedAt).getTime();
  if (!Number.isFinite(observedAt) || observedAt > nowMs + 60_000 || nowMs - observedAt > 86_400_000) throw new Error(`${receipt.action} receipt is stale or future-dated`);
  const digest = createHash("sha256").update([receipt.action, txHash, blockHash, receipt.slot, receipt.confirmations, planDigest, builderReceiptDigest, stateRootBefore, stateRootAfter].join("|")).digest("hex");
  return { ...receipt, txHash, blockHash, planDigest, builderReceiptDigest, stateRootBefore, stateRootAfter, digest };
}

export function validateReceiptChain(receipts: TestnetActionReceipt[], minimumConfirmations: number, nowMs = Date.now()) {
  if (receipts.length === 0) throw new Error("Lifecycle receipt chain cannot be empty");
  const normalized = receipts.map((receipt) => validateActionReceipt(receipt, minimumConfirmations, nowMs));
  const txHashes = new Set<string>();
  for (let i = 0; i < normalized.length; i += 1) {
    const current = normalized[i];
    if (txHashes.has(current.txHash)) throw new Error("Lifecycle reuses a transaction hash");
    txHashes.add(current.txHash);
    if (i > 0) {
      const previous = normalized[i - 1];
      if (current.stateRootBefore !== previous.stateRootAfter) throw new Error(`Lifecycle state root discontinuity between ${previous.action} and ${current.action}`);
      if (current.slot < previous.slot) throw new Error("Lifecycle slots must be monotonic");
    }
  }
  const root = createHash("sha256").update(normalized.map((entry) => entry.digest).join("|")).digest("hex");
  return { root, receipts: normalized, firstStateRoot: normalized[0].stateRootBefore, finalStateRoot: normalized.at(-1)!.stateRootAfter, transactionCount: normalized.length };
}

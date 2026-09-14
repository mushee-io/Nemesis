import { createHash } from "node:crypto";
import { validateReceiptChain, type TestnetActionReceipt } from "./testnet-lifecycle-core";

const REQUIRED = ["WRITE_OPTION","BUY_OPTION","SETTLE_OPTION","CLOSE_OPTION"] as const;

export type TestnetOptionsLifecycle = {
  seriesId: string;
  underlying: string;
  expiryMs: number;
  receipts: TestnetActionReceipt[];
  lockedCollateralUnits: string;
  buyerPayoutUnits: string;
  writerResidualUnits: string;
  protocolFeeUnits: string;
};

export function validateTestnetOptionsLifecycle(lifecycle: TestnetOptionsLifecycle, minimumConfirmations: number, nowMs = Date.now()) {
  if (!/^[a-z0-9:_-]{8,128}$/i.test(lifecycle.seriesId)) throw new Error("Invalid options series id");
  if (!/^[A-Z0-9][A-Z0-9:_/-]{2,31}$/.test(lifecycle.underlying)) throw new Error("Invalid option underlying");
  if (!Number.isInteger(lifecycle.expiryMs) || lifecycle.expiryMs < 1) throw new Error("Invalid option expiry");
  const actions = lifecycle.receipts.map((receipt) => receipt.action);
  if (actions.length !== REQUIRED.length || actions.some((action, index) => action !== REQUIRED[index])) throw new Error("Options testnet lifecycle must prove write, buy, settle and close in order");
  const locked = BigInt(lifecycle.lockedCollateralUnits), buyer = BigInt(lifecycle.buyerPayoutUnits), writer = BigInt(lifecycle.writerResidualUnits), fee = BigInt(lifecycle.protocolFeeUnits);
  if ([locked,buyer,writer,fee].some((v) => v < 0n)) throw new Error("Option settlement values cannot be negative");
  if (buyer + writer + fee !== locked) throw new Error("Option settlement does not conserve locked collateral");
  const chain = validateReceiptChain(lifecycle.receipts, minimumConfirmations, nowMs);
  const root = createHash("sha256").update([lifecycle.seriesId,lifecycle.underlying,lifecycle.expiryMs,locked,buyer,writer,fee,chain.root].join("|")).digest("hex");
  return { ...chain, seriesId: lifecycle.seriesId, underlying: lifecycle.underlying, root, lockedCollateralUnits: locked.toString(), buyerPayoutUnits: buyer.toString(), writerResidualUnits: writer.toString(), protocolFeeUnits: fee.toString() };
}

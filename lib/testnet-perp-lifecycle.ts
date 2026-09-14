import { createHash } from "node:crypto";
import { validateReceiptChain, type TestnetActionReceipt } from "./testnet-lifecycle-core";

const REQUIRED = ["DEPOSIT_COLLATERAL","OPEN_PERP","APPLY_FUNDING","CLOSE_PERP","OPEN_PERP","LIQUIDATE_PERP","WITHDRAW_COLLATERAL"] as const;

export type TestnetPerpLifecycle = {
  market: string;
  collateralAssetUnit: string;
  receipts: TestnetActionReceipt[];
};

export function validateTestnetPerpLifecycle(lifecycle: TestnetPerpLifecycle, minimumConfirmations: number, nowMs = Date.now()) {
  if (!/^[A-Z0-9][A-Z0-9:_/-]{2,31}$/.test(lifecycle.market)) throw new Error("Invalid perpetual market id");
  if (!/^(lovelace|[0-9a-f]{56}[0-9a-f]*)$/i.test(lifecycle.collateralAssetUnit)) throw new Error("Invalid collateral asset unit");
  const actions = lifecycle.receipts.map((receipt) => receipt.action);
  if (actions.length !== REQUIRED.length || actions.some((action, index) => action !== REQUIRED[index])) throw new Error("Perp testnet lifecycle must prove deposit, funding, normal close, liquidation and withdrawal in canonical order");
  const chain = validateReceiptChain(lifecycle.receipts, minimumConfirmations, nowMs);
  const root = createHash("sha256").update([lifecycle.market, lifecycle.collateralAssetUnit.toLowerCase(), chain.root].join("|")).digest("hex");
  return { ...chain, market: lifecycle.market, collateralAssetUnit: lifecycle.collateralAssetUnit.toLowerCase(), root };
}

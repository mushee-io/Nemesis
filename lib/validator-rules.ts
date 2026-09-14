import type { PerpSide } from "./perps";

export type CollateralDatum = {
  account: string;
  asset: string;
  amount: bigint;
  nonce: bigint;
};

export type PerpPositionDatum = {
  account: string;
  market: string;
  side: PerpSide;
  sizeUsd: number;
  collateralUsd: number;
  entryPrice: number;
  nonce: bigint;
};

function requireAccount(value: string) {
  if (!value.trim()) throw new Error("Validator account is required");
}

export function validateCollateralTransition(input: {
  before: CollateralDatum;
  after?: CollateralDatum;
  signer: string;
  action: "DEPOSIT" | "WITHDRAW" | "CLOSE";
}) {
  const { before, after, signer, action } = input;
  requireAccount(before.account);
  if (signer !== before.account) throw new Error("Collateral transition is not signed by the account owner");
  if (before.amount < 0n) throw new Error("Invalid collateral amount");
  if (action === "CLOSE") {
    if (after) throw new Error("Closed collateral state must not continue");
    return true;
  }
  if (!after) throw new Error("Collateral transition must produce a continuing state");
  if (after.account !== before.account || after.asset !== before.asset) throw new Error("Collateral identity cannot change");
  if (after.nonce !== before.nonce + 1n) throw new Error("Collateral nonce must increment exactly once");
  if (after.amount < 0n) throw new Error("Collateral cannot become negative");
  if (action === "DEPOSIT" && after.amount <= before.amount) throw new Error("Deposit must increase collateral");
  if (action === "WITHDRAW" && after.amount >= before.amount) throw new Error("Withdrawal must reduce collateral");
  return true;
}

export function validatePerpPositionTransition(input: {
  before?: PerpPositionDatum;
  after?: PerpPositionDatum;
  signer: string;
  action: "OPEN" | "UPDATE" | "CLOSE" | "LIQUIDATE";
  keeperAuthorized?: boolean;
}) {
  const { before, after, signer, action } = input;
  const state = before ?? after;
  if (!state) throw new Error("Perpetual transition requires state");
  requireAccount(state.account);

  if (action === "OPEN") {
    if (before || !after) throw new Error("Open must create a new perpetual state");
    if (signer !== after.account) throw new Error("Perpetual open requires account signature");
  } else if (action === "CLOSE") {
    if (!before || after) throw new Error("Close must consume the perpetual state");
    if (signer !== before.account) throw new Error("Perpetual close requires account signature");
  } else if (action === "LIQUIDATE") {
    if (!before) throw new Error("Liquidation requires an existing position");
    if (!input.keeperAuthorized) throw new Error("Liquidation requires keeper authorization");
  } else {
    if (!before || !after) throw new Error("Update requires before and after states");
    if (signer !== before.account) throw new Error("Perpetual update requires account signature");
  }

  if (after) {
    if (!after.market.trim()) throw new Error("Perpetual market is required");
    if (![after.sizeUsd, after.collateralUsd, after.entryPrice].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("Perpetual state contains invalid numeric values");
    }
    if (before && action !== "LIQUIDATE") {
      if (after.account !== before.account || after.market !== before.market || after.side !== before.side) throw new Error("Perpetual identity cannot change during update");
      if (after.nonce !== before.nonce + 1n) throw new Error("Perpetual nonce must increment exactly once");
    }
  }
  return true;
}

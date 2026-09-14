import { createHash } from "node:crypto";

export type AccountProductExposure = {
  account: string;
  collateralUnits: string;
  perpMarginUnits: string;
  perpPnlLiabilityUnits: string;
  optionCollateralUnits: string;
  optionPayoutLiabilityUnits: string;
  notionalEscrowUnits: string;
  pendingWithdrawalUnits: string;
};

export type ProductLedgerTotals = {
  custodyUnits: string;
  insuranceUnits: string;
  badDebtUnits: string;
  perpMarginUnits: string;
  perpPnlLiabilityUnits: string;
  optionCollateralUnits: string;
  optionPayoutLiabilityUnits: string;
  notionalEscrowUnits: string;
  pendingWithdrawalUnits: string;
};

function units(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(value);
}

export function reconcileCrossProductLedger(input: {
  accounts: AccountProductExposure[];
  totals: ProductLedgerTotals;
}) {
  if (!input.accounts.length) throw new Error("Cross-product reconciliation requires accounts");
  const accountIds = input.accounts.map((entry) => entry.account.trim().toLowerCase());
  if (accountIds.some((value) => !value)) throw new Error("Cross-product account id is required");
  if (new Set(accountIds).size !== accountIds.length) throw new Error("Cross-product reconciliation contains duplicate accounts");

  const sums = input.accounts.reduce((acc, entry) => {
    const collateral = units(entry.collateralUnits, "account collateral");
    const perpMargin = units(entry.perpMarginUnits, "account perp margin");
    const perpPnl = units(entry.perpPnlLiabilityUnits, "account perp PnL liability");
    const optionCollateral = units(entry.optionCollateralUnits, "account option collateral");
    const optionPayout = units(entry.optionPayoutLiabilityUnits, "account option payout liability");
    const notionalEscrow = units(entry.notionalEscrowUnits, "account Notional escrow");
    const pendingWithdrawal = units(entry.pendingWithdrawalUnits, "account pending withdrawal");
    if (perpMargin + optionCollateral + notionalEscrow + pendingWithdrawal > collateral) {
      throw new Error(`Account ${entry.account} allocates more collateral than it owns`);
    }
    acc.collateral += collateral;
    acc.perpMargin += perpMargin;
    acc.perpPnl += perpPnl;
    acc.optionCollateral += optionCollateral;
    acc.optionPayout += optionPayout;
    acc.notionalEscrow += notionalEscrow;
    acc.pendingWithdrawal += pendingWithdrawal;
    return acc;
  }, {
    collateral: 0n,
    perpMargin: 0n,
    perpPnl: 0n,
    optionCollateral: 0n,
    optionPayout: 0n,
    notionalEscrow: 0n,
    pendingWithdrawal: 0n
  });

  const expected = {
    custody: units(input.totals.custodyUnits, "custodyUnits"),
    insurance: units(input.totals.insuranceUnits, "insuranceUnits"),
    badDebt: units(input.totals.badDebtUnits, "badDebtUnits"),
    perpMargin: units(input.totals.perpMarginUnits, "perpMarginUnits"),
    perpPnl: units(input.totals.perpPnlLiabilityUnits, "perpPnlLiabilityUnits"),
    optionCollateral: units(input.totals.optionCollateralUnits, "optionCollateralUnits"),
    optionPayout: units(input.totals.optionPayoutLiabilityUnits, "optionPayoutLiabilityUnits"),
    notionalEscrow: units(input.totals.notionalEscrowUnits, "notionalEscrowUnits"),
    pendingWithdrawal: units(input.totals.pendingWithdrawalUnits, "pendingWithdrawalUnits")
  };

  const comparisons: Array<[bigint, bigint, string]> = [
    [sums.perpMargin, expected.perpMargin, "perp margin"],
    [sums.perpPnl, expected.perpPnl, "perp PnL liability"],
    [sums.optionCollateral, expected.optionCollateral, "option collateral"],
    [sums.optionPayout, expected.optionPayout, "option payout liability"],
    [sums.notionalEscrow, expected.notionalEscrow, "Notional escrow"],
    [sums.pendingWithdrawal, expected.pendingWithdrawal, "pending withdrawals"]
  ];
  for (const [actual, target, label] of comparisons) {
    if (actual !== target) throw new Error(`Cross-product ${label} total mismatch`);
  }

  if (sums.collateral !== expected.custody) throw new Error("Account collateral does not reconcile to protocol custody");
  const liabilities = sums.collateral + sums.perpPnl + sums.optionPayout + expected.badDebt;
  const backing = expected.custody + expected.insurance;
  if (backing < liabilities) throw new Error("Cross-product ledger is insolvent after liabilities");

  const digest = createHash("sha256").update([
    ...input.accounts
      .map((entry) => [
        entry.account.toLowerCase(),
        entry.collateralUnits,
        entry.perpMarginUnits,
        entry.perpPnlLiabilityUnits,
        entry.optionCollateralUnits,
        entry.optionPayoutLiabilityUnits,
        entry.notionalEscrowUnits,
        entry.pendingWithdrawalUnits
      ].join(":"))
      .sort(),
    ...Object.entries(input.totals).map(([key, value]) => `${key}:${value}`).sort()
  ].join("|")).digest("hex");

  return {
    reconciled: true,
    digest,
    accountCount: input.accounts.length,
    custodyUnits: expected.custody,
    insuranceUnits: expected.insurance,
    liabilitiesUnits: liabilities,
    surplusUnits: backing - liabilities
  };
}

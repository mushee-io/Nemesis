export type ExposurePolicy = {
  maxGrossOpenInterestUsd: number;
  maxMarketOpenInterestUsd: number;
  maxAccountNotionalUsd: number;
  maxSingleWithdrawalUsd: number;
  maxRollingWithdrawalUsd: number;
  withdrawalWindowMs: number;
  minimumPostWithdrawalHealthFactor: number;
  reduceOnlyAtUtilizationBps: number;
};

export const DEFAULT_EXPOSURE_POLICY: ExposurePolicy = {
  maxGrossOpenInterestUsd: 5_000_000,
  maxMarketOpenInterestUsd: 1_500_000,
  maxAccountNotionalUsd: 250_000,
  maxSingleWithdrawalUsd: 50_000,
  maxRollingWithdrawalUsd: 150_000,
  withdrawalWindowMs: 24 * 60 * 60 * 1000,
  minimumPostWithdrawalHealthFactor: 1.25,
  reduceOnlyAtUtilizationBps: 8_500
};

export function evaluateExposureAdmission(input: {
  grossOpenInterestUsd: number;
  marketOpenInterestUsd: number;
  accountNotionalUsd: number;
  requestedNotionalUsd: number;
  liquidityUsd: number;
  policy?: ExposurePolicy;
}) {
  const policy = input.policy ?? DEFAULT_EXPOSURE_POLICY;
  const values = [input.grossOpenInterestUsd, input.marketOpenInterestUsd, input.accountNotionalUsd, input.requestedNotionalUsd, input.liquidityUsd];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Exposure inputs must be finite non-negative values");
  const nextGross = input.grossOpenInterestUsd + input.requestedNotionalUsd;
  const nextMarket = input.marketOpenInterestUsd + input.requestedNotionalUsd;
  const nextAccount = input.accountNotionalUsd + input.requestedNotionalUsd;
  if (nextGross > policy.maxGrossOpenInterestUsd) throw new Error("Global open-interest cap exceeded");
  if (nextMarket > policy.maxMarketOpenInterestUsd) throw new Error("Market open-interest cap exceeded");
  if (nextAccount > policy.maxAccountNotionalUsd) throw new Error("Account notional cap exceeded");
  const utilizationBps = input.liquidityUsd === 0 ? 10_000 : Math.round(nextGross / input.liquidityUsd * 10_000);
  return { allowed: utilizationBps < policy.reduceOnlyAtUtilizationBps, mode: utilizationBps >= policy.reduceOnlyAtUtilizationBps ? "REDUCE_ONLY" as const : "NORMAL" as const, utilizationBps };
}

export type WithdrawalReceipt = { amountUsd: number; timestamp: string; txHash: string };

export function authorizeWithdrawal(input: {
  amountUsd: number;
  postWithdrawalHealthFactor: number;
  history: WithdrawalReceipt[];
  nowMs?: number;
  policy?: ExposurePolicy;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const policy = input.policy ?? DEFAULT_EXPOSURE_POLICY;
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0 || input.amountUsd > policy.maxSingleWithdrawalUsd) throw new Error("Withdrawal amount exceeds policy");
  if (!Number.isFinite(input.postWithdrawalHealthFactor) || input.postWithdrawalHealthFactor < policy.minimumPostWithdrawalHealthFactor) throw new Error("Post-withdrawal health factor below policy");
  const recent = input.history.filter((receipt) => {
    const time = new Date(receipt.timestamp).getTime();
    if (!Number.isFinite(time) || time > nowMs + 60_000) throw new Error("Invalid withdrawal history timestamp");
    if (!/^[0-9a-f]{64}$/i.test(receipt.txHash)) throw new Error("Invalid withdrawal receipt hash");
    return nowMs - time < policy.withdrawalWindowMs;
  });
  const rolling = recent.reduce((sum, receipt) => sum + receipt.amountUsd, 0) + input.amountUsd;
  if (rolling > policy.maxRollingWithdrawalUsd) throw new Error("Rolling withdrawal cap exceeded");
  return { authorized: true, rollingWithdrawalUsd: rolling, remainingWindowCapacityUsd: policy.maxRollingWithdrawalUsd - rolling };
}

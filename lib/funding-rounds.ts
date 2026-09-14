import { createHash } from "node:crypto";

export type FundingRound = {
  market: string;
  roundId: number;
  indexPrice: number;
  markPrice: number;
  intervalStartMs: number;
  intervalEndMs: number;
  longOpenInterestUsd: number;
  shortOpenInterestUsd: number;
  premiumBps: number;
  fundingRateBps: number;
  cumulativeFundingBps: number;
  digest: string;
};

export type FundingPolicy = {
  expectedIntervalMs: number;
  maxIntervalDriftMs: number;
  maxPremiumBps: number;
  maxFundingBpsPerInterval: number;
  maxMarkIndexDeviationBps: number;
};

export const DEFAULT_FUNDING_POLICY: FundingPolicy = {
  expectedIntervalMs: 60 * 60 * 1000,
  maxIntervalDriftMs: 5 * 60 * 1000,
  maxPremiumBps: 500,
  maxFundingBpsPerInterval: 100,
  maxMarkIndexDeviationBps: 750
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validatePolicy(policy: FundingPolicy) {
  if (!Number.isInteger(policy.expectedIntervalMs) || policy.expectedIntervalMs <= 0) throw new Error("Invalid funding interval");
  if (!Number.isInteger(policy.maxIntervalDriftMs) || policy.maxIntervalDriftMs < 0) throw new Error("Invalid funding drift");
  if (!Number.isFinite(policy.maxPremiumBps) || policy.maxPremiumBps <= 0) throw new Error("Invalid premium cap");
  if (!Number.isFinite(policy.maxFundingBpsPerInterval) || policy.maxFundingBpsPerInterval <= 0) throw new Error("Invalid funding cap");
  if (!Number.isFinite(policy.maxMarkIndexDeviationBps) || policy.maxMarkIndexDeviationBps <= 0) throw new Error("Invalid mark/index cap");
}

export function buildFundingRound(input: {
  market: string;
  roundId: number;
  indexPrice: number;
  markPrice: number;
  intervalStartMs: number;
  intervalEndMs: number;
  longOpenInterestUsd: number;
  shortOpenInterestUsd: number;
  previous?: FundingRound;
  policy?: FundingPolicy;
}): FundingRound {
  const policy = input.policy ?? DEFAULT_FUNDING_POLICY;
  validatePolicy(policy);
  if (!/^[A-Z0-9._/-]{2,32}$/.test(input.market)) throw new Error("Invalid funding market");
  if (!Number.isInteger(input.roundId) || input.roundId < 1) throw new Error("Invalid funding round id");
  if (!Number.isFinite(input.indexPrice) || input.indexPrice <= 0) throw new Error("Invalid index price");
  if (!Number.isFinite(input.markPrice) || input.markPrice <= 0) throw new Error("Invalid mark price");
  if (!Number.isFinite(input.longOpenInterestUsd) || input.longOpenInterestUsd < 0) throw new Error("Invalid long open interest");
  if (!Number.isFinite(input.shortOpenInterestUsd) || input.shortOpenInterestUsd < 0) throw new Error("Invalid short open interest");
  if (!Number.isInteger(input.intervalStartMs) || !Number.isInteger(input.intervalEndMs) || input.intervalEndMs <= input.intervalStartMs) {
    throw new Error("Invalid funding interval window");
  }

  const intervalMs = input.intervalEndMs - input.intervalStartMs;
  if (Math.abs(intervalMs - policy.expectedIntervalMs) > policy.maxIntervalDriftMs) throw new Error("Funding interval drift exceeds policy");

  if (input.previous) {
    if (input.previous.market !== input.market) throw new Error("Funding market changed across rounds");
    if (input.roundId !== input.previous.roundId + 1) throw new Error("Funding round id must increase exactly once");
    if (input.intervalStartMs !== input.previous.intervalEndMs) throw new Error("Funding intervals must be contiguous");
  }

  const premiumBps = Math.round((input.markPrice - input.indexPrice) / input.indexPrice * 10_000);
  if (Math.abs(premiumBps) > policy.maxMarkIndexDeviationBps) throw new Error("Mark/index deviation exceeds policy");
  if (Math.abs(premiumBps) > policy.maxPremiumBps) throw new Error("Funding premium exceeds policy");
  const fundingRateBps = clamp(premiumBps, -policy.maxFundingBpsPerInterval, policy.maxFundingBpsPerInterval);
  const cumulativeFundingBps = (input.previous?.cumulativeFundingBps ?? 0) + fundingRateBps;

  const canonical = [
    input.market,
    input.roundId,
    input.indexPrice.toFixed(8),
    input.markPrice.toFixed(8),
    input.intervalStartMs,
    input.intervalEndMs,
    input.longOpenInterestUsd.toFixed(8),
    input.shortOpenInterestUsd.toFixed(8),
    premiumBps,
    fundingRateBps,
    cumulativeFundingBps
  ].join("|");

  return {
    market: input.market,
    roundId: input.roundId,
    indexPrice: input.indexPrice,
    markPrice: input.markPrice,
    intervalStartMs: input.intervalStartMs,
    intervalEndMs: input.intervalEndMs,
    longOpenInterestUsd: input.longOpenInterestUsd,
    shortOpenInterestUsd: input.shortOpenInterestUsd,
    premiumBps,
    fundingRateBps,
    cumulativeFundingBps,
    digest: sha256(canonical)
  };
}

export function assertFundingTransferConservation(input: {
  payerUnits: bigint;
  receiverUnits: bigint;
  protocolResidualUnits: bigint;
  maxRoundingUnits?: bigint;
}) {
  const tolerance = input.maxRoundingUnits ?? 1n;
  if (input.payerUnits < 0n || input.receiverUnits < 0n || input.protocolResidualUnits < 0n || tolerance < 0n) {
    throw new Error("Funding transfer values cannot be negative");
  }
  const expected = input.receiverUnits + input.protocolResidualUnits;
  const delta = input.payerUnits >= expected ? input.payerUnits - expected : expected - input.payerUnits;
  if (delta > tolerance) throw new Error("Funding transfer is not conserved");
  return { conserved: true, roundingUnits: delta };
}

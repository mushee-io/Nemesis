import { createHash } from "node:crypto";

export type MarketOperatingMode = "NORMAL" | "LIMIT_ONLY" | "REDUCE_ONLY" | "SETTLEMENT_ONLY" | "PAUSED";

export type MarketHealthSnapshot = {
  providerHealthy: boolean;
  indexerLagSlots: number;
  oracleHealthy: boolean;
  finalityHealthy: boolean;
  keeperHealthy: boolean;
  solverHealthy: boolean;
  transactionFailureBps: number;
  unresolvedCriticalDisputes: number;
  insolvencyDetected: boolean;
  observedAt: string;
};

export type DegradedMarketPolicy = {
  maxIndexerLagNormal: number;
  maxIndexerLagReduceOnly: number;
  maxTxFailureBpsNormal: number;
  maxTxFailureBpsReduceOnly: number;
  minimumRecoveryObservations: number;
  minimumModeDurationMs: number;
};

export type MarketModeState = {
  market: string;
  mode: MarketOperatingMode;
  generation: number;
  enteredAt: string;
  recoveryObservations: number;
};

const SEVERITY: Record<MarketOperatingMode, number> = { NORMAL: 0, LIMIT_ONLY: 1, REDUCE_ONLY: 2, SETTLEMENT_ONLY: 3, PAUSED: 4 };

export function degradedMarketPolicyRoot(policy: DegradedMarketPolicy) {
  for (const [key, value] of Object.entries(policy)) if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid degraded-market policy ${key}`);
  if (policy.maxIndexerLagNormal > policy.maxIndexerLagReduceOnly) throw new Error("Indexer degraded thresholds are inverted");
  if (policy.maxTxFailureBpsNormal > policy.maxTxFailureBpsReduceOnly) throw new Error("Transaction failure thresholds are inverted");
  if (policy.minimumRecoveryObservations < 1 || policy.minimumModeDurationMs < 1) throw new Error("Invalid degraded-market recovery controls");
  return createHash("sha256").update(Object.values(policy).join("|")).digest("hex");
}

export function requiredMarketMode(snapshot: MarketHealthSnapshot, policy: DegradedMarketPolicy, nowMs = Date.now()): MarketOperatingMode {
  degradedMarketPolicyRoot(policy);
  const observedAt = new Date(snapshot.observedAt).getTime();
  if (!Number.isFinite(observedAt) || observedAt > nowMs + 60_000 || nowMs - observedAt > 120_000) throw new Error("Market health snapshot is stale or invalid");
  if (!Number.isInteger(snapshot.indexerLagSlots) || snapshot.indexerLagSlots < 0) throw new Error("Invalid indexer lag");
  if (!Number.isInteger(snapshot.transactionFailureBps) || snapshot.transactionFailureBps < 0 || snapshot.transactionFailureBps > 10_000) throw new Error("Invalid transaction failure rate");
  if (!Number.isInteger(snapshot.unresolvedCriticalDisputes) || snapshot.unresolvedCriticalDisputes < 0) throw new Error("Invalid dispute count");

  if (snapshot.insolvencyDetected || snapshot.unresolvedCriticalDisputes > 0) return "PAUSED";
  if (!snapshot.finalityHealthy || !snapshot.oracleHealthy) return "SETTLEMENT_ONLY";
  if (!snapshot.providerHealthy || snapshot.indexerLagSlots > policy.maxIndexerLagReduceOnly || snapshot.transactionFailureBps > policy.maxTxFailureBpsReduceOnly || !snapshot.keeperHealthy) return "REDUCE_ONLY";
  if (snapshot.indexerLagSlots > policy.maxIndexerLagNormal || snapshot.transactionFailureBps > policy.maxTxFailureBpsNormal || !snapshot.solverHealthy) return "LIMIT_ONLY";
  return "NORMAL";
}

export function validateMarketModeTransition(input: {
  previous: MarketModeState;
  next: MarketModeState;
  requiredMode: MarketOperatingMode;
  policy: DegradedMarketPolicy;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const previousTime = new Date(input.previous.enteredAt).getTime();
  const nextTime = new Date(input.next.enteredAt).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime) || nextTime <= previousTime || nextTime > nowMs + 60_000) throw new Error("Invalid market-mode transition time");
  if (input.previous.market !== input.next.market) throw new Error("Market identity changed during mode transition");
  if (input.next.generation !== input.previous.generation + 1) throw new Error("Market mode generation must advance exactly once");
  const targetSeverity = SEVERITY[input.next.mode];
  const requiredSeverity = SEVERITY[input.requiredMode];
  if (targetSeverity < requiredSeverity) throw new Error("Market mode is less restrictive than current health requires");

  const relaxing = targetSeverity < SEVERITY[input.previous.mode];
  if (relaxing) {
    if (nextTime - previousTime < input.policy.minimumModeDurationMs) throw new Error("Market mode minimum duration not satisfied");
    if (input.next.recoveryObservations < input.policy.minimumRecoveryObservations) throw new Error("Insufficient healthy observations to relax market mode");
  } else if (input.next.recoveryObservations !== 0) {
    throw new Error("Restrictive or equal transitions must reset recovery observations");
  }

  const digest = createHash("sha256").update([
    input.next.market,
    input.previous.mode,
    input.next.mode,
    input.requiredMode,
    input.next.generation,
    input.next.recoveryObservations,
    new Date(nextTime).toISOString(),
    degradedMarketPolicyRoot(input.policy)
  ].join("|")).digest("hex");
  return { authorized: true, digest, mode: input.next.mode };
}

export function allowedActionsForMode(mode: MarketOperatingMode) {
  if (mode === "NORMAL") return ["MARKET_ORDER", "LIMIT_ORDER", "OPEN", "CLOSE", "WITHDRAW", "SETTLE"] as const;
  if (mode === "LIMIT_ONLY") return ["LIMIT_ORDER", "OPEN", "CLOSE", "WITHDRAW", "SETTLE"] as const;
  if (mode === "REDUCE_ONLY") return ["CLOSE", "REDUCE", "SETTLE"] as const;
  if (mode === "SETTLEMENT_ONLY") return ["SETTLE"] as const;
  return [] as const;
}

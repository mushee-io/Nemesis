import { buildLiquidationCandidates, calculatePartialLiquidationSize, type PerpPositionSnapshot } from "./risk";
import { aggregateOracleQuorum, type NamedOracleSample, type OracleQuorumConfig } from "./oracle-quorum";

export type LiquidationJob = {
  jobId: string;
  account: string;
  positionId: string;
  market: string;
  markPrice: number;
  closeNotionalUsd: number;
  health: number;
  createdAt: string;
  expiresAt: string;
  oracleSources: string[];
};

export class KeeperJobRegistry {
  private readonly consumed = new Set<string>();

  has(jobId: string) {
    return this.consumed.has(jobId);
  }

  consume(jobId: string) {
    if (this.consumed.has(jobId)) throw new Error("Liquidation job already consumed");
    this.consumed.add(jobId);
  }
}

export function buildLiquidationJob(input: {
  account: string;
  position: PerpPositionSnapshot;
  accountEquityUsd: number;
  accountMaintenanceMarginUsd: number;
  oracleSamples: NamedOracleSample[];
  oracleConfig?: OracleQuorumConfig;
  registry?: KeeperJobRegistry;
  targetHealth?: number;
  ttlMs?: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  if (!input.account.trim()) throw new Error("Liquidation account is required");
  const candidates = buildLiquidationCandidates([input.position]);
  const candidate = candidates[0];
  if (!candidate?.liquidatable) throw new Error("Position is not liquidatable");

  const oracle = aggregateOracleQuorum({ samples: input.oracleSamples, config: input.oracleConfig, nowMs });
  const deviationBps = Math.abs(input.position.markPrice - oracle.price) / oracle.price * 10_000;
  const maxDeviationBps = input.oracleConfig?.maxDeviationBps ?? 150;
  if (deviationBps > maxDeviationBps) throw new Error("Position mark diverges from liquidation oracle");

  const closeNotionalUsd = calculatePartialLiquidationSize({
    positionSizeUsd: input.position.sizeUsd,
    accountEquityUsd: input.accountEquityUsd,
    maintenanceMarginUsd: input.accountMaintenanceMarginUsd,
    targetHealth: input.targetHealth
  });
  if (closeNotionalUsd <= 0) throw new Error("Liquidation would not improve account health");

  const ttlMs = input.ttlMs ?? 30_000;
  if (!Number.isFinite(ttlMs) || ttlMs < 5_000 || ttlMs > 120_000) throw new Error("Invalid keeper job TTL");
  const jobId = `${input.account.toLowerCase()}:${input.position.id}:${nowMs}`;
  if (input.registry?.has(jobId)) throw new Error("Liquidation job already consumed");

  return {
    jobId,
    account: input.account,
    positionId: input.position.id,
    market: input.position.market,
    markPrice: oracle.price,
    closeNotionalUsd,
    health: candidate.health,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    oracleSources: oracle.sources
  } satisfies LiquidationJob;
}

export function validateLiquidationJob(job: LiquidationJob, nowMs = Date.now()) {
  if (new Date(job.expiresAt).getTime() <= nowMs) throw new Error("Liquidation job expired");
  if (!Number.isFinite(job.closeNotionalUsd) || job.closeNotionalUsd <= 0) throw new Error("Invalid liquidation size");
  if (!Number.isFinite(job.markPrice) || job.markPrice <= 0) throw new Error("Invalid liquidation mark price");
  return job;
}

export function commitLiquidationJob(registry: KeeperJobRegistry, job: LiquidationJob) {
  validateLiquidationJob(job);
  registry.consume(job.jobId);
  return job;
}

import type { OracleSample } from "./protocol";

export type NamedOracleSample = OracleSample & { source: string };

export type OracleQuorumConfig = {
  minimumSources: number;
  maxAgeMs: number;
  maxConfidenceBps: number;
  maxDeviationBps: number;
};

export const DEFAULT_ORACLE_QUORUM: OracleQuorumConfig = {
  minimumSources: 2,
  maxAgeMs: 30_000,
  maxConfidenceBps: 100,
  maxDeviationBps: 150
};

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function aggregateOracleQuorum(input: {
  samples: NamedOracleSample[];
  config?: OracleQuorumConfig;
  nowMs?: number;
}) {
  const config = input.config ?? DEFAULT_ORACLE_QUORUM;
  const nowMs = input.nowMs ?? Date.now();
  const usable = input.samples.filter((sample) => {
    if (!sample.source.trim()) return false;
    if (!Number.isFinite(sample.price) || sample.price <= 0) return false;
    if (!Number.isFinite(sample.timestampMs) || sample.timestampMs > nowMs + 5_000) return false;
    if (nowMs - sample.timestampMs > config.maxAgeMs) return false;
    if ((sample.confidenceBps ?? 0) > config.maxConfidenceBps) return false;
    return true;
  });

  const uniqueSources = new Map(usable.map((sample) => [sample.source, sample]));
  const unique = [...uniqueSources.values()];
  if (unique.length < config.minimumSources) throw new Error("Oracle quorum unavailable");

  const price = median(unique.map((sample) => sample.price));
  const accepted = unique.filter((sample) => Math.abs(sample.price - price) / price * 10_000 <= config.maxDeviationBps);
  if (accepted.length < config.minimumSources) throw new Error("Oracle quorum diverged beyond guardrail");

  const aggregatePrice = median(accepted.map((sample) => sample.price));
  const newestTimestampMs = Math.max(...accepted.map((sample) => sample.timestampMs));
  const oldestTimestampMs = Math.min(...accepted.map((sample) => sample.timestampMs));

  return {
    price: aggregatePrice,
    sourceCount: accepted.length,
    sources: accepted.map((sample) => sample.source),
    newestTimestampMs,
    oldestTimestampMs,
    maxObservedDeviationBps: Math.max(...accepted.map((sample) => Math.abs(sample.price - aggregatePrice) / aggregatePrice * 10_000))
  };
}

export type PreprodSoakSample = {
  timestamp: string;
  readinessPassed: boolean;
  providerLagSlots: number;
  indexerLagSlots: number;
  oracleSourceCount: number;
  failedTxRateBps: number;
  p95ConfirmationMs: number;
  chainTipAgeMs: number;
  reorgDepth: number;
  criticalIncidents: number;
};

export type PreprodSoakPolicy = {
  minimumSamples: number;
  minimumDurationMs: number;
  maxGapMs: number;
  maxProviderLagSlots: number;
  maxIndexerLagSlots: number;
  minimumOracleSources: number;
  maxFailedTxRateBps: number;
  maxConsecutiveFailureBreaches: number;
  maxP95ConfirmationMs: number;
  maxChainTipAgeMs: number;
  maxReorgDepth: number;
  maxSampleAgeMs: number;
};

export const DEFAULT_PREPROD_SOAK_POLICY: PreprodSoakPolicy = {
  minimumSamples: 12,
  minimumDurationMs: 6 * 60 * 60 * 1000,
  maxGapMs: 45 * 60 * 1000,
  maxProviderLagSlots: 20,
  maxIndexerLagSlots: 30,
  minimumOracleSources: 2,
  maxFailedTxRateBps: 100,
  maxConsecutiveFailureBreaches: 0,
  maxP95ConfirmationMs: 180_000,
  maxChainTipAgeMs: 120_000,
  maxReorgDepth: 2,
  maxSampleAgeMs: 30 * 60 * 1000
};

export function evaluatePreprodSoak(
  samples: PreprodSoakSample[],
  policy: PreprodSoakPolicy = DEFAULT_PREPROD_SOAK_POLICY,
  nowMs = Date.now()
) {
  if (samples.length < policy.minimumSamples) throw new Error("Insufficient Preprod soak samples");
  const parsed = samples.map((sample) => ({ ...sample, timeMs: new Date(sample.timestamp).getTime() }));
  if (parsed.some((sample) => !Number.isFinite(sample.timeMs))) throw new Error("Invalid soak timestamp");
  parsed.sort((a, b) => a.timeMs - b.timeMs);
  if (new Set(parsed.map((sample) => sample.timeMs)).size !== parsed.length) throw new Error("Duplicate Preprod soak timestamp");
  if (parsed.some((sample) => sample.timeMs > nowMs + 60_000)) throw new Error("Preprod soak sample is future-dated");
  if (nowMs - parsed[parsed.length - 1].timeMs > policy.maxSampleAgeMs) throw new Error("Preprod soak evidence is stale");
  if (parsed[parsed.length - 1].timeMs - parsed[0].timeMs < policy.minimumDurationMs) throw new Error("Preprod soak duration is too short");

  let consecutiveFailureBreaches = 0;
  for (let index = 0; index < parsed.length; index += 1) {
    const sample = parsed[index];
    if (index > 0 && sample.timeMs - parsed[index - 1].timeMs > policy.maxGapMs) throw new Error("Preprod soak has a monitoring gap");
    if (!sample.readinessPassed) throw new Error("Preprod readiness failed during soak");
    if (!Number.isInteger(sample.providerLagSlots) || sample.providerLagSlots < 0 || sample.providerLagSlots > policy.maxProviderLagSlots) throw new Error("Provider lag exceeded soak policy");
    if (!Number.isInteger(sample.indexerLagSlots) || sample.indexerLagSlots < 0 || sample.indexerLagSlots > policy.maxIndexerLagSlots) throw new Error("Indexer lag exceeded soak policy");
    if (!Number.isInteger(sample.oracleSourceCount) || sample.oracleSourceCount < policy.minimumOracleSources) throw new Error("Oracle quorum degraded during soak");
    if (!Number.isInteger(sample.failedTxRateBps) || sample.failedTxRateBps < 0) throw new Error("Invalid transaction failure rate");
    if (sample.failedTxRateBps > policy.maxFailedTxRateBps) consecutiveFailureBreaches += 1;
    else consecutiveFailureBreaches = 0;
    if (consecutiveFailureBreaches > policy.maxConsecutiveFailureBreaches) throw new Error("Transaction failure rate exceeded soak policy");
    if (!Number.isInteger(sample.p95ConfirmationMs) || sample.p95ConfirmationMs < 0 || sample.p95ConfirmationMs > policy.maxP95ConfirmationMs) throw new Error("Confirmation latency exceeded soak policy");
    if (!Number.isInteger(sample.chainTipAgeMs) || sample.chainTipAgeMs < 0 || sample.chainTipAgeMs > policy.maxChainTipAgeMs) throw new Error("Chain tip is too stale during soak");
    if (!Number.isInteger(sample.reorgDepth) || sample.reorgDepth < 0 || sample.reorgDepth > policy.maxReorgDepth) throw new Error("Reorg depth exceeded soak policy");
    if (!Number.isInteger(sample.criticalIncidents) || sample.criticalIncidents !== 0) throw new Error("Critical incident observed during soak");
  }

  return {
    passed: true,
    sampleCount: parsed.length,
    durationMs: parsed[parsed.length - 1].timeMs - parsed[0].timeMs,
    startedAt: new Date(parsed[0].timeMs).toISOString(),
    endedAt: new Date(parsed[parsed.length - 1].timeMs).toISOString(),
    maxObservedReorgDepth: Math.max(...parsed.map((sample) => sample.reorgDepth)),
    maxObservedConfirmationMs: Math.max(...parsed.map((sample) => sample.p95ConfirmationMs))
  };
}

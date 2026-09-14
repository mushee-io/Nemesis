export type PreprodSoakSample = {
  timestamp: string;
  readinessPassed: boolean;
  providerLagSlots: number;
  indexerLagSlots: number;
  oracleSourceCount: number;
  failedTxRateBps: number;
};

export type PreprodSoakPolicy = {
  minimumSamples: number;
  minimumDurationMs: number;
  maxGapMs: number;
  maxProviderLagSlots: number;
  maxIndexerLagSlots: number;
  minimumOracleSources: number;
  maxFailedTxRateBps: number;
};

export const DEFAULT_PREPROD_SOAK_POLICY: PreprodSoakPolicy = {
  minimumSamples: 6,
  minimumDurationMs: 60 * 60 * 1000,
  maxGapMs: 20 * 60 * 1000,
  maxProviderLagSlots: 20,
  maxIndexerLagSlots: 30,
  minimumOracleSources: 2,
  maxFailedTxRateBps: 100
};

export function evaluatePreprodSoak(
  samples: PreprodSoakSample[],
  policy: PreprodSoakPolicy = DEFAULT_PREPROD_SOAK_POLICY
) {
  if (samples.length < policy.minimumSamples) throw new Error("Insufficient Preprod soak samples");
  const parsed = samples.map((sample) => ({ ...sample, timeMs: new Date(sample.timestamp).getTime() }));
  if (parsed.some((sample) => !Number.isFinite(sample.timeMs))) throw new Error("Invalid soak timestamp");
  parsed.sort((a, b) => a.timeMs - b.timeMs);
  if (parsed[parsed.length - 1].timeMs - parsed[0].timeMs < policy.minimumDurationMs) {
    throw new Error("Preprod soak duration is too short");
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index].timeMs - parsed[index - 1].timeMs > policy.maxGapMs) throw new Error("Preprod soak has a monitoring gap");
  }
  for (const sample of parsed) {
    if (!sample.readinessPassed) throw new Error("Preprod readiness failed during soak");
    if (!Number.isInteger(sample.providerLagSlots) || sample.providerLagSlots < 0 || sample.providerLagSlots > policy.maxProviderLagSlots) {
      throw new Error("Provider lag exceeded soak policy");
    }
    if (!Number.isInteger(sample.indexerLagSlots) || sample.indexerLagSlots < 0 || sample.indexerLagSlots > policy.maxIndexerLagSlots) {
      throw new Error("Indexer lag exceeded soak policy");
    }
    if (!Number.isInteger(sample.oracleSourceCount) || sample.oracleSourceCount < policy.minimumOracleSources) {
      throw new Error("Oracle quorum degraded during soak");
    }
    if (!Number.isInteger(sample.failedTxRateBps) || sample.failedTxRateBps < 0 || sample.failedTxRateBps > policy.maxFailedTxRateBps) {
      throw new Error("Transaction failure rate exceeded soak policy");
    }
  }
  return {
    passed: true,
    sampleCount: parsed.length,
    durationMs: parsed[parsed.length - 1].timeMs - parsed[0].timeMs,
    startedAt: new Date(parsed[0].timeMs).toISOString(),
    endedAt: new Date(parsed[parsed.length - 1].timeMs).toISOString()
  };
}

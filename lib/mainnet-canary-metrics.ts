import { createHash } from "node:crypto";

export type MainnetCanarySample = {
  slot: number;
  timestamp: string;
  txAttempts: number;
  txFailures: number;
  p95ConfirmationSeconds: number;
  oracleAvailabilityBps: number;
  providerLagSlots: number;
  indexerLagSlots: number;
  criticalIncidents: number;
  totalNotionalUnits: string;
};
export type MainnetCanaryPolicy = {
  minimumSamples: number;
  maxFailureBps: number;
  maxP95ConfirmationSeconds: number;
  minOracleAvailabilityBps: number;
  maxProviderLagSlots: number;
  maxIndexerLagSlots: number;
  maxCriticalIncidents: number;
  maxNotionalUnits: string;
};

function units(v: string, label: string) { if (!/^\d+$/.test(v)) throw new Error(`${label} must be a non-negative integer string`); return BigInt(v); }

export function verifyMainnetCanaryMetrics(samples: MainnetCanarySample[], policy: MainnetCanaryPolicy) {
  if (!Number.isInteger(policy.minimumSamples) || policy.minimumSamples < 1 || samples.length < policy.minimumSamples) throw new Error("Insufficient mainnet canary samples");
  if (!Number.isInteger(policy.maxFailureBps) || policy.maxFailureBps < 0 || policy.maxFailureBps > 10_000) throw new Error("Invalid canary failure threshold");
  const maxNotional = units(policy.maxNotionalUnits, "Canary max notional");
  let previousSlot = 0, previousTime = 0, attempts = 0, failures = 0, incidents = 0;
  const material: string[] = [];
  for (const s of samples) {
    const time = new Date(s.timestamp).getTime();
    if (!Number.isInteger(s.slot) || s.slot <= previousSlot || !Number.isFinite(time) || time <= previousTime) throw new Error("Canary telemetry must be strictly ordered");
    if (!Number.isInteger(s.txAttempts) || s.txAttempts < 1 || !Number.isInteger(s.txFailures) || s.txFailures < 0 || s.txFailures > s.txAttempts) throw new Error("Invalid canary transaction counts");
    if (!Number.isFinite(s.p95ConfirmationSeconds) || s.p95ConfirmationSeconds > policy.maxP95ConfirmationSeconds) throw new Error("Canary confirmation latency exceeded");
    if (!Number.isInteger(s.oracleAvailabilityBps) || s.oracleAvailabilityBps < policy.minOracleAvailabilityBps || s.oracleAvailabilityBps > 10_000) throw new Error("Canary oracle availability failed");
    if (s.providerLagSlots > policy.maxProviderLagSlots || s.indexerLagSlots > policy.maxIndexerLagSlots) throw new Error("Canary infrastructure lag exceeded");
    if (!Number.isInteger(s.criticalIncidents) || s.criticalIncidents < 0) throw new Error("Invalid canary incident count");
    if (units(s.totalNotionalUnits, "Canary notional") > maxNotional) throw new Error("Canary notional cap exceeded");
    attempts += s.txAttempts; failures += s.txFailures; incidents += s.criticalIncidents;
    material.push([s.slot, new Date(time).toISOString(), s.txAttempts, s.txFailures, s.p95ConfirmationSeconds, s.oracleAvailabilityBps, s.providerLagSlots, s.indexerLagSlots, s.criticalIncidents, s.totalNotionalUnits].join(":"));
    previousSlot = s.slot; previousTime = time;
  }
  const failureBps = Math.floor(failures * 10_000 / attempts);
  if (failureBps > policy.maxFailureBps) throw new Error("Canary transaction failure rate exceeded");
  if (incidents > policy.maxCriticalIncidents) throw new Error("Canary critical incident threshold exceeded");
  const digest = createHash("sha256").update([...material, failureBps, incidents].join("|")).digest("hex");
  return { verified: true, digest, sampleCount: samples.length, failureBps, criticalIncidents: incidents };
}

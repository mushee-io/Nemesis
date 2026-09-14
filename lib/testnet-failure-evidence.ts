import { createHash } from "node:crypto";
import { validateRebuildAttempt, type LedgerFailureCode, type RebuildAttempt, type TransactionRebuildPolicy } from "./transaction-rebuild";

export const REQUIRED_TESTNET_FAILURE_SCENARIOS = [
  "BAD_INPUTS_REBUILD",
  "VALIDITY_REBUILD",
  "AMBIGUOUS_TIMEOUT_LOOKUP",
  "PROVIDER_FAILOVER",
  "INDEXER_LAG_DEGRADE",
  "ORACLE_STALE_DEGRADE",
  "CHAIN_REORG_RECOVERY"
] as const;
export type TestnetFailureScenario = typeof REQUIRED_TESTNET_FAILURE_SCENARIOS[number];

export type TestnetFailureResult = {
  scenario: TestnetFailureScenario;
  passed: boolean;
  startedAt: string;
  recoveredAt: string;
  evidenceSha256: string;
  dataLossDetected: boolean;
  previous?: RebuildAttempt;
  next?: RebuildAttempt;
  failureCode?: LedgerFailureCode;
  txPresenceChecked?: boolean;
  txAlreadyObserved?: boolean;
};

export type TestnetFailurePolicy = {
  maximumRecoveryMs: number;
  rebuildPolicy: TransactionRebuildPolicy;
};

function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be 64 hex`); return v.toLowerCase(); }

export function validateTestnetFailureEvidence(results: TestnetFailureResult[], policy: TestnetFailurePolicy, nowMs = Date.now()) {
  if (!Number.isInteger(policy.maximumRecoveryMs) || policy.maximumRecoveryMs < 1) throw new Error("Maximum testnet recovery time must be positive");
  if (results.length !== REQUIRED_TESTNET_FAILURE_SCENARIOS.length) throw new Error("Finalized testnet failure suite must include every required scenario exactly once");
  const seen = new Set<TestnetFailureScenario>();
  const digests: string[] = [];
  for (const result of results) {
    if (seen.has(result.scenario)) throw new Error("Duplicate testnet failure scenario");
    seen.add(result.scenario);
    if (!result.passed) throw new Error(`${result.scenario} did not pass`);
    if (result.dataLossDetected) throw new Error(`${result.scenario} detected data loss`);
    const started = new Date(result.startedAt).getTime(), recovered = new Date(result.recoveredAt).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(recovered) || recovered < started || recovered - started > policy.maximumRecoveryMs || recovered > nowMs + 60_000) throw new Error(`${result.scenario} recovery window is invalid`);
    const evidence = d64(result.evidenceSha256, `${result.scenario} evidence`);
    if (result.scenario === "BAD_INPUTS_REBUILD") {
      if (!result.previous || !result.next || result.failureCode !== "BAD_INPUTS") throw new Error("BAD_INPUTS scenario requires concrete rebuild attempts");
      validateRebuildAttempt({ previous: result.previous, next: result.next, failure: "BAD_INPUTS", policy: policy.rebuildPolicy, nowMs });
    }
    if (result.scenario === "VALIDITY_REBUILD") {
      if (!result.previous || !result.next || result.failureCode !== "OUTSIDE_VALIDITY") throw new Error("Validity scenario requires concrete rebuild attempts");
      validateRebuildAttempt({ previous: result.previous, next: result.next, failure: "OUTSIDE_VALIDITY", policy: policy.rebuildPolicy, nowMs });
    }
    if (result.scenario === "AMBIGUOUS_TIMEOUT_LOOKUP") {
      if (!result.previous || !result.next || result.failureCode !== "PROVIDER_TIMEOUT") throw new Error("Timeout scenario requires concrete rebuild attempts");
      validateRebuildAttempt({ previous: result.previous, next: result.next, failure: "PROVIDER_TIMEOUT", policy: policy.rebuildPolicy, txPresenceChecked: result.txPresenceChecked, txAlreadyObserved: result.txAlreadyObserved, nowMs });
    }
    digests.push(createHash("sha256").update([result.scenario,evidence,new Date(started).toISOString(),new Date(recovered).toISOString()].join("|")).digest("hex"));
  }
  for (const scenario of REQUIRED_TESTNET_FAILURE_SCENARIOS) if (!seen.has(scenario)) throw new Error(`Missing failure scenario ${scenario}`);
  const root = createHash("sha256").update(digests.sort().join("|")).digest("hex");
  return { root, scenarioCount: seen.size, passed: true };
}

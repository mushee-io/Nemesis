export type ChaosScenario =
  | "PROVIDER_OUTAGE"
  | "INDEXER_LAG"
  | "ORACLE_DIVERGENCE"
  | "ORACLE_ROLLBACK"
  | "KEEPER_REPLAY"
  | "SOLVER_REPLAY"
  | "TX_DUPLICATE"
  | "SHALLOW_REORG"
  | "WITHDRAWAL_RUN"
  | "ROLLBACK_DRILL";

export type ChaosResult = {
  scenario: ChaosScenario;
  passed: boolean;
  startedAt: string;
  recoveredAt: string;
  evidenceSha256: string;
  dataLossDetected: boolean;
};

export type ChaosPolicy = {
  maximumRecoveryMs: Partial<Record<ChaosScenario, number>>;
  maximumEvidenceAgeMs: number;
};

export const REQUIRED_CHAOS_SCENARIOS: ChaosScenario[] = [
  "PROVIDER_OUTAGE",
  "INDEXER_LAG",
  "ORACLE_DIVERGENCE",
  "ORACLE_ROLLBACK",
  "KEEPER_REPLAY",
  "SOLVER_REPLAY",
  "TX_DUPLICATE",
  "SHALLOW_REORG",
  "WITHDRAWAL_RUN",
  "ROLLBACK_DRILL"
];

export const DEFAULT_CHAOS_POLICY: ChaosPolicy = {
  maximumRecoveryMs: {
    PROVIDER_OUTAGE: 10 * 60 * 1000,
    INDEXER_LAG: 15 * 60 * 1000,
    ORACLE_DIVERGENCE: 5 * 60 * 1000,
    ORACLE_ROLLBACK: 5 * 60 * 1000,
    KEEPER_REPLAY: 60_000,
    SOLVER_REPLAY: 60_000,
    TX_DUPLICATE: 60_000,
    SHALLOW_REORG: 10 * 60 * 1000,
    WITHDRAWAL_RUN: 5 * 60 * 1000,
    ROLLBACK_DRILL: 15 * 60 * 1000
  },
  maximumEvidenceAgeMs: 24 * 60 * 60 * 1000
};

export function evaluateChaosGate(
  results: ChaosResult[],
  policy: ChaosPolicy = DEFAULT_CHAOS_POLICY,
  nowMs = Date.now()
) {
  if (!Number.isInteger(policy.maximumEvidenceAgeMs) || policy.maximumEvidenceAgeMs <= 0) throw new Error("Invalid chaos evidence age policy");
  const seen = new Set<ChaosScenario>();
  let maximumObservedRecoveryMs = 0;

  for (const result of results) {
    if (seen.has(result.scenario)) throw new Error("Duplicate chaos scenario evidence");
    seen.add(result.scenario);
    if (!REQUIRED_CHAOS_SCENARIOS.includes(result.scenario)) throw new Error("Unknown chaos scenario");
    if (!result.passed) throw new Error(`Chaos scenario failed: ${result.scenario}`);
    if (result.dataLossDetected) throw new Error(`Chaos scenario detected data loss: ${result.scenario}`);
    if (!/^[0-9a-f]{64}$/i.test(result.evidenceSha256)) throw new Error("Invalid chaos evidence digest");
    const startedAt = new Date(result.startedAt).getTime();
    const recoveredAt = new Date(result.recoveredAt).getTime();
    if (!Number.isFinite(startedAt) || !Number.isFinite(recoveredAt) || recoveredAt < startedAt) throw new Error("Invalid chaos recovery window");
    if (recoveredAt > nowMs + 60_000) throw new Error("Chaos evidence is future-dated");
    if (nowMs - recoveredAt > policy.maximumEvidenceAgeMs) throw new Error("Chaos evidence is stale");
    const recoveryMs = recoveredAt - startedAt;
    const maximum = policy.maximumRecoveryMs[result.scenario];
    if (!Number.isInteger(maximum) || (maximum ?? 0) <= 0) throw new Error(`Missing recovery policy for ${result.scenario}`);
    if (recoveryMs > maximum!) throw new Error(`Chaos recovery exceeded policy: ${result.scenario}`);
    maximumObservedRecoveryMs = Math.max(maximumObservedRecoveryMs, recoveryMs);
  }

  const missing = REQUIRED_CHAOS_SCENARIOS.filter((scenario) => !seen.has(scenario));
  if (missing.length) throw new Error(`Missing chaos scenarios: ${missing.join(",")}`);

  return {
    passed: true,
    scenarioCount: results.length,
    maximumObservedRecoveryMs
  };
}

import type { CardanoNetwork } from "./cardano-execution";

export type CanaryStage = "CANARY_1" | "CANARY_10" | "CANARY_50" | "FULL";

export type CanaryObservation = {
  stage: CanaryStage;
  startedAt: string;
  endedAt: string;
  transactions: number;
  failedTransactions: number;
  uniqueAccounts: number;
  notionalUsd: number;
  criticalIncidents: number;
};

export type RollbackManifest = {
  network: CardanoNetwork;
  rollbackCommitSha: string;
  rollbackBuildSha256: string;
  rollbackBlueprintSha256: string;
  reasonHash: string;
  generatedAt: string;
};

export type RollbackDrill = {
  network: CardanoNetwork;
  detectedAt: string;
  rollbackStartedAt: string;
  rollbackCompletedAt: string;
  restoredCommitSha: string;
  restoredBuildSha256: string;
  restoredBlueprintSha256: string;
  stateConsistencyPassed: boolean;
  dataLossDetected: boolean;
};

const STAGES: CanaryStage[] = ["CANARY_1", "CANARY_10", "CANARY_50", "FULL"];
const LIMITS: Record<CanaryStage, { maxNotionalUsd: number; minTransactions: number; minDurationMs: number; maxFailureBps: number }> = {
  CANARY_1: { maxNotionalUsd: 25_000, minTransactions: 20, minDurationMs: 30 * 60 * 1000, maxFailureBps: 100 },
  CANARY_10: { maxNotionalUsd: 250_000, minTransactions: 100, minDurationMs: 2 * 60 * 60 * 1000, maxFailureBps: 75 },
  CANARY_50: { maxNotionalUsd: 1_000_000, minTransactions: 500, minDurationMs: 6 * 60 * 60 * 1000, maxFailureBps: 50 },
  FULL: { maxNotionalUsd: 5_000_000, minTransactions: 1_000, minDurationMs: 12 * 60 * 60 * 1000, maxFailureBps: 25 }
};

function sha40(value: string, label: string) {
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error(`${label} must be a 40-character git SHA`);
}
function sha64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

export function validateRollbackManifest(manifest: RollbackManifest, expectedNetwork: CardanoNetwork, nowMs = Date.now()) {
  if (manifest.network !== expectedNetwork) throw new Error("Rollback manifest network mismatch");
  sha40(manifest.rollbackCommitSha, "Rollback commit");
  sha64(manifest.rollbackBuildSha256, "Rollback build");
  sha64(manifest.rollbackBlueprintSha256, "Rollback blueprint");
  sha64(manifest.reasonHash, "Rollback reason");
  const generatedAt = new Date(manifest.generatedAt).getTime();
  if (!Number.isFinite(generatedAt) || generatedAt > nowMs + 60_000) throw new Error("Invalid rollback manifest timestamp");
  if (nowMs - generatedAt > 24 * 60 * 60 * 1000) throw new Error("Rollback manifest is stale");
  if (manifest.rollbackBuildSha256.toLowerCase() === manifest.rollbackBlueprintSha256.toLowerCase()) throw new Error("Rollback artifacts must be independently fingerprinted");
  return true;
}

export function evaluateCanaryObservation(observation: CanaryObservation) {
  const limits = LIMITS[observation.stage];
  const startedAt = new Date(observation.startedAt).getTime();
  const endedAt = new Date(observation.endedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) throw new Error("Invalid canary observation window");
  if (!Number.isInteger(observation.transactions) || observation.transactions < limits.minTransactions) throw new Error("Insufficient canary transactions");
  if (!Number.isInteger(observation.failedTransactions) || observation.failedTransactions < 0 || observation.failedTransactions > observation.transactions) throw new Error("Invalid canary failed transaction count");
  if (!Number.isInteger(observation.uniqueAccounts) || observation.uniqueAccounts < 1) throw new Error("Canary requires unique account participation");
  if (!Number.isFinite(observation.notionalUsd) || observation.notionalUsd < 0 || observation.notionalUsd > limits.maxNotionalUsd) throw new Error("Canary notional exceeds stage cap");
  if (observation.criticalIncidents !== 0) throw new Error("Canary observed a critical incident");
  if (endedAt - startedAt < limits.minDurationMs) throw new Error("Canary observation duration is too short");
  const failureBps = Math.round(observation.failedTransactions / observation.transactions * 10_000);
  if (failureBps > limits.maxFailureBps) throw new Error("Canary failure rate exceeds stage policy");
  return { passed: true, stage: observation.stage, failureBps, durationMs: endedAt - startedAt };
}

export function evaluateCanaryHistory(history: CanaryObservation[]) {
  if (history.length < 1 || history.length > STAGES.length) throw new Error("Invalid canary history length");
  let previousEnd = -Infinity;
  for (let index = 0; index < history.length; index += 1) {
    const observation = history[index];
    if (observation.stage !== STAGES[index]) throw new Error("Canary history must follow the staged rollout order");
    evaluateCanaryObservation(observation);
    const start = new Date(observation.startedAt).getTime();
    const end = new Date(observation.endedAt).getTime();
    if (start < previousEnd) throw new Error("Canary stages must not overlap");
    previousEnd = end;
  }
  return {
    passed: true,
    completedStages: history.map((item) => item.stage),
    currentStage: history[history.length - 1].stage
  };
}

export function validateRollbackDrill(input: {
  drill: RollbackDrill;
  manifest: RollbackManifest;
  maximumRecoveryMs?: number;
}) {
  const maximumRecoveryMs = input.maximumRecoveryMs ?? 15 * 60 * 1000;
  if (input.drill.network !== input.manifest.network) throw new Error("Rollback drill network mismatch");
  sha40(input.drill.restoredCommitSha, "Restored commit");
  sha64(input.drill.restoredBuildSha256, "Restored build");
  sha64(input.drill.restoredBlueprintSha256, "Restored blueprint");
  if (input.drill.restoredCommitSha.toLowerCase() !== input.manifest.rollbackCommitSha.toLowerCase()) throw new Error("Rollback drill restored the wrong commit");
  if (input.drill.restoredBuildSha256.toLowerCase() !== input.manifest.rollbackBuildSha256.toLowerCase()) throw new Error("Rollback drill restored the wrong build");
  if (input.drill.restoredBlueprintSha256.toLowerCase() !== input.manifest.rollbackBlueprintSha256.toLowerCase()) throw new Error("Rollback drill restored the wrong blueprint");
  if (!input.drill.stateConsistencyPassed) throw new Error("Rollback drill state consistency failed");
  if (input.drill.dataLossDetected) throw new Error("Rollback drill detected data loss");
  const detected = new Date(input.drill.detectedAt).getTime();
  const started = new Date(input.drill.rollbackStartedAt).getTime();
  const completed = new Date(input.drill.rollbackCompletedAt).getTime();
  if (![detected, started, completed].every(Number.isFinite) || started < detected || completed < started) throw new Error("Invalid rollback drill timeline");
  if (!Number.isInteger(maximumRecoveryMs) || maximumRecoveryMs <= 0 || completed - detected > maximumRecoveryMs) throw new Error("Rollback drill exceeded recovery policy");
  return { passed: true, recoveryMs: completed - detected };
}

export function authorizeCanaryPromotion(input: {
  current: CanaryObservation;
  next: CanaryStage;
  governorApprovals: string[];
  governorThreshold: number;
}) {
  evaluateCanaryObservation(input.current);
  const currentIndex = STAGES.indexOf(input.current.stage);
  const nextIndex = STAGES.indexOf(input.next);
  if (nextIndex !== currentIndex + 1) throw new Error("Canary promotion must advance exactly one stage");
  const approvals = input.governorApprovals.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (new Set(approvals).size !== approvals.length) throw new Error("Duplicate canary governor approval");
  if (approvals.length < input.governorThreshold) throw new Error("Canary promotion governor quorum not reached");
  return { authorized: true, from: input.current.stage, to: input.next };
}

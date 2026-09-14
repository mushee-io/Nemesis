import { createHash } from "node:crypto";
import { validateRegistryCriticalState, type RegistryCriticalState } from "./registry-critical-state";
import { buildProtocolStateRoot, type ProtocolStateCheckpoint } from "./protocol-state-root";
import { validateProtocolMigration, type ProtocolMigrationPlan } from "./protocol-migration";
import { riskParameterDigest, type RiskParameterSet } from "./risk-parameter-governance";
import { operatorSetRoot, type OperatorSet } from "./operator-set-governance";
import { settlementSafetyRoot, type SettlementSafetyInputs } from "./settlement-safety-root";
import { evaluateChaosGate, type ChaosPolicy, type ChaosResult } from "./chaos-gate";

export type ProductionReviewBundle = {
  sourcePreprodDigest: string;
  registry: RegistryCriticalState;
  checkpoint: ProtocolStateCheckpoint;
  migration: ProtocolMigrationPlan;
  activeRisk: RiskParameterSet;
  operators: OperatorSet;
  settlement: SettlementSafetyInputs;
  chaosResults: ChaosResult[];
  reviewerApprovals: string[];
  issuedAt: string;
  expiresAt: string;
};
function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be SHA-256`); return v.toLowerCase(); }

export function buildProductionReviewCertificate(input: { bundle: ProductionReviewBundle; minimumReviewers: number; migrationGovernorQuorum: number; chaosPolicy: ChaosPolicy; nowMs?: number }) {
  const nowMs = input.nowMs ?? Date.now(), b = input.bundle;
  const sourcePreprodDigest = d64(b.sourcePreprodDigest, "Source Preprod release");
  const registry = validateRegistryCriticalState(b.registry);
  if (registry.paused) throw new Error("Production review cannot pass while Registry is paused");
  const checkpoint = buildProtocolStateRoot(b.checkpoint);
  if (b.checkpoint.deploymentEpoch !== registry.deploymentEpoch) throw new Error("Checkpoint epoch does not match Registry");
  if (checkpoint.root !== registry.stateRoot) throw new Error("Registry state root does not match protocol checkpoint");
  const migration = validateProtocolMigration(b.migration, input.migrationGovernorQuorum, nowMs);
  if (b.migration.toEpoch !== registry.deploymentEpoch || b.migration.nextRegistryRoot.toLowerCase() !== checkpoint.root) throw new Error("Migration target does not match Registry checkpoint");
  if (migration.digest !== registry.migrationRoot) throw new Error("Registry migration root mismatch");
  const riskRoot = riskParameterDigest(b.activeRisk);
  if (riskRoot !== registry.riskRoot) throw new Error("Registry risk root mismatch");
  const operatorRoot = operatorSetRoot(b.operators);
  if (operatorRoot !== registry.operatorRoot) throw new Error("Registry operator root mismatch");
  const settlementRoot = settlementSafetyRoot(b.settlement);
  if (settlementRoot !== registry.settlementRoot) throw new Error("Registry settlement root mismatch");
  const chaos = evaluateChaosGate(b.chaosResults, input.chaosPolicy, nowMs);
  const chaosDigest = createHash("sha256").update(b.chaosResults.map((r) => `${r.scenario}:${r.evidenceSha256.toLowerCase()}`).sort().join("|")).digest("hex");
  if (!Number.isInteger(input.minimumReviewers) || input.minimumReviewers < 2) throw new Error("Production review requires multiple reviewers");
  if (new Set(b.reviewerApprovals).size !== b.reviewerApprovals.length || b.reviewerApprovals.length < input.minimumReviewers) throw new Error("Insufficient independent review approvals");
  const issuedAt = new Date(b.issuedAt).getTime(), expiresAt = new Date(b.expiresAt).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || issuedAt > nowMs + 60_000 || nowMs > expiresAt) throw new Error("Production review certificate window is invalid");
  const digest = createHash("sha256").update([sourcePreprodDigest, registry.digest, checkpoint.root, migration.digest, riskRoot, operatorRoot, settlementRoot, chaosDigest, ...b.reviewerApprovals.slice().sort(), new Date(issuedAt).toISOString(), new Date(expiresAt).toISOString()].join("|")).digest("hex");
  return { reviewReady: true, activationAllowed: false as const, digest, sourcePreprodDigest, registryDigest: registry.digest, checkpointRoot: checkpoint.root, chaosScenarios: chaos.scenarioCount };
}

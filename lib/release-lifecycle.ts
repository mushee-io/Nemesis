import { createHash } from "node:crypto";
import type { CardanoNetwork } from "./cardano-execution";

export type ReleasePhase = "BUILDING" | "DEPLOYED" | "CANARY" | "SOAK" | "CERTIFIED" | "PREPROD_LIVE" | "PAUSED" | "ROLLED_BACK";

export type ReleaseLifecycleEvidence = {
  deploymentEpochDigest?: string;
  registryStateRoot?: string;
  finalityEvidenceDigest?: string;
  oracleFundingAnchorDigest?: string;
  crossProductReconciliationDigest?: string;
  releaseAttestationDigest?: string;
  soakEvidenceDigest?: string;
};

export type ReleaseLifecycleState = {
  releaseId: string;
  network: CardanoNetwork;
  phase: ReleasePhase;
  deploymentEpoch: number;
  generation: number;
  evidence: ReleaseLifecycleEvidence;
  enteredAt: string;
  previousStateDigest?: string;
};

export type ReleaseTransitionPolicy = {
  expectedNetwork: CardanoNetwork;
  requireStableFinalityForLive: boolean;
};

function digest64(value: string | undefined, label: string) {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function canonicalState(state: ReleaseLifecycleState) {
  return [
    state.releaseId,
    state.network,
    state.phase,
    state.deploymentEpoch,
    state.generation,
    state.previousStateDigest?.toLowerCase() ?? "GENESIS",
    state.evidence.deploymentEpochDigest?.toLowerCase() ?? "",
    state.evidence.registryStateRoot?.toLowerCase() ?? "",
    state.evidence.finalityEvidenceDigest?.toLowerCase() ?? "",
    state.evidence.oracleFundingAnchorDigest?.toLowerCase() ?? "",
    state.evidence.crossProductReconciliationDigest?.toLowerCase() ?? "",
    state.evidence.releaseAttestationDigest?.toLowerCase() ?? "",
    state.evidence.soakEvidenceDigest?.toLowerCase() ?? "",
    state.enteredAt
  ].join("|");
}

export function releaseLifecycleDigest(state: ReleaseLifecycleState) {
  return createHash("sha256").update(canonicalState(state)).digest("hex");
}

function requiredEvidence(phase: ReleasePhase, evidence: ReleaseLifecycleEvidence, policy: ReleaseTransitionPolicy) {
  if (["DEPLOYED", "CANARY", "SOAK", "CERTIFIED", "PREPROD_LIVE"].includes(phase)) {
    digest64(evidence.deploymentEpochDigest, "Deployment epoch evidence");
    digest64(evidence.registryStateRoot, "Registry state root");
  }
  if (["CANARY", "SOAK", "CERTIFIED", "PREPROD_LIVE"].includes(phase)) {
    digest64(evidence.oracleFundingAnchorDigest, "Oracle/funding anchor evidence");
  }
  if (["SOAK", "CERTIFIED", "PREPROD_LIVE"].includes(phase)) {
    digest64(evidence.crossProductReconciliationDigest, "Cross-product reconciliation evidence");
    digest64(evidence.soakEvidenceDigest, "Soak evidence");
  }
  if (["CERTIFIED", "PREPROD_LIVE"].includes(phase)) {
    digest64(evidence.releaseAttestationDigest, "Release attestation evidence");
  }
  if (phase === "PREPROD_LIVE" && policy.requireStableFinalityForLive) {
    digest64(evidence.finalityEvidenceDigest, "Stable finality evidence");
  }
}

const NEXT_PHASE: Partial<Record<ReleasePhase, ReleasePhase>> = {
  BUILDING: "DEPLOYED",
  DEPLOYED: "CANARY",
  CANARY: "SOAK",
  SOAK: "CERTIFIED",
  CERTIFIED: "PREPROD_LIVE"
};

export function validateReleaseLifecycleTransition(input: {
  previous?: ReleaseLifecycleState;
  next: ReleaseLifecycleState;
  policy: ReleaseTransitionPolicy;
  emergency?: boolean;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const next = input.next;
  if (next.network !== input.policy.expectedNetwork) throw new Error("Release lifecycle network mismatch");
  if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(next.releaseId)) throw new Error("Invalid release lifecycle id");
  if (!Number.isInteger(next.deploymentEpoch) || next.deploymentEpoch < 1) throw new Error("Invalid lifecycle deployment epoch");
  if (!Number.isInteger(next.generation) || next.generation < 1) throw new Error("Invalid lifecycle generation");
  const enteredAt = new Date(next.enteredAt).getTime();
  if (!Number.isFinite(enteredAt) || enteredAt > nowMs + 60_000) throw new Error("Invalid lifecycle entry time");
  requiredEvidence(next.phase, next.evidence, input.policy);

  if (!input.previous) {
    if (next.phase !== "BUILDING") throw new Error("Release lifecycle must start in BUILDING");
    if (next.previousStateDigest) throw new Error("Genesis lifecycle state cannot reference a predecessor");
  } else {
    const previous = input.previous;
    if (previous.releaseId !== next.releaseId) throw new Error("Release lifecycle id changed");
    if (previous.network !== next.network) throw new Error("Release lifecycle changed network");
    if (next.generation !== previous.generation + 1) throw new Error("Release lifecycle generation must increase exactly once");
    if (!next.previousStateDigest) throw new Error("Release lifecycle predecessor digest is required");
    if (next.previousStateDigest.toLowerCase() !== releaseLifecycleDigest(previous)) throw new Error("Release lifecycle predecessor digest mismatch");
    if (enteredAt <= new Date(previous.enteredAt).getTime()) throw new Error("Release lifecycle time must advance");

    if (input.emergency) {
      if (!["PAUSED", "ROLLED_BACK"].includes(next.phase)) throw new Error("Emergency transition must pause or roll back");
    } else {
      const expected = NEXT_PHASE[previous.phase];
      if (!expected || next.phase !== expected) throw new Error(`Invalid release lifecycle transition ${previous.phase} -> ${next.phase}`);
      if (next.deploymentEpoch !== previous.deploymentEpoch) throw new Error("Normal lifecycle promotion cannot change deployment epoch");
    }
  }

  if (next.phase === "PREPROD_LIVE" && next.network !== "preprod") throw new Error("PREPROD_LIVE requires Cardano Preprod");
  const digest = releaseLifecycleDigest(next);
  return { verified: true, digest, phase: next.phase, generation: next.generation };
}

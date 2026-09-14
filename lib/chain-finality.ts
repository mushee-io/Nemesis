import { createHash } from "node:crypto";
import type { CardanoNetwork } from "./cardano-execution";
import type { CardanoConfirmationProof } from "./chain-confirmation-v2";

export type FinalityStatus = "OBSERVED" | "CONFIRMED" | "STABLE" | "ORPHANED";

export type FinalityPolicy = {
  expectedNetwork: CardanoNetwork;
  minimumConfirmations: number;
  stabilityWindowSlots: number;
  maximumObservationAgeMs: number;
};

export type FinalityAssessment = {
  txHash: string;
  blockHash: string;
  slot: number;
  tipSlot: number;
  depthSlots: number;
  status: FinalityStatus;
  observedAt: string;
  digest: string;
};

export type RollbackEvent = {
  rollbackId: string;
  network: CardanoNetwork;
  detectedAt: string;
  fromTipSlot: number;
  toTipSlot: number;
  orphanedBlockHashes: string[];
  orphanedTxHashes: string[];
};

function hash64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a 32-byte hex digest`);
}

function canonicalAssessment(input: Omit<FinalityAssessment, "digest">) {
  return [input.txHash, input.blockHash, input.slot, input.tipSlot, input.depthSlots, input.status, input.observedAt].join("|");
}

export function assessFinality(proof: CardanoConfirmationProof, policy: FinalityPolicy, nowMs = Date.now()): FinalityAssessment {
  if (proof.network !== policy.expectedNetwork) throw new Error("Finality network mismatch");
  hash64(proof.txHash, "Transaction hash");
  hash64(proof.blockHash, "Block hash");
  if (!Number.isInteger(policy.minimumConfirmations) || policy.minimumConfirmations < 1) throw new Error("Invalid finality confirmation threshold");
  if (!Number.isInteger(policy.stabilityWindowSlots) || policy.stabilityWindowSlots < 1) throw new Error("Invalid stability window");
  if (!Number.isInteger(policy.maximumObservationAgeMs) || policy.maximumObservationAgeMs < 1) throw new Error("Invalid finality observation age");
  if (!Number.isInteger(proof.slot) || !Number.isInteger(proof.tipSlot) || proof.slot <= 0 || proof.tipSlot < proof.slot) throw new Error("Invalid finality slots");
  const observedAtMs = new Date(proof.observedAt).getTime();
  if (!Number.isFinite(observedAtMs)) throw new Error("Invalid finality observation time");
  if (observedAtMs > nowMs + 60_000) throw new Error("Finality evidence is future-dated");
  if (nowMs - observedAtMs > policy.maximumObservationAgeMs) throw new Error("Finality evidence is stale");

  const depthSlots = proof.tipSlot - proof.slot;
  let status: FinalityStatus = "OBSERVED";
  if (proof.confirmations >= policy.minimumConfirmations) status = "CONFIRMED";
  if (status === "CONFIRMED" && depthSlots >= policy.stabilityWindowSlots) status = "STABLE";

  const base = {
    txHash: proof.txHash.toLowerCase(),
    blockHash: proof.blockHash.toLowerCase(),
    slot: proof.slot,
    tipSlot: proof.tipSlot,
    depthSlots,
    status,
    observedAt: new Date(observedAtMs).toISOString()
  };
  return { ...base, digest: createHash("sha256").update(canonicalAssessment(base)).digest("hex") };
}

export function validateRollbackEvent(event: RollbackEvent, expectedNetwork: CardanoNetwork, nowMs = Date.now()) {
  if (event.network !== expectedNetwork) throw new Error("Rollback network mismatch");
  if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(event.rollbackId)) throw new Error("Invalid rollback id");
  const detectedAt = new Date(event.detectedAt).getTime();
  if (!Number.isFinite(detectedAt) || detectedAt > nowMs + 60_000) throw new Error("Invalid rollback detection time");
  if (!Number.isInteger(event.fromTipSlot) || !Number.isInteger(event.toTipSlot) || event.fromTipSlot <= event.toTipSlot) {
    throw new Error("Rollback slots must move backwards");
  }
  const blockHashes = event.orphanedBlockHashes.map((hash) => {
    hash64(hash, "Orphaned block hash");
    return hash.toLowerCase();
  });
  const txHashes = event.orphanedTxHashes.map((hash) => {
    hash64(hash, "Orphaned transaction hash");
    return hash.toLowerCase();
  });
  if (new Set(blockHashes).size !== blockHashes.length) throw new Error("Duplicate orphaned block hash");
  if (new Set(txHashes).size !== txHashes.length) throw new Error("Duplicate orphaned transaction hash");
  if (!blockHashes.length && !txHashes.length) throw new Error("Rollback event must identify orphaned chain data");
  return {
    ...event,
    orphanedBlockHashes: blockHashes,
    orphanedTxHashes: txHashes,
    depthSlots: event.fromTipSlot - event.toTipSlot
  };
}

export class FinalityRegistry {
  private readonly assessments = new Map<string, FinalityAssessment>();
  private readonly orphaned = new Set<string>();

  record(assessment: FinalityAssessment) {
    if (this.orphaned.has(assessment.txHash)) throw new Error("Cannot record finality for an orphaned transaction without explicit replacement evidence");
    const previous = this.assessments.get(assessment.txHash);
    if (previous && assessment.tipSlot < previous.tipSlot) throw new Error("Finality tip regression detected");
    if (previous?.status === "STABLE" && assessment.status !== "STABLE") throw new Error("Stable transaction cannot regress without a rollback event");
    this.assessments.set(assessment.txHash, assessment);
    return assessment;
  }

  applyRollback(event: RollbackEvent, expectedNetwork: CardanoNetwork, nowMs = Date.now()) {
    const rollback = validateRollbackEvent(event, expectedNetwork, nowMs);
    for (const txHash of rollback.orphanedTxHashes) {
      this.orphaned.add(txHash);
      this.assessments.delete(txHash);
    }
    return rollback;
  }

  status(txHash: string) {
    const normalized = txHash.toLowerCase();
    if (this.orphaned.has(normalized)) return "ORPHANED" as const;
    return this.assessments.get(normalized)?.status;
  }
}

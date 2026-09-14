import { createHash } from "node:crypto";
import { buildProtocolStateRoot, type ProtocolStateCheckpoint } from "./protocol-state-root";

export type TestnetIndexerObservation = {
  providerId: string;
  tipSlot: number;
  indexedSlot: number;
  stateUtxoRefs: string[];
  observedAt: string;
};

export type TestnetIndexerPolicy = {
  maximumLagSlots: number;
  maximumObservationAgeMs: number;
  minimumIndependentIndexers: number;
};

export function reconcileTestnetIndexer(input: {
  checkpoint: ProtocolStateCheckpoint;
  observations: TestnetIndexerObservation[];
  policy: TestnetIndexerPolicy;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const state = buildProtocolStateRoot(input.checkpoint);
  if (!Number.isInteger(input.policy.maximumLagSlots) || input.policy.maximumLagSlots < 0) throw new Error("Invalid indexer lag policy");
  if (!Number.isInteger(input.policy.minimumIndependentIndexers) || input.policy.minimumIndependentIndexers < 1) throw new Error("Invalid independent indexer requirement");
  if (input.observations.length < input.policy.minimumIndependentIndexers) throw new Error("Insufficient independent indexer observations");
  const expectedRefs = input.checkpoint.leaves.map((leaf) => leaf.utxoRef.toLowerCase()).sort();
  const ids = new Set<string>();
  const normalized = input.observations.map((observation) => {
    if (!/^[a-z0-9:_-]{3,64}$/i.test(observation.providerId) || ids.has(observation.providerId)) throw new Error("Indexer ids must be valid and unique");
    ids.add(observation.providerId);
    if (!Number.isInteger(observation.tipSlot) || !Number.isInteger(observation.indexedSlot) || observation.indexedSlot < 1 || observation.tipSlot < observation.indexedSlot) throw new Error("Invalid indexer slots");
    const lag = observation.tipSlot - observation.indexedSlot;
    if (lag > input.policy.maximumLagSlots) throw new Error("Indexer lag exceeds finalized testnet policy");
    const observedAt = new Date(observation.observedAt).getTime();
    if (!Number.isFinite(observedAt) || observedAt > nowMs + 60_000 || nowMs - observedAt > input.policy.maximumObservationAgeMs) throw new Error("Indexer observation is stale or future-dated");
    const refs = observation.stateUtxoRefs.map((ref) => {
      if (!/^[0-9a-f]{64}#[0-9]+$/i.test(ref)) throw new Error("Indexer returned an invalid state UTxO reference");
      return ref.toLowerCase();
    }).sort();
    if (new Set(refs).size !== refs.length) throw new Error("Indexer double-counted a state UTxO");
    if (refs.length !== expectedRefs.length || refs.some((ref, index) => ref !== expectedRefs[index])) throw new Error("Indexer state UTxO set does not match canonical protocol checkpoint");
    return { ...observation, stateUtxoRefs: refs, lag };
  });
  const root = createHash("sha256").update([state.root, ...normalized.map((o) => `${o.providerId}:${o.indexedSlot}:${o.tipSlot}:${o.lag}`).sort()].join("|")).digest("hex");
  return { root, stateRoot: state.root, indexerCount: normalized.length, maximumObservedLagSlots: Math.max(...normalized.map((o) => o.lag)), reconciled: true };
}

import type { CardanoNetwork } from "./cardano-execution";

export type ChainUtxoRef = {
  txHash: string;
  outputIndex: number;
};

export type ChainReferenceScript = {
  ref: ChainUtxoRef;
  scriptHash: string;
};

export type CardanoConfirmationProof = {
  network: CardanoNetwork;
  txHash: string;
  blockHash: string;
  slot: number;
  blockHeight: number;
  txIndex: number;
  confirmations: number;
  tipSlot: number;
  observedAt: string;
  inputRefs: ChainUtxoRef[];
  outputRefs: ChainUtxoRef[];
  referenceInputRefs: ChainUtxoRef[];
  referenceScripts: ChainReferenceScript[];
};

export type ConfirmationPolicy = {
  expectedNetwork: CardanoNetwork;
  minimumConfirmations: number;
  maximumObservationAgeMs: number;
  maximumTipDistanceSlots: number;
};

function hash64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a 32-byte hex digest`);
}

function hash56(value: string, label: string) {
  if (!/^[0-9a-f]{56}$/i.test(value)) throw new Error(`${label} must be a 28-byte script hash`);
}

export function canonicalUtxoRef(ref: ChainUtxoRef) {
  hash64(ref.txHash, "UTxO transaction hash");
  if (!Number.isInteger(ref.outputIndex) || ref.outputIndex < 0 || ref.outputIndex > 65535) {
    throw new Error("Invalid UTxO output index");
  }
  return `${ref.txHash.toLowerCase()}#${ref.outputIndex}`;
}

function uniqueRefs(refs: ChainUtxoRef[], label: string) {
  const canonical = refs.map(canonicalUtxoRef);
  if (new Set(canonical).size !== canonical.length) throw new Error(`${label} contains duplicate UTxO references`);
  return canonical;
}

export function validateCardanoConfirmation(
  proof: CardanoConfirmationProof,
  policy: ConfirmationPolicy,
  nowMs = Date.now()
) {
  if (proof.network !== policy.expectedNetwork) throw new Error("Cardano confirmation network mismatch");
  hash64(proof.txHash, "Transaction hash");
  hash64(proof.blockHash, "Block hash");
  if (!Number.isInteger(proof.slot) || proof.slot <= 0) throw new Error("Invalid confirmation slot");
  if (!Number.isInteger(proof.blockHeight) || proof.blockHeight <= 0) throw new Error("Invalid block height");
  if (!Number.isInteger(proof.txIndex) || proof.txIndex < 0) throw new Error("Invalid transaction index");
  if (!Number.isInteger(proof.confirmations) || proof.confirmations < policy.minimumConfirmations) {
    throw new Error("Insufficient Cardano confirmations");
  }
  if (!Number.isInteger(proof.tipSlot) || proof.tipSlot < proof.slot) throw new Error("Invalid observed chain tip slot");
  if (!Number.isInteger(policy.maximumTipDistanceSlots) || policy.maximumTipDistanceSlots < 0) {
    throw new Error("Invalid confirmation tip-distance policy");
  }
  if (proof.tipSlot - proof.slot > policy.maximumTipDistanceSlots) {
    throw new Error("Confirmation proof is too far behind the observed chain tip");
  }

  const observedAt = new Date(proof.observedAt).getTime();
  if (!Number.isFinite(observedAt)) throw new Error("Invalid confirmation observation timestamp");
  if (observedAt > nowMs + 60_000) throw new Error("Confirmation proof is future-dated");
  if (!Number.isInteger(policy.maximumObservationAgeMs) || policy.maximumObservationAgeMs <= 0) {
    throw new Error("Invalid confirmation maximum age policy");
  }
  if (nowMs - observedAt > policy.maximumObservationAgeMs) throw new Error("Confirmation proof is stale");

  const inputRefs = uniqueRefs(proof.inputRefs, "Confirmation inputs");
  const outputRefs = uniqueRefs(proof.outputRefs, "Confirmation outputs");
  const referenceInputRefs = uniqueRefs(proof.referenceInputRefs, "Confirmation reference inputs");
  if (!outputRefs.some((ref) => ref.startsWith(`${proof.txHash.toLowerCase()}#`))) {
    throw new Error("Confirmation outputs must include an output created by the confirmed transaction");
  }
  const inputSet = new Set(inputRefs);
  if (referenceInputRefs.some((ref) => inputSet.has(ref))) {
    throw new Error("A UTxO cannot be both consumed and read as a reference input in the same proof");
  }

  const referenceScripts = proof.referenceScripts.map((entry) => {
    const ref = canonicalUtxoRef(entry.ref);
    hash56(entry.scriptHash, "Reference script hash");
    if (!outputRefs.includes(ref)) throw new Error("Reference script metadata must point to an output created by the confirmed transaction");
    return { ref, scriptHash: entry.scriptHash.toLowerCase() };
  });
  if (new Set(referenceScripts.map((entry) => entry.ref)).size !== referenceScripts.length) {
    throw new Error("Confirmation contains duplicate reference-script metadata");
  }

  return {
    verified: true,
    txHash: proof.txHash.toLowerCase(),
    blockHash: proof.blockHash.toLowerCase(),
    slot: proof.slot,
    blockHeight: proof.blockHeight,
    txIndex: proof.txIndex,
    confirmations: proof.confirmations,
    inputRefs,
    outputRefs,
    referenceInputRefs,
    referenceScripts,
    observedAt: new Date(observedAt).toISOString()
  };
}

export function assertReferenceScriptUsed(input: {
  confirmation: CardanoConfirmationProof;
  expectedReference: ChainUtxoRef;
}) {
  const expected = canonicalUtxoRef(input.expectedReference);
  const references = new Set(input.confirmation.referenceInputRefs.map(canonicalUtxoRef));
  if (!references.has(expected)) throw new Error("Confirmed transaction did not read the expected reference script UTxO");
  return true;
}

export function assertReferenceScriptDeployed(input: {
  confirmation: CardanoConfirmationProof;
  expectedReference: ChainUtxoRef;
  expectedScriptHash: string;
}) {
  const expected = canonicalUtxoRef(input.expectedReference);
  hash56(input.expectedScriptHash, "Expected reference script hash");
  const match = input.confirmation.referenceScripts.find((entry) => canonicalUtxoRef(entry.ref) === expected);
  if (!match) throw new Error("Confirmed deployment output is missing reference-script metadata");
  if (match.scriptHash.toLowerCase() !== input.expectedScriptHash.toLowerCase()) {
    throw new Error("Confirmed reference-script hash does not match the applied validator hash");
  }
  return true;
}

import { createHash } from "node:crypto";
import { assertReferenceScriptDeployed, validateCardanoConfirmation, type CardanoConfirmationProof } from "./chain-confirmation-v2";
import type { TestnetDeploymentManifest } from "./testnet-deployment-manifest";

export type TestnetFinalityPolicy = {
  minimumConfirmations: number;
  stabilityWindowSlots: number;
  maximumObservationAgeMs: number;
};

export type TestnetFinalityBundle = {
  deploymentConfirmations: CardanoConfirmationProof[];
  lifecycleConfirmations: CardanoConfirmationProof[];
  currentTipSlot: number;
};

function refFromString(value: string) {
  const [txHash, index] = value.split("#");
  return { txHash, outputIndex: Number(index) };
}

export function validateTestnetFinality(input: {
  manifest: TestnetDeploymentManifest;
  bundle: TestnetFinalityBundle;
  policy: TestnetFinalityPolicy;
  requiredLifecycleTxHashes: string[];
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isInteger(input.policy.minimumConfirmations) || input.policy.minimumConfirmations < 1) throw new Error("Finality confirmation threshold must be positive");
  if (!Number.isInteger(input.policy.stabilityWindowSlots) || input.policy.stabilityWindowSlots < 1) throw new Error("Finality stability window must be positive");
  if (!Number.isInteger(input.bundle.currentTipSlot) || input.bundle.currentTipSlot < 1) throw new Error("Current Preprod tip slot is invalid");
  const confirmationPolicy = {
    expectedNetwork: "preprod" as const,
    minimumConfirmations: input.policy.minimumConfirmations,
    maximumObservationAgeMs: input.policy.maximumObservationAgeMs,
    maximumTipDistanceSlots: Number.MAX_SAFE_INTEGER
  };
  const deploymentByTx = new Map<string, CardanoConfirmationProof>();
  for (const proof of input.bundle.deploymentConfirmations) {
    const verified = validateCardanoConfirmation(proof, confirmationPolicy, nowMs);
    if (input.bundle.currentTipSlot - verified.slot < input.policy.stabilityWindowSlots) throw new Error("Reference-script deployment has not reached the required stability window");
    deploymentByTx.set(verified.txHash, proof);
  }
  for (const validator of input.manifest.validators) {
    const proof = deploymentByTx.get(validator.deploymentTxHash.toLowerCase());
    if (!proof) throw new Error(`Missing deployment confirmation for ${validator.name}`);
    assertReferenceScriptDeployed({ confirmation: proof, expectedReference: refFromString(validator.referenceScriptUtxo), expectedScriptHash: validator.appliedScriptHash });
  }
  const lifecycleTxs = new Set<string>();
  const lifecycleDigests: string[] = [];
  for (const proof of input.bundle.lifecycleConfirmations) {
    const verified = validateCardanoConfirmation(proof, confirmationPolicy, nowMs);
    if (input.bundle.currentTipSlot - verified.slot < input.policy.stabilityWindowSlots) throw new Error("Lifecycle transaction has not reached the required stability window");
    if (lifecycleTxs.has(verified.txHash)) throw new Error("Duplicate lifecycle confirmation");
    lifecycleTxs.add(verified.txHash);
    lifecycleDigests.push(createHash("sha256").update([verified.txHash,verified.blockHash,verified.slot,verified.confirmations].join("|")).digest("hex"));
  }
  for (const hash of input.requiredLifecycleTxHashes) if (!lifecycleTxs.has(hash.toLowerCase())) throw new Error(`Missing stable lifecycle confirmation for ${hash}`);
  const root = createHash("sha256").update([
    input.bundle.currentTipSlot,
    ...input.manifest.validators.map((v) => `${v.name}:${v.referenceScriptUtxo}:${v.appliedScriptHash}`).sort(),
    ...lifecycleDigests.sort()
  ].join("|")).digest("hex");
  return { root, currentTipSlot: input.bundle.currentTipSlot, deploymentCount: input.manifest.validators.length, lifecycleCount: lifecycleTxs.size, stable: true };
}

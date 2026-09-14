import { createHash } from "node:crypto";
import { validateRegistryTestnetV11, type RegistryTestnetV11State } from "./registry-testnet-v11";
import { buildFinalizedTestnetEvidence, type FinalizedTestnetEvidenceBundle } from "./testnet-final-evidence";

export type V11TestnetFinalizationBundle = {
  previousV10Digest: string;
  registry: RegistryTestnetV11State;
  evidence: FinalizedTestnetEvidenceBundle;
  reviewerApprovals: string[];
  issuedAt: string;
  expiresAt: string;
};

function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be 64 hex`); return v.toLowerCase(); }

export function finalizeCardanoPreprodTestnet(input: {
  bundle: V11TestnetFinalizationBundle;
  minimumReviewers: number;
  minimumLifecycleConfirmations: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const previousV10Digest = d64(input.bundle.previousV10Digest, "Previous V10 review");
  const registry = validateRegistryTestnetV11(input.bundle.registry);
  if (registry.paused) throw new Error("Cardano Preprod cannot be finalized while Registry is paused");
  const evidence = buildFinalizedTestnetEvidence(input.bundle.evidence, input.minimumLifecycleConfirmations, nowMs);
  if (registry.testnetRoot !== evidence.root) throw new Error("Registry testnet root does not match finalized Preprod evidence");
  if (registry.stateRoot !== evidence.stateRoot) throw new Error("Registry state root does not match finalized Preprod checkpoint");
  if (!Number.isInteger(input.minimumReviewers) || input.minimumReviewers < 3) throw new Error("V11 testnet finalization requires at least three independent reviewers");
  if (new Set(input.bundle.reviewerApprovals).size !== input.bundle.reviewerApprovals.length || input.bundle.reviewerApprovals.length < input.minimumReviewers) throw new Error("Insufficient independent V11 reviewers");
  const issuedAt = new Date(input.bundle.issuedAt).getTime(), expiresAt = new Date(input.bundle.expiresAt).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || issuedAt > nowMs + 60_000 || nowMs > expiresAt) throw new Error("V11 finalization validity window is invalid");
  const digest = createHash("sha256").update([
    "SYMBIOTIC_V11_CARDANO_PREPROD_FINALIZED",
    previousV10Digest,
    registry.digest,
    evidence.root,
    evidence.stateRoot,
    evidence.finalityRoot,
    evidence.failureRoot,
    ...input.bundle.reviewerApprovals.slice().sort(),
    new Date(issuedAt).toISOString(),
    new Date(expiresAt).toISOString()
  ].join("|")).digest("hex");
  return {
    version: "V11" as const,
    network: "preprod" as const,
    networkMagic: 1 as const,
    testnetFinalized: true,
    mainnetActivationAllowed: false as const,
    digest,
    registryDigest: registry.digest,
    testnetRoot: evidence.root,
    stateRoot: evidence.stateRoot,
    lifecycleTransactionCount: evidence.lifecycleTransactionCount,
    stable: evidence.stable,
    reconciled: evidence.reconciled
  };
}

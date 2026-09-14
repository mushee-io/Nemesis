import { createHash } from "node:crypto";
import { buildProtocolStateRoot, type ProductStateLeaf, type ProtocolStateCheckpoint } from "./protocol-state-root";

export type RecoveryStorageCopy = {
  provider: string;
  region: string;
  snapshotSha256: string;
  verifiedAt: string;
};

export type ProtocolRecoveryBundle = {
  recoveryId: string;
  sourceCheckpoint: ProtocolStateCheckpoint;
  sourceFinalityDigest: string;
  recoveredLeaves: ProductStateLeaf[];
  storageCopies: RecoveryStorageCopy[];
  createdAt: string;
};

export type RecoveryPolicy = {
  minimumIndependentCopies: number;
  maximumSnapshotAgeMs: number;
};

function d64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function leafIdentity(leaf: ProductStateLeaf) {
  return `${leaf.product}:${leaf.stateId}:${leaf.utxoRef.toLowerCase()}:${leaf.ownerOrMarket}:${leaf.nonce}:${leaf.valueDigest.toLowerCase()}`;
}

export function verifyProtocolRecovery(bundle: ProtocolRecoveryBundle, policy: RecoveryPolicy, nowMs = Date.now()) {
  if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(bundle.recoveryId)) throw new Error("Invalid recovery id");
  if (!Number.isInteger(policy.minimumIndependentCopies) || policy.minimumIndependentCopies < 2) throw new Error("Recovery requires at least two independent copies");
  if (!Number.isInteger(policy.maximumSnapshotAgeMs) || policy.maximumSnapshotAgeMs < 1) throw new Error("Invalid recovery snapshot age policy");
  const createdAt = new Date(bundle.createdAt).getTime();
  if (!Number.isFinite(createdAt) || createdAt > nowMs + 60_000) throw new Error("Invalid recovery timestamp");
  if (nowMs - createdAt > policy.maximumSnapshotAgeMs) throw new Error("Recovery snapshot is stale");
  const finalityDigest = d64(bundle.sourceFinalityDigest, "Recovery finality evidence");

  const source = buildProtocolStateRoot(bundle.sourceCheckpoint);
  if (bundle.recoveredLeaves.length !== bundle.sourceCheckpoint.leaves.length) throw new Error("Recovery leaf count mismatch");

  const sourceLeaves = bundle.sourceCheckpoint.leaves.map(leafIdentity).sort();
  const recoveredLeaves = bundle.recoveredLeaves.map(leafIdentity).sort();
  for (let i = 0; i < sourceLeaves.length; i += 1) {
    if (sourceLeaves[i] !== recoveredLeaves[i]) throw new Error("Recovered state does not exactly reproduce source UTxOs");
  }

  const reconstructed = buildProtocolStateRoot({ ...bundle.sourceCheckpoint, leaves: bundle.recoveredLeaves });
  if (reconstructed.root !== source.root) throw new Error("Recovered protocol state root mismatch");

  if (bundle.storageCopies.length < policy.minimumIndependentCopies) throw new Error("Insufficient recovery storage copies");
  const providers = new Set<string>();
  const providerRegions = new Set<string>();
  let expectedSnapshotSha: string | undefined;
  for (const copy of bundle.storageCopies) {
    if (!copy.provider.trim() || !copy.region.trim()) throw new Error("Recovery storage provider and region are required");
    const verifiedAt = new Date(copy.verifiedAt).getTime();
    if (!Number.isFinite(verifiedAt) || verifiedAt > nowMs + 60_000 || verifiedAt < createdAt) throw new Error("Invalid recovery copy verification time");
    const snapshotSha = d64(copy.snapshotSha256, "Recovery snapshot copy");
    if (expectedSnapshotSha && snapshotSha !== expectedSnapshotSha) throw new Error("Recovery copies disagree on snapshot digest");
    expectedSnapshotSha = snapshotSha;
    providers.add(copy.provider.toLowerCase());
    providerRegions.add(`${copy.provider.toLowerCase()}:${copy.region.toLowerCase()}`);
  }
  if (providers.size < policy.minimumIndependentCopies) throw new Error("Recovery copies are not provider-independent");
  if (providerRegions.size !== bundle.storageCopies.length) throw new Error("Duplicate recovery provider/region copy");

  const root = createHash("sha256").update([
    bundle.recoveryId,
    source.root,
    finalityDigest,
    expectedSnapshotSha,
    ...bundle.storageCopies.map((copy) => `${copy.provider.toLowerCase()}:${copy.region.toLowerCase()}:${copy.snapshotSha256.toLowerCase()}`).sort(),
    new Date(createdAt).toISOString()
  ].join("|")).digest("hex");

  return {
    verified: true,
    root,
    stateRoot: source.root,
    recoveredLeafCount: reconstructed.leafCount,
    independentCopyCount: providers.size
  };
}

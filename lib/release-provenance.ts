import type { CardanoNetwork } from "./cardano-execution";

export type ReleaseProvenance = {
  network: CardanoNetwork;
  commitSha: string;
  buildSha256: string;
  blueprintSha256: string;
  validatorManifestSha256: string;
  configSha256: string;
  generatedAt: string;
};

export type ProvenancePolicy = {
  expectedNetwork: CardanoNetwork;
  expectedCommitSha?: string;
  expectedBlueprintSha256?: string;
  maxAgeMs?: number;
};

function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a 32-byte hex digest`);
}

function commit40(value: string) {
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error("Commit SHA must be a 40-character hex digest");
}

export function validateReleaseProvenance(
  provenance: ReleaseProvenance,
  policy: ProvenancePolicy,
  nowMs = Date.now()
) {
  if (provenance.network !== policy.expectedNetwork) throw new Error("Release provenance network mismatch");
  commit40(provenance.commitSha);
  digest64(provenance.buildSha256, "Build SHA-256");
  digest64(provenance.blueprintSha256, "Blueprint SHA-256");
  digest64(provenance.validatorManifestSha256, "Validator manifest SHA-256");
  digest64(provenance.configSha256, "Config SHA-256");

  if (policy.expectedCommitSha && provenance.commitSha.toLowerCase() !== policy.expectedCommitSha.toLowerCase()) {
    throw new Error("Release provenance commit mismatch");
  }
  if (
    policy.expectedBlueprintSha256 &&
    provenance.blueprintSha256.toLowerCase() !== policy.expectedBlueprintSha256.toLowerCase()
  ) {
    throw new Error("Release provenance blueprint mismatch");
  }

  const generatedAt = new Date(provenance.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) throw new Error("Invalid release provenance timestamp");
  if (generatedAt > nowMs + 60_000) throw new Error("Release provenance timestamp is in the future");
  const maxAgeMs = policy.maxAgeMs ?? 24 * 60 * 60 * 1000;
  if (maxAgeMs <= 0) throw new Error("Invalid provenance maximum age");
  if (nowMs - generatedAt > maxAgeMs) throw new Error("Release provenance is stale");

  const artifacts = [
    provenance.buildSha256,
    provenance.blueprintSha256,
    provenance.validatorManifestSha256,
    provenance.configSha256
  ].map((value) => value.toLowerCase());
  if (new Set(artifacts).size !== artifacts.length) throw new Error("Release provenance digests must identify distinct artifacts");

  return {
    verified: true,
    network: provenance.network,
    commitSha: provenance.commitSha.toLowerCase(),
    generatedAt: new Date(generatedAt).toISOString()
  };
}

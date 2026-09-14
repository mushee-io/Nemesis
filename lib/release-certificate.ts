import { createHash } from "node:crypto";
import type { CardanoNetwork } from "./cardano-execution";

export type ReleaseCertificate = {
  network: CardanoNetwork;
  protocolVersion: string;
  commitSha: string;
  webBuildSha256: string;
  blueprintSha256: string;
  validatorManifestSha256: string;
  sbomSha256: string;
  lockfileSha256: string;
  solvencyEvidenceSha256: string;
  fundingEvidenceSha256: string;
  optionsEvidenceSha256: string;
  notionalEvidenceSha256: string;
  chaosEvidenceSha256: string;
  rollbackEvidenceSha256: string;
  issuedAt: string;
  expiresAt: string;
  governorApprovals: string[];
};

export type ReleaseCertificatePolicy = {
  expectedNetwork: CardanoNetwork;
  minimumGovernorApprovals: number;
  maximumLifetimeMs: number;
};

function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function commit40(value: string) {
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error("Release certificate commit must be a git SHA");
}

function canonicalCertificate(certificate: ReleaseCertificate) {
  return [
    certificate.network,
    certificate.protocolVersion,
    certificate.commitSha.toLowerCase(),
    certificate.webBuildSha256.toLowerCase(),
    certificate.blueprintSha256.toLowerCase(),
    certificate.validatorManifestSha256.toLowerCase(),
    certificate.sbomSha256.toLowerCase(),
    certificate.lockfileSha256.toLowerCase(),
    certificate.solvencyEvidenceSha256.toLowerCase(),
    certificate.fundingEvidenceSha256.toLowerCase(),
    certificate.optionsEvidenceSha256.toLowerCase(),
    certificate.notionalEvidenceSha256.toLowerCase(),
    certificate.chaosEvidenceSha256.toLowerCase(),
    certificate.rollbackEvidenceSha256.toLowerCase(),
    certificate.issuedAt,
    certificate.expiresAt,
    ...certificate.governorApprovals.map((value) => value.trim().toLowerCase()).sort()
  ].join("|");
}

export function validateReleaseCertificate(
  certificate: ReleaseCertificate,
  policy: ReleaseCertificatePolicy,
  nowMs = Date.now()
) {
  if (certificate.network !== policy.expectedNetwork) throw new Error("Release certificate network mismatch");
  if (!/^0\.\d+\.\d+$/.test(certificate.protocolVersion)) throw new Error("Invalid protocol version in release certificate");
  commit40(certificate.commitSha);
  const digests = [
    [certificate.webBuildSha256, "web build"],
    [certificate.blueprintSha256, "blueprint"],
    [certificate.validatorManifestSha256, "validator manifest"],
    [certificate.sbomSha256, "SBOM"],
    [certificate.lockfileSha256, "lockfile"],
    [certificate.solvencyEvidenceSha256, "solvency evidence"],
    [certificate.fundingEvidenceSha256, "funding evidence"],
    [certificate.optionsEvidenceSha256, "options evidence"],
    [certificate.notionalEvidenceSha256, "Notional evidence"],
    [certificate.chaosEvidenceSha256, "chaos evidence"],
    [certificate.rollbackEvidenceSha256, "rollback evidence"]
  ] as const;
  for (const [digest, label] of digests) digest64(digest, label);

  const issuedAt = new Date(certificate.issuedAt).getTime();
  const expiresAt = new Date(certificate.expiresAt).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error("Invalid release certificate validity window");
  if (issuedAt > nowMs + 60_000) throw new Error("Release certificate is future-dated");
  if (nowMs >= expiresAt) throw new Error("Release certificate has expired");
  if (!Number.isInteger(policy.maximumLifetimeMs) || policy.maximumLifetimeMs <= 0 || expiresAt - issuedAt > policy.maximumLifetimeMs) {
    throw new Error("Release certificate lifetime exceeds policy");
  }
  if (!Number.isInteger(policy.minimumGovernorApprovals) || policy.minimumGovernorApprovals < 1) throw new Error("Invalid release certificate governor threshold");
  const approvals = certificate.governorApprovals.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (new Set(approvals).size !== approvals.length) throw new Error("Duplicate release certificate governor approval");
  if (approvals.length < policy.minimumGovernorApprovals) throw new Error("Release certificate governor quorum not reached");

  const artifactDigests = digests.map(([digest]) => digest.toLowerCase());
  if (new Set(artifactDigests).size !== artifactDigests.length) throw new Error("Release certificate evidence digests must be distinct");

  return {
    verified: true,
    digest: createHash("sha256").update(canonicalCertificate(certificate)).digest("hex"),
    network: certificate.network,
    protocolVersion: certificate.protocolVersion,
    commitSha: certificate.commitSha.toLowerCase(),
    expiresAt: new Date(expiresAt).toISOString()
  };
}

import { createHash } from "node:crypto";
import type { CardanoNetwork } from "./cardano-execution";
import type { ConfirmationPolicy } from "./chain-confirmation-v2";
import {
  bindParameterizedDeployment,
  type ParameterizedValidatorInstance
} from "./parameterized-deployment";
import {
  validateReferenceScriptDeploymentBundle,
  type ReferenceScriptDeploymentReceipt
} from "./reference-script-deployment";
import {
  validateLiveEconomicEvidenceBundle,
  type LiveEconomicEvidenceBundle
} from "./live-economic-evidence";
import {
  validateReleaseCertificate,
  type ReleaseCertificate,
  type ReleaseCertificatePolicy
} from "./release-certificate";
import type { ValidatorArtifactManifest } from "./onchain-evidence";

export type PreprodReleaseAttestation = {
  network: "preprod";
  protocolVersion: string;
  deploymentEpoch: string;
  parameterSchemaSha256: string;
  parameterizedDeploymentSha256: string;
  referenceScriptBundleSha256: string;
  confirmationBundleSha256: string;
  liveEconomicEvidenceSha256: string;
  baseReleaseCertificateSha256: string;
  lifecycleTxHashes: string[];
  issuedAt: string;
  expiresAt: string;
  governorApprovals: string[];
};

export type LivePreprodReleaseBundle = {
  network: "preprod";
  parameterSchemaSha256: string;
  artifactManifest: ValidatorArtifactManifest;
  parameterizedValidators: ParameterizedValidatorInstance[];
  referenceScriptReceipts: ReferenceScriptDeploymentReceipt[];
  economicEvidence: LiveEconomicEvidenceBundle;
  baseReleaseCertificate: ReleaseCertificate;
  attestation: PreprodReleaseAttestation;
};

function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function txHash(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("Invalid release lifecycle transaction hash");
  return value.toLowerCase();
}

function canonicalConfirmationBundle(input: {
  referenceScriptReceipts: ReferenceScriptDeploymentReceipt[];
  economicEvidence: LiveEconomicEvidenceBundle;
}) {
  const confirmations = [
    ...input.referenceScriptReceipts.map((receipt) => receipt.confirmation),
    input.economicEvidence.funding.confirmation,
    input.economicEvidence.optionSettlement.confirmation,
    input.economicEvidence.notionalSettlement.confirmation
  ];
  return confirmations
    .map((proof) => [
      proof.txHash.toLowerCase(),
      proof.blockHash.toLowerCase(),
      proof.slot,
      proof.blockHeight,
      proof.txIndex,
      proof.confirmations,
      [...proof.referenceInputRefs]
        .map((ref) => `${ref.txHash.toLowerCase()}#${ref.outputIndex}`)
        .sort()
        .join(",")
    ].join(":"))
    .sort()
    .join("|");
}

export function computeConfirmationBundleDigest(input: {
  referenceScriptReceipts: ReferenceScriptDeploymentReceipt[];
  economicEvidence: LiveEconomicEvidenceBundle;
}) {
  return createHash("sha256").update(canonicalConfirmationBundle(input)).digest("hex");
}

export function validatePreprodReleaseAttestation(input: {
  attestation: PreprodReleaseAttestation;
  expected: {
    parameterSchemaSha256: string;
    parameterizedDeploymentSha256: string;
    referenceScriptBundleSha256: string;
    confirmationBundleSha256: string;
    liveEconomicEvidenceSha256: string;
    baseReleaseCertificateSha256: string;
    requiredTxHashes: string[];
  };
  minimumGovernorApprovals: number;
  maximumLifetimeMs: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const attestation = input.attestation;
  if (attestation.network !== "preprod") throw new Error("Milestone 55 attestation must target Cardano Preprod");
  if (!/^0\.\d+\.\d+$/.test(attestation.protocolVersion)) throw new Error("Invalid attestation protocol version");
  if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(attestation.deploymentEpoch)) throw new Error("Invalid deployment epoch");

  const digestFields = [
    [attestation.parameterSchemaSha256, input.expected.parameterSchemaSha256, "parameter schema"],
    [attestation.parameterizedDeploymentSha256, input.expected.parameterizedDeploymentSha256, "parameterized deployment"],
    [attestation.referenceScriptBundleSha256, input.expected.referenceScriptBundleSha256, "reference-script bundle"],
    [attestation.confirmationBundleSha256, input.expected.confirmationBundleSha256, "confirmation bundle"],
    [attestation.liveEconomicEvidenceSha256, input.expected.liveEconomicEvidenceSha256, "live economic evidence"],
    [attestation.baseReleaseCertificateSha256, input.expected.baseReleaseCertificateSha256, "base release certificate"]
  ] as const;
  for (const [actual, expected, label] of digestFields) {
    digest64(actual, `${label} digest`);
    digest64(expected, `expected ${label} digest`);
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Attestation ${label} digest mismatch`);
  }
  const uniqueEvidenceDigests = digestFields.map(([actual]) => actual.toLowerCase());
  if (new Set(uniqueEvidenceDigests).size !== uniqueEvidenceDigests.length) {
    throw new Error("Preprod attestation evidence digests must be distinct");
  }

  const txHashes = attestation.lifecycleTxHashes.map(txHash);
  if (new Set(txHashes).size !== txHashes.length) throw new Error("Preprod attestation contains duplicate lifecycle transaction hashes");
  const required = new Set(input.expected.requiredTxHashes.map(txHash));
  const actual = new Set(txHashes);
  for (const requiredHash of required) {
    if (!actual.has(requiredHash)) throw new Error("Preprod attestation is missing a required confirmed transaction");
  }

  const issuedAt = new Date(attestation.issuedAt).getTime();
  const expiresAt = new Date(attestation.expiresAt).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error("Invalid Preprod attestation validity window");
  if (issuedAt > nowMs + 60_000) throw new Error("Preprod attestation is future-dated");
  if (nowMs >= expiresAt) throw new Error("Preprod attestation has expired");
  if (!Number.isInteger(input.maximumLifetimeMs) || input.maximumLifetimeMs <= 0 || expiresAt - issuedAt > input.maximumLifetimeMs) {
    throw new Error("Preprod attestation lifetime exceeds policy");
  }
  if (!Number.isInteger(input.minimumGovernorApprovals) || input.minimumGovernorApprovals < 1) throw new Error("Invalid Preprod attestation governor threshold");
  const approvals = attestation.governorApprovals.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (new Set(approvals).size !== approvals.length) throw new Error("Duplicate Preprod attestation governor approval");
  if (approvals.length < input.minimumGovernorApprovals) throw new Error("Preprod attestation governor quorum not reached");

  const digest = createHash("sha256").update([
    attestation.network,
    attestation.protocolVersion,
    attestation.deploymentEpoch,
    ...uniqueEvidenceDigests,
    ...[...txHashes].sort(),
    attestation.issuedAt,
    attestation.expiresAt,
    ...approvals.sort()
  ].join("|")).digest("hex");

  return {
    verified: true,
    digest,
    deploymentEpoch: attestation.deploymentEpoch,
    lifecycleTransactionCount: txHashes.length,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

export function evaluateLivePreprodReleaseBundle(input: {
  bundle: LivePreprodReleaseBundle;
  confirmationPolicy: Omit<ConfirmationPolicy, "expectedNetwork">;
  releaseCertificatePolicy: ReleaseCertificatePolicy;
  minimumGovernorApprovals: number;
  maximumAttestationLifetimeMs: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const bundle = input.bundle;
  if (bundle.network !== "preprod") throw new Error("Live release bundle must target Cardano Preprod");
  digest64(bundle.parameterSchemaSha256, "Parameter schema SHA-256");

  const deployment = bindParameterizedDeployment({
    manifest: bundle.artifactManifest,
    instances: bundle.parameterizedValidators,
    network: "preprod"
  });

  const referenceScripts = validateReferenceScriptDeploymentBundle({
    receipts: bundle.referenceScriptReceipts,
    expected: deployment.instances.map((instance) => ({
      title: instance.title,
      parameterDigest: instance.parameterDigest,
      appliedScriptHash: instance.appliedScriptHash
    })),
    network: "preprod",
    policy: input.confirmationPolicy,
    nowMs
  });

  for (const instance of deployment.instances) {
    const receipt = referenceScripts.receipts.find((candidate) => candidate.title === instance.title);
    if (!receipt || receipt.referenceScriptRef !== instance.referenceScriptRef) {
      throw new Error(`${instance.title} parameterized deployment is not bound to its confirmed reference-script UTxO`);
    }
  }

  const economic = validateLiveEconomicEvidenceBundle({
    bundle: bundle.economicEvidence,
    policy: input.confirmationPolicy,
    nowMs
  });
  if (economic.network !== "preprod") throw new Error("Live economic evidence must target Preprod");

  const baseCertificate = validateReleaseCertificate(
    bundle.baseReleaseCertificate,
    input.releaseCertificatePolicy,
    nowMs
  );
  if (baseCertificate.network !== "preprod") throw new Error("Base release certificate must target Preprod");

  const confirmationBundleSha256 = computeConfirmationBundleDigest({
    referenceScriptReceipts: bundle.referenceScriptReceipts,
    economicEvidence: bundle.economicEvidence
  });
  const requiredTxHashes = [
    ...referenceScripts.deploymentTransactions,
    ...economic.transactions
  ];

  const attestation = validatePreprodReleaseAttestation({
    attestation: bundle.attestation,
    expected: {
      parameterSchemaSha256: bundle.parameterSchemaSha256,
      parameterizedDeploymentSha256: deployment.deploymentDigest,
      referenceScriptBundleSha256: referenceScripts.digest,
      confirmationBundleSha256,
      liveEconomicEvidenceSha256: economic.digest,
      baseReleaseCertificateSha256: baseCertificate.digest,
      requiredTxHashes
    },
    minimumGovernorApprovals: input.minimumGovernorApprovals,
    maximumLifetimeMs: input.maximumAttestationLifetimeMs,
    nowMs
  });

  return {
    ready: true,
    network: "preprod" as CardanoNetwork,
    deploymentDigest: deployment.deploymentDigest,
    referenceScriptBundleDigest: referenceScripts.digest,
    confirmationBundleDigest: confirmationBundleSha256,
    liveEconomicEvidenceDigest: economic.digest,
    releaseCertificateDigest: baseCertificate.digest,
    attestationDigest: attestation.digest,
    lifecycleTransactionCount: attestation.lifecycleTransactionCount
  };
}

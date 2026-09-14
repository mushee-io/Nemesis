import assert from "node:assert/strict";
import test from "node:test";
import {
  bindParameterizedDeployment,
  computeParameterDigest,
  type AppliedValidatorParameter,
  type ParameterizedValidatorInstance,
  type SymbioticValidatorTitle
} from "../lib/parameterized-deployment";
import {
  validateReferenceScriptDeploymentBundle,
  type ReferenceScriptDeploymentReceipt
} from "../lib/reference-script-deployment";
import {
  validateCardanoConfirmation,
  type CardanoConfirmationProof
} from "../lib/chain-confirmation-v2";
import {
  validateLiveEconomicEvidenceBundle,
  type LiveEconomicEvidenceBundle
} from "../lib/live-economic-evidence";
import {
  computeConfirmationBundleDigest,
  evaluateLivePreprodReleaseBundle,
  validatePreprodReleaseAttestation,
  type PreprodReleaseAttestation
} from "../lib/preprod-release-attestation";
import { validateReleaseCertificate } from "../lib/release-certificate";
import type { ValidatorArtifactManifest } from "../lib/onchain-evidence";

const NOW = new Date("2026-09-14T12:00:00.000Z").getTime();
const D64A = "a".repeat(64);
const D64B = "b".repeat(64);
const D64C = "c".repeat(64);
const D64D = "d".repeat(64);
const D64E = "e".repeat(64);
const D64F = "f".repeat(64);
const H56A = "1".repeat(56);
const H56B = "2".repeat(56);
const H56C = "3".repeat(56);
const H56D = "4".repeat(56);

const titles: SymbioticValidatorTitle[] = [
  "collateral.collateral.spend",
  "perpetual.perpetual.spend",
  "options.options.spend",
  "notional.notional.spend"
];

const parameterMap: Record<SymbioticValidatorTitle, AppliedValidatorParameter[]> = {
  "collateral.collateral.spend": [
    { name: "collateral_policy", cborHex: "00" },
    { name: "collateral_asset", cborHex: "01" }
  ],
  "perpetual.perpetual.spend": [
    { name: "oracle_authority", cborHex: "02" },
    { name: "keeper_authority", cborHex: "03" },
    { name: "maintenance_bps", cborHex: "04" },
    { name: "collateral_policy", cborHex: "05" },
    { name: "collateral_asset", cborHex: "06" }
  ],
  "options.options.spend": [
    { name: "settlement_authority", cborHex: "07" },
    { name: "collateral_policy", cborHex: "08" },
    { name: "collateral_asset", cborHex: "09" }
  ],
  "notional.notional.spend": [
    { name: "solver_authority", cborHex: "0a" }
  ]
};

function artifactManifest(): ValidatorArtifactManifest {
  return {
    schemaVersion: 1,
    project: "mushee-io/symbiotic",
    plutusVersion: "v3",
    blueprintSha256: D64A,
    validators: titles.map((title, index) => ({
      title,
      hash: null,
      compiledCodeSha256: [D64B, D64C, D64D, D64E][index],
      compiledBytes: 200 + index * 50,
      parameterized: true
    }))
  };
}

function txHash(index: number) {
  return index.toString(16).padStart(64, "0");
}

function confirmation(
  index: number,
  referenceInputRefs: Array<{ txHash: string; outputIndex: number }> = [],
  deployedScriptHash?: string
): CardanoConfirmationProof {
  const hash = txHash(index);
  const output = { txHash: hash, outputIndex: 0 };
  return {
    network: "preprod",
    txHash: hash,
    blockHash: (index + 100).toString(16).padStart(64, "0"),
    slot: 10_000 + index,
    blockHeight: 5_000 + index,
    txIndex: index % 10,
    confirmations: 6,
    tipSlot: 10_010 + index,
    observedAt: new Date(NOW - 30_000).toISOString(),
    inputRefs: [{ txHash: txHash(index + 200), outputIndex: 0 }],
    outputRefs: [output],
    referenceInputRefs,
    referenceScripts: deployedScriptHash ? [{ ref: output, scriptHash: deployedScriptHash }] : []
  };
}

function parameterizedInstances(): ParameterizedValidatorInstance[] {
  const manifest = artifactManifest();
  const appliedHashes = [H56A, H56B, H56C, H56D];
  const addresses = ["q", "w", "e", "r"].map((letter) => `addr_test1${letter.repeat(48)}`);
  return titles.map((title, index) => {
    const parameters = parameterMap[title];
    const deploymentTxHash = txHash(index + 1);
    return {
      title,
      network: "preprod",
      blueprintSha256: manifest.blueprintSha256,
      sourceCompiledCodeSha256: manifest.validators[index].compiledCodeSha256,
      parameters,
      parameterDigest: computeParameterDigest(title, parameters),
      appliedScriptHash: appliedHashes[index],
      address: addresses[index],
      referenceScriptUtxo: { txHash: deploymentTxHash, outputIndex: 0 },
      deploymentTxHash,
      deploymentSlot: 9_000 + index,
      deployedAt: new Date(NOW - 20 * 60 * 1000 + index * 1_000).toISOString()
    };
  });
}

function referenceReceipts(instances = parameterizedInstances()): ReferenceScriptDeploymentReceipt[] {
  return instances.map((instance, index) => ({
    title: instance.title,
    network: "preprod",
    parameterDigest: instance.parameterDigest,
    appliedScriptHash: instance.appliedScriptHash,
    outputIndex: 0,
    confirmation: confirmation(index + 1, [], instance.appliedScriptHash)
  }));
}

function economicEvidence(instances = parameterizedInstances()): LiveEconomicEvidenceBundle {
  const perpetualRef = instances.find((instance) => instance.title.startsWith("perpetual."))!.referenceScriptUtxo;
  const optionsRef = instances.find((instance) => instance.title.startsWith("options."))!.referenceScriptUtxo;
  const notionalRef = instances.find((instance) => instance.title.startsWith("notional."))!.referenceScriptUtxo;
  return {
    network: "preprod",
    generatedAt: new Date(NOW - 10_000).toISOString(),
    funding: {
      market: "BTC-USD",
      roundId: 7,
      fundingRoundDigest: D64B,
      oracleRoundDigest: D64C,
      payerSide: "LONG",
      payerUnits: "1000",
      receiverUnits: "999",
      protocolResidualUnits: "1",
      confirmation: confirmation(20, [perpetualRef])
    },
    optionSettlement: {
      seriesId: "BTC:CALL:60000:SEP",
      settlementPrice: 62_000,
      oracleRoundDigest: D64D,
      payoutProofDigest: D64E,
      lockedCollateralUnits: "10000",
      buyerPayoutUnits: "2000",
      writerResidualUnits: "7900",
      protocolFeeUnits: "100",
      confirmation: confirmation(21, [optionsRef])
    },
    notionalSettlement: {
      market: "BTC-USD",
      side: "BUY",
      intentCommitment: D64F,
      auctionTranscriptDigest: "0".repeat(64),
      winnerQuoteDigest: "1".repeat(64),
      executionPrice: 59_950,
      userLimitPrice: 60_000,
      solverFeeBps: 12,
      competitorCount: 3,
      confirmation: confirmation(22, [notionalRef])
    }
  };
}

const confirmationPolicy = {
  minimumConfirmations: 3,
  maximumObservationAgeMs: 10 * 60 * 1000,
  maximumTipDistanceSlots: 100
};

function baseCertificate() {
  return {
    network: "preprod" as const,
    protocolVersion: "0.9.0",
    commitSha: "a".repeat(40),
    webBuildSha256: "2".repeat(64),
    blueprintSha256: "3".repeat(64),
    validatorManifestSha256: "4".repeat(64),
    sbomSha256: "5".repeat(64),
    lockfileSha256: "6".repeat(64),
    solvencyEvidenceSha256: "7".repeat(64),
    fundingEvidenceSha256: "8".repeat(64),
    optionsEvidenceSha256: "9".repeat(64),
    notionalEvidenceSha256: "a".repeat(64),
    chaosEvidenceSha256: "b".repeat(64),
    rollbackEvidenceSha256: "c".repeat(64),
    issuedAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
    expiresAt: new Date(NOW + 90 * 60 * 1000).toISOString(),
    governorApprovals: ["gov-a", "gov-b"]
  };
}

test("milestone 50 binds ordered validator parameters to final reference-script instances", () => {
  const manifest = artifactManifest();
  const instances = parameterizedInstances();
  const result = bindParameterizedDeployment({ manifest, instances, network: "preprod" });
  assert.equal(result.instances.length, 4);
  assert.match(result.deploymentDigest, /^[0-9a-f]{64}$/);

  const wrong = parameterizedInstances();
  wrong[1] = {
    ...wrong[1],
    parameters: [wrong[1].parameters[1], wrong[1].parameters[0], ...wrong[1].parameters.slice(2)]
  };
  assert.throws(() => bindParameterizedDeployment({ manifest, instances: wrong, network: "preprod" }), /parameter 0 must be oracle_authority/);
});

test("milestone 51 verifies fresh Cardano block/slot/UTxO confirmation proofs", () => {
  const proof = confirmation(40);
  const verified = validateCardanoConfirmation(proof, { ...confirmationPolicy, expectedNetwork: "preprod" }, NOW);
  assert.equal(verified.confirmations, 6);
  assert.match(verified.blockHash, /^[0-9a-f]{64}$/);
  assert.throws(() => validateCardanoConfirmation({ ...proof, confirmations: 1 }, { ...confirmationPolicy, expectedNetwork: "preprod" }, NOW), /Insufficient Cardano confirmations/);
  assert.throws(() => validateCardanoConfirmation({ ...proof, observedAt: new Date(NOW - 11 * 60 * 1000).toISOString() }, { ...confirmationPolicy, expectedNetwork: "preprod" }, NOW), /stale/);
});

test("milestone 51 binds all four applied validators to confirmed reference-script UTxOs", () => {
  const instances = parameterizedInstances();
  const result = validateReferenceScriptDeploymentBundle({
    receipts: referenceReceipts(instances),
    expected: instances.map((instance) => ({ title: instance.title, parameterDigest: instance.parameterDigest, appliedScriptHash: instance.appliedScriptHash })),
    network: "preprod",
    policy: confirmationPolicy,
    nowMs: NOW
  });
  assert.equal(result.receipts.length, 4);
  assert.equal(result.references.length, 4);
  assert.match(result.digest, /^[0-9a-f]{64}$/);

  const substituted = referenceReceipts(instances);
  substituted[0] = { ...substituted[0], appliedScriptHash: H56B };
  assert.throws(() => validateReferenceScriptDeploymentBundle({
    receipts: substituted,
    expected: instances.map((instance) => ({ title: instance.title, parameterDigest: instance.parameterDigest, appliedScriptHash: instance.appliedScriptHash })),
    network: "preprod",
    policy: confirmationPolicy,
    nowMs: NOW
  }), /hash mismatch/);

  const wrongOnChain = referenceReceipts(instances);
  wrongOnChain[0] = {
    ...wrongOnChain[0],
    confirmation: confirmation(1, [], H56B)
  };
  assert.throws(() => validateReferenceScriptDeploymentBundle({
    receipts: wrongOnChain,
    expected: instances.map((instance) => ({ title: instance.title, parameterDigest: instance.parameterDigest, appliedScriptHash: instance.appliedScriptHash })),
    network: "preprod",
    policy: confirmationPolicy,
    nowMs: NOW
  }), /reference-script hash/);
});

test("milestones 52-54 require conserved funding/options and limit-safe competitive Notional execution", () => {
  const bundle = economicEvidence();
  const result = validateLiveEconomicEvidenceBundle({ bundle, policy: confirmationPolicy, nowMs: NOW });
  assert.equal(result.verified, true);
  assert.equal(result.transactions.length, 3);

  assert.throws(() => validateLiveEconomicEvidenceBundle({
    bundle: { ...bundle, funding: { ...bundle.funding, receiverUnits: "900" } },
    policy: confirmationPolicy,
    nowMs: NOW
  }), /Funding transfer is not conserved/);

  assert.throws(() => validateLiveEconomicEvidenceBundle({
    bundle: { ...bundle, optionSettlement: { ...bundle.optionSettlement, writerResidualUnits: "7800" } },
    policy: confirmationPolicy,
    nowMs: NOW
  }), /does not conserve locked collateral/);

  assert.throws(() => validateLiveEconomicEvidenceBundle({
    bundle: { ...bundle, notionalSettlement: { ...bundle.notionalSettlement, executionPrice: 60_100 } },
    policy: confirmationPolicy,
    nowMs: NOW
  }), /breached user limit/);
});

test("milestone 55 verifies an object-level live Preprod release bundle", () => {
  const manifest = artifactManifest();
  const instances = parameterizedInstances();
  const receipts = referenceReceipts(instances);
  const economics = economicEvidence(instances);
  const certificate = baseCertificate();

  const deployment = bindParameterizedDeployment({ manifest, instances, network: "preprod" });
  const references = validateReferenceScriptDeploymentBundle({
    receipts,
    expected: instances.map((instance) => ({ title: instance.title, parameterDigest: instance.parameterDigest, appliedScriptHash: instance.appliedScriptHash })),
    network: "preprod",
    policy: confirmationPolicy,
    nowMs: NOW
  });
  const economic = validateLiveEconomicEvidenceBundle({ bundle: economics, policy: confirmationPolicy, nowMs: NOW });
  const release = validateReleaseCertificate(certificate, {
    expectedNetwork: "preprod",
    minimumGovernorApprovals: 2,
    maximumLifetimeMs: 4 * 60 * 60 * 1000
  }, NOW);
  const confirmationDigest = computeConfirmationBundleDigest({ referenceScriptReceipts: receipts, economicEvidence: economics });
  const parameterSchemaSha256 = "d".repeat(64);
  const txHashes = [...references.deploymentTransactions, ...economic.transactions];

  const attestation: PreprodReleaseAttestation = {
    network: "preprod",
    protocolVersion: "0.10.0",
    deploymentEpoch: "preprod-epoch-001",
    parameterSchemaSha256,
    parameterizedDeploymentSha256: deployment.deploymentDigest,
    referenceScriptBundleSha256: references.digest,
    confirmationBundleSha256: confirmationDigest,
    liveEconomicEvidenceSha256: economic.digest,
    baseReleaseCertificateSha256: release.digest,
    lifecycleTxHashes: txHashes,
    issuedAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
    expiresAt: new Date(NOW + 55 * 60 * 1000).toISOString(),
    governorApprovals: ["gov-a", "gov-b"]
  };

  const verifiedAttestation = validatePreprodReleaseAttestation({
    attestation,
    expected: {
      parameterSchemaSha256,
      parameterizedDeploymentSha256: deployment.deploymentDigest,
      referenceScriptBundleSha256: references.digest,
      confirmationBundleSha256: confirmationDigest,
      liveEconomicEvidenceSha256: economic.digest,
      baseReleaseCertificateSha256: release.digest,
      requiredTxHashes: txHashes
    },
    minimumGovernorApprovals: 2,
    maximumLifetimeMs: 2 * 60 * 60 * 1000,
    nowMs: NOW
  });
  assert.equal(verifiedAttestation.verified, true);

  const live = evaluateLivePreprodReleaseBundle({
    bundle: {
      network: "preprod",
      parameterSchemaSha256,
      artifactManifest: manifest,
      parameterizedValidators: instances,
      referenceScriptReceipts: receipts,
      economicEvidence: economics,
      baseReleaseCertificate: certificate,
      attestation
    },
    confirmationPolicy,
    releaseCertificatePolicy: {
      expectedNetwork: "preprod",
      minimumGovernorApprovals: 2,
      maximumLifetimeMs: 4 * 60 * 60 * 1000
    },
    minimumGovernorApprovals: 2,
    maximumAttestationLifetimeMs: 2 * 60 * 60 * 1000,
    nowMs: NOW
  });
  assert.equal(live.ready, true);
  assert.equal(live.lifecycleTransactionCount, new Set(txHashes).size);

  assert.throws(() => validatePreprodReleaseAttestation({
    attestation: { ...attestation, parameterizedDeploymentSha256: "e".repeat(64) },
    expected: {
      parameterSchemaSha256,
      parameterizedDeploymentSha256: deployment.deploymentDigest,
      referenceScriptBundleSha256: references.digest,
      confirmationBundleSha256: confirmationDigest,
      liveEconomicEvidenceSha256: economic.digest,
      baseReleaseCertificateSha256: release.digest,
      requiredTxHashes: txHashes
    },
    minimumGovernorApprovals: 2,
    maximumLifetimeMs: 2 * 60 * 60 * 1000,
    nowMs: NOW
  }), /parameterized deployment digest mismatch/);
});

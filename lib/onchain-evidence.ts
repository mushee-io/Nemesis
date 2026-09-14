import type { CardanoNetwork } from "./cardano-execution";

export type CompiledValidatorArtifact = {
  title: string;
  hash: string | null;
  compiledCodeSha256: string;
  compiledBytes: number;
  parameterized: boolean;
};

export type ValidatorArtifactManifest = {
  schemaVersion: 1;
  project: string;
  plutusVersion: "v3";
  blueprintSha256: string;
  validators: CompiledValidatorArtifact[];
};

export type DeployedValidatorEvidence = {
  title: string;
  scriptHash: string;
  address: string;
  compiledCodeSha256: string;
  network: CardanoNetwork;
};

export type E2EExecutionEvidence = {
  requestId: string;
  action: string;
  intentHash: string;
  unsignedTxSha256: string;
  witnessSetSha256: string;
  signedTxSha256: string;
  txHash: string;
  submittedAt: string;
  confirmedAt: string;
  confirmationSlot: number;
  network: CardanoNetwork;
};

export const REQUIRED_VALIDATOR_TITLES = [
  "collateral.collateral.spend",
  "perpetual.perpetual.spend",
  "options.options.spend",
  "notional.notional.spend"
] as const;

export const REQUIRED_PREPROD_ACTIONS = [
  "DEPOSIT_COLLATERAL",
  "OPEN_PERP",
  "CLOSE_PERP",
  "LIQUIDATE",
  "SETTLE_OPTION",
  "SETTLE_NOTIONAL"
] as const;

function hash64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a 32-byte hex digest`);
}

function scriptHash(value: string) {
  if (!/^[0-9a-f]{56}$/i.test(value)) throw new Error("Invalid validator script hash");
}

function address(value: string) {
  if (!/^(addr|addr_test)1[0-9a-z]+$/i.test(value)) throw new Error("Invalid Cardano validator address");
}

export function validateArtifactManifest(manifest: ValidatorArtifactManifest) {
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported validator artifact schema");
  if (manifest.plutusVersion !== "v3") throw new Error("Symbiotic requires Plutus V3 validators");
  hash64(manifest.blueprintSha256, "Blueprint SHA-256");
  for (const title of REQUIRED_VALIDATOR_TITLES) {
    const artifact = manifest.validators.find((candidate) => candidate.title === title);
    if (!artifact) throw new Error(`Missing validator artifact ${title}`);
    hash64(artifact.compiledCodeSha256, `${title} compiled code SHA-256`);
    if (!Number.isInteger(artifact.compiledBytes) || artifact.compiledBytes <= 0) throw new Error(`Invalid compiled size for ${title}`);
    if (artifact.hash != null) scriptHash(artifact.hash);
  }
  return manifest;
}

export function bindDeploymentEvidence(input: {
  manifest: ValidatorArtifactManifest;
  deployments: DeployedValidatorEvidence[];
  network: CardanoNetwork;
}) {
  validateArtifactManifest(input.manifest);
  const bound = REQUIRED_VALIDATOR_TITLES.map((title) => {
    const artifact = input.manifest.validators.find((candidate) => candidate.title === title);
    const deployment = input.deployments.find((candidate) => candidate.title === title);
    if (!artifact || !deployment) throw new Error(`Missing deployment evidence for ${title}`);
    if (deployment.network !== input.network) throw new Error(`Deployment network mismatch for ${title}`);
    if (deployment.compiledCodeSha256.toLowerCase() !== artifact.compiledCodeSha256.toLowerCase()) {
      throw new Error(`Deployed code fingerprint mismatch for ${title}`);
    }
    hash64(deployment.compiledCodeSha256, `${title} deployed code SHA-256`);
    scriptHash(deployment.scriptHash);
    address(deployment.address);
    if (artifact.hash && artifact.hash.toLowerCase() !== deployment.scriptHash.toLowerCase()) {
      throw new Error(`Blueprint hash mismatch for ${title}`);
    }
    return deployment;
  });
  return { network: input.network, validators: bound };
}

export function validateE2EEvidence(evidence: E2EExecutionEvidence, expectedNetwork: CardanoNetwork) {
  if (evidence.network !== expectedNetwork) throw new Error("E2E evidence network mismatch");
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(evidence.requestId)) throw new Error("Invalid E2E request id");
  if (!evidence.action.trim()) throw new Error("Missing E2E action");
  hash64(evidence.intentHash, "Intent hash");
  hash64(evidence.unsignedTxSha256, "Unsigned transaction SHA-256");
  hash64(evidence.witnessSetSha256, "Witness-set SHA-256");
  hash64(evidence.signedTxSha256, "Signed transaction SHA-256");
  hash64(evidence.txHash, "Transaction hash");
  const submittedAt = new Date(evidence.submittedAt).getTime();
  const confirmedAt = new Date(evidence.confirmedAt).getTime();
  if (!Number.isFinite(submittedAt) || !Number.isFinite(confirmedAt) || confirmedAt < submittedAt) {
    throw new Error("Invalid E2E confirmation timestamps");
  }
  if (!Number.isInteger(evidence.confirmationSlot) || evidence.confirmationSlot <= 0) throw new Error("Invalid E2E confirmation slot");
  return evidence;
}

export function evaluateE2EReleaseEvidence(input: {
  network: CardanoNetwork;
  executions: E2EExecutionEvidence[];
  requiredActions?: string[];
}) {
  const requiredActions = input.requiredActions ?? [...REQUIRED_PREPROD_ACTIONS];
  const validated = input.executions.map((evidence) => validateE2EEvidence(evidence, input.network));
  const requestIds = new Set<string>();
  const txHashes = new Set<string>();
  for (const evidence of validated) {
    if (requestIds.has(evidence.requestId)) throw new Error("Duplicate E2E request id");
    if (txHashes.has(evidence.txHash.toLowerCase())) throw new Error("Duplicate E2E transaction hash");
    requestIds.add(evidence.requestId);
    txHashes.add(evidence.txHash.toLowerCase());
  }
  const missingActions = requiredActions.filter((action) => !validated.some((evidence) => evidence.action === action));
  return {
    ready: missingActions.length === 0,
    network: input.network,
    executionCount: validated.length,
    missingActions
  };
}

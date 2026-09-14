import { createHash } from "node:crypto";
import type { CardanoNetwork } from "./cardano-execution";
import {
  REQUIRED_VALIDATOR_TITLES,
  validateArtifactManifest,
  type ValidatorArtifactManifest
} from "./onchain-evidence";

export type SymbioticValidatorTitle = (typeof REQUIRED_VALIDATOR_TITLES)[number];

export type AppliedValidatorParameter = {
  name: string;
  cborHex: string;
};

export type ReferenceScriptUtxo = {
  txHash: string;
  outputIndex: number;
};

export type ParameterizedValidatorInstance = {
  title: SymbioticValidatorTitle;
  network: CardanoNetwork;
  blueprintSha256: string;
  sourceCompiledCodeSha256: string;
  parameters: AppliedValidatorParameter[];
  parameterDigest: string;
  appliedScriptHash: string;
  address: string;
  referenceScriptUtxo: ReferenceScriptUtxo;
  deploymentTxHash: string;
  deploymentSlot: number;
  deployedAt: string;
};

const PARAMETER_ORDER: Record<SymbioticValidatorTitle, string[]> = {
  "collateral.collateral.spend": ["collateral_policy", "collateral_asset"],
  "perpetual.perpetual.spend": [
    "oracle_authority",
    "keeper_authority",
    "maintenance_bps",
    "collateral_policy",
    "collateral_asset"
  ],
  "options.options.spend": ["settlement_authority", "collateral_policy", "collateral_asset"],
  "notional.notional.spend": ["solver_authority"]
};

function hash64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function scriptHash(value: string) {
  if (!/^[0-9a-f]{56}$/i.test(value)) throw new Error("Invalid applied validator script hash");
}

function txHash(value: string, label = "transaction hash") {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`Invalid ${label}`);
}

function address(value: string, network: CardanoNetwork) {
  if (!/^(addr|addr_test)1[0-9a-z]+$/i.test(value)) throw new Error("Invalid parameterized validator address");
  if (network === "mainnet" && value.startsWith("addr_test1")) throw new Error("Mainnet validator cannot use a testnet address");
  if (network !== "mainnet" && value.startsWith("addr1")) throw new Error("Testnet validator cannot use a mainnet address");
}

function validCborHex(value: string, label: string) {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} must be non-empty CBOR hex`);
  }
}

function canonicalParameterMaterial(title: SymbioticValidatorTitle, parameters: AppliedValidatorParameter[]) {
  const required = PARAMETER_ORDER[title];
  if (parameters.length !== required.length) throw new Error(`${title} requires exactly ${required.length} parameters`);
  return parameters.map((parameter, index) => {
    const expectedName = required[index];
    if (parameter.name !== expectedName) {
      throw new Error(`${title} parameter ${index} must be ${expectedName}`);
    }
    validCborHex(parameter.cborHex, `${title}.${parameter.name}`);
    return `${index}:${parameter.name}:${parameter.cborHex.toLowerCase()}`;
  }).join("|");
}

export function computeParameterDigest(title: SymbioticValidatorTitle, parameters: AppliedValidatorParameter[]) {
  const material = canonicalParameterMaterial(title, parameters);
  return createHash("sha256").update(`${title}|${material}`).digest("hex");
}

export function utxoRef(utxo: ReferenceScriptUtxo) {
  txHash(utxo.txHash, "reference-script transaction hash");
  if (!Number.isInteger(utxo.outputIndex) || utxo.outputIndex < 0 || utxo.outputIndex > 65535) {
    throw new Error("Invalid reference-script output index");
  }
  return `${utxo.txHash.toLowerCase()}#${utxo.outputIndex}`;
}

export function validateParameterizedValidatorInstance(
  instance: ParameterizedValidatorInstance,
  artifactManifest: ValidatorArtifactManifest,
  expectedNetwork: CardanoNetwork
) {
  validateArtifactManifest(artifactManifest);
  if (!REQUIRED_VALIDATOR_TITLES.includes(instance.title)) throw new Error("Unknown Symbiotic validator title");
  if (instance.network !== expectedNetwork) throw new Error(`${instance.title} deployment network mismatch`);
  hash64(instance.blueprintSha256, "Blueprint SHA-256");
  hash64(instance.sourceCompiledCodeSha256, `${instance.title} source compiled code SHA-256`);
  if (instance.blueprintSha256.toLowerCase() !== artifactManifest.blueprintSha256.toLowerCase()) {
    throw new Error(`${instance.title} blueprint fingerprint mismatch`);
  }

  const artifact = artifactManifest.validators.find((candidate) => candidate.title === instance.title);
  if (!artifact) throw new Error(`Missing source artifact for ${instance.title}`);
  if (!artifact.parameterized) throw new Error(`${instance.title} must be parameterized before deployment`);
  if (artifact.compiledCodeSha256.toLowerCase() !== instance.sourceCompiledCodeSha256.toLowerCase()) {
    throw new Error(`${instance.title} source compiled code fingerprint mismatch`);
  }

  const parameterDigest = computeParameterDigest(instance.title, instance.parameters);
  if (parameterDigest !== instance.parameterDigest.toLowerCase()) throw new Error(`${instance.title} parameter digest mismatch`);
  scriptHash(instance.appliedScriptHash);
  address(instance.address, instance.network);
  txHash(instance.deploymentTxHash, "deployment transaction hash");
  if (instance.deploymentTxHash.toLowerCase() !== instance.referenceScriptUtxo.txHash.toLowerCase()) {
    throw new Error(`${instance.title} reference-script UTxO must originate from the deployment transaction`);
  }
  utxoRef(instance.referenceScriptUtxo);
  if (!Number.isInteger(instance.deploymentSlot) || instance.deploymentSlot <= 0) throw new Error("Invalid deployment slot");
  const deployedAt = new Date(instance.deployedAt).getTime();
  if (!Number.isFinite(deployedAt)) throw new Error("Invalid deployment timestamp");

  return {
    ...instance,
    parameterDigest,
    appliedScriptHash: instance.appliedScriptHash.toLowerCase(),
    deploymentTxHash: instance.deploymentTxHash.toLowerCase(),
    referenceScriptRef: utxoRef(instance.referenceScriptUtxo)
  };
}

export function bindParameterizedDeployment(input: {
  manifest: ValidatorArtifactManifest;
  instances: ParameterizedValidatorInstance[];
  network: CardanoNetwork;
}) {
  validateArtifactManifest(input.manifest);
  if (input.instances.length !== REQUIRED_VALIDATOR_TITLES.length) {
    throw new Error(`Expected ${REQUIRED_VALIDATOR_TITLES.length} parameterized validator instances`);
  }

  const validated = REQUIRED_VALIDATOR_TITLES.map((title) => {
    const instance = input.instances.find((candidate) => candidate.title === title);
    if (!instance) throw new Error(`Missing parameterized deployment for ${title}`);
    return validateParameterizedValidatorInstance(instance, input.manifest, input.network);
  });

  const scriptHashes = validated.map((instance) => instance.appliedScriptHash);
  if (new Set(scriptHashes).size !== scriptHashes.length) throw new Error("Parameterized validators must have unique applied script hashes");
  const references = validated.map((instance) => instance.referenceScriptRef);
  if (new Set(references).size !== references.length) throw new Error("Parameterized validators must have unique reference-script UTxOs");
  const addresses = validated.map((instance) => instance.address.toLowerCase());
  if (new Set(addresses).size !== addresses.length) throw new Error("Parameterized validators must have unique addresses");

  const deploymentDigest = createHash("sha256").update(
    validated.map((instance) => [
      instance.title,
      instance.appliedScriptHash,
      instance.parameterDigest,
      instance.referenceScriptRef,
      instance.deploymentSlot
    ].join(":" )).join("|")
  ).digest("hex");

  return {
    network: input.network,
    deploymentDigest,
    instances: validated
  };
}

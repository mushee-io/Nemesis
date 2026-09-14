import type { CardanoNetwork } from "./cardano-execution";

export type ValidatorDeployment = {
  name: "collateral" | "perpetual" | "options" | "notional" | "registry";
  address?: string;
  scriptHash?: string;
};

export type SymbioticDeploymentManifest = {
  network: CardanoNetwork;
  providerEndpoint?: string;
  indexerEndpoint?: string;
  transactionBuilderEndpoint?: string;
  oracleSources: string[];
  validators: ValidatorDeployment[];
};

export type ReadinessCheck = {
  id: string;
  ready: boolean;
  detail: string;
};

function validHttpUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function validScriptHash(value?: string) {
  return Boolean(value && /^[0-9a-f]{56}$/i.test(value));
}

function validCardanoAddress(value?: string) {
  return Boolean(value && /^(addr|addr_test)1[0-9a-z]+$/i.test(value));
}

export function evaluateDeploymentReadiness(manifest: SymbioticDeploymentManifest) {
  const requiredValidators: ValidatorDeployment["name"][] = ["collateral", "perpetual", "options", "notional", "registry"];
  const checks: ReadinessCheck[] = [
    { id: "provider", ready: validHttpUrl(manifest.providerEndpoint), detail: "Chain provider endpoint must be configured over HTTPS (localhost allowed in development)." },
    { id: "indexer", ready: validHttpUrl(manifest.indexerEndpoint), detail: "Indexer endpoint must be configured before portfolio state is authoritative." },
    { id: "transaction-builder", ready: validHttpUrl(manifest.transactionBuilderEndpoint), detail: "A backend transaction builder/assembler is required for CIP-30 signing." },
    { id: "oracle-quorum", ready: new Set(manifest.oracleSources.filter(Boolean)).size >= 2, detail: "At least two independent oracle source identifiers are required." }
  ];

  for (const name of requiredValidators) {
    const validator = manifest.validators.find((candidate) => candidate.name === name);
    checks.push({
      id: `validator-${name}`,
      ready: Boolean(validator && validScriptHash(validator.scriptHash) && validCardanoAddress(validator.address)),
      detail: `${name} validator requires a deployed script hash and Cardano address.`
    });
  }

  return {
    network: manifest.network,
    ready: checks.every((check) => check.ready),
    checks,
    missing: checks.filter((check) => !check.ready).map((check) => check.id)
  };
}

export function deploymentManifestFromEnv(env: Record<string, string | undefined>): SymbioticDeploymentManifest {
  const network = env.SYMBIOTIC_CARDANO_NETWORK;
  if (network && !["preview", "preprod", "mainnet"].includes(network)) throw new Error("Invalid SYMBIOTIC_CARDANO_NETWORK");

  const validators: ValidatorDeployment[] = (["COLLATERAL", "PERPETUAL", "OPTIONS", "NOTIONAL", "REGISTRY"] as const).map((key) => ({
    name: key.toLowerCase() as ValidatorDeployment["name"],
    address: env[`SYMBIOTIC_${key}_VALIDATOR_ADDRESS`],
    scriptHash: env[`SYMBIOTIC_${key}_VALIDATOR_HASH`]
  }));

  return {
    network: (network as CardanoNetwork | undefined) ?? "preprod",
    providerEndpoint: env.SYMBIOTIC_PROVIDER_ENDPOINT,
    indexerEndpoint: env.SYMBIOTIC_INDEXER_ENDPOINT,
    transactionBuilderEndpoint: env.SYMBIOTIC_TX_BUILDER_ENDPOINT,
    oracleSources: (env.SYMBIOTIC_ORACLE_SOURCES ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    validators
  };
}

import { createHash } from "node:crypto";
import { assertPreprodAddress } from "./cardano-testnet-profile";

export type TestnetValidatorName = "collateral" | "perpetual" | "options" | "notional" | "registry";

export type TestnetValidatorInstance = {
  name: TestnetValidatorName;
  blueprintTitle: string;
  parameterCborHex: string[];
  parameterDigest: string;
  sourceCompiledCodeDigest: string;
  appliedScriptHash: string;
  address: string;
  referenceScriptUtxo: string;
  deploymentTxHash: string;
  deploymentSlot: number;
};

export type TestnetDeploymentManifest = {
  network: "preprod";
  networkMagic: 1;
  profileRoot: string;
  blueprintSha256: string;
  parameterSchemaSha256: string;
  deployedByAddress: string;
  validators: TestnetValidatorInstance[];
  generatedAt: string;
};

const REQUIRED: TestnetValidatorName[] = ["collateral", "perpetual", "options", "notional", "registry"];
function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be 64 hex`); return v.toLowerCase(); }
function h56(v: string, label: string) { if (!/^[0-9a-f]{56}$/i.test(v)) throw new Error(`${label} must be 56 hex`); return v.toLowerCase(); }
function utxo(v: string, label: string) { if (!/^[0-9a-f]{64}#[0-9]+$/i.test(v)) throw new Error(`${label} must be txHash#index`); return v.toLowerCase(); }
function cbor(v: string, label: string) { if (!/^[0-9a-f]*$/i.test(v) || v.length % 2 !== 0) throw new Error(`${label} must be even-length CBOR hex`); return v.toLowerCase(); }

export function parameterDigest(values: string[]) {
  const normalized = values.map((value, i) => cbor(value, `Parameter ${i}`));
  return createHash("sha256").update(normalized.join("|")).digest("hex");
}

export function validateTestnetDeploymentManifest(manifest: TestnetDeploymentManifest, nowMs = Date.now()) {
  if (manifest.network !== "preprod" || manifest.networkMagic !== 1) throw new Error("Finalized Symbiotic testnet deployment must target Cardano Preprod magic 1");
  const profileRoot = d64(manifest.profileRoot, "Profile root");
  const blueprintSha256 = d64(manifest.blueprintSha256, "Blueprint digest");
  const parameterSchemaSha256 = d64(manifest.parameterSchemaSha256, "Parameter schema digest");
  assertPreprodAddress(manifest.deployedByAddress, "Deployment wallet address");
  const generatedAt = new Date(manifest.generatedAt).getTime();
  if (!Number.isFinite(generatedAt) || generatedAt > nowMs + 60_000) throw new Error("Deployment manifest timestamp is invalid");
  if (manifest.validators.length !== REQUIRED.length) throw new Error("Deployment manifest must include exactly five validators");
  const names = new Set<TestnetValidatorName>();
  const hashes = new Set<string>();
  const refs = new Set<string>();
  const txs = new Set<string>();
  const normalized = manifest.validators.map((validator) => {
    if (!REQUIRED.includes(validator.name) || names.has(validator.name)) throw new Error("Missing or duplicate validator deployment");
    names.add(validator.name);
    if (!validator.blueprintTitle.endsWith(".spend")) throw new Error(`${validator.name} blueprint title must be a spend validator`);
    const params = validator.parameterCborHex.map((value, i) => cbor(value, `${validator.name} parameter ${i}`));
    const digest = d64(validator.parameterDigest, `${validator.name} parameter digest`);
    if (parameterDigest(params) !== digest) throw new Error(`${validator.name} parameter digest mismatch`);
    const sourceCompiledCodeDigest = d64(validator.sourceCompiledCodeDigest, `${validator.name} compiled-code digest`);
    const appliedScriptHash = h56(validator.appliedScriptHash, `${validator.name} script hash`);
    if (hashes.has(appliedScriptHash)) throw new Error("Applied validator script hashes must be unique");
    hashes.add(appliedScriptHash);
    assertPreprodAddress(validator.address, `${validator.name} validator address`);
    const referenceScriptUtxo = utxo(validator.referenceScriptUtxo, `${validator.name} reference script UTxO`);
    if (refs.has(referenceScriptUtxo)) throw new Error("Reference script UTxOs must be unique");
    refs.add(referenceScriptUtxo);
    const deploymentTxHash = d64(validator.deploymentTxHash, `${validator.name} deployment tx`);
    txs.add(deploymentTxHash);
    if (!Number.isInteger(validator.deploymentSlot) || validator.deploymentSlot < 1) throw new Error("Deployment slot must be positive");
    if (!referenceScriptUtxo.startsWith(`${deploymentTxHash}#`)) throw new Error(`${validator.name} reference UTxO must be created by its deployment transaction`);
    return { ...validator, parameterCborHex: params, parameterDigest: digest, sourceCompiledCodeDigest, appliedScriptHash, referenceScriptUtxo, deploymentTxHash };
  });
  for (const name of REQUIRED) if (!names.has(name)) throw new Error(`Missing ${name} deployment`);
  const root = createHash("sha256").update([
    manifest.network, manifest.networkMagic, profileRoot, blueprintSha256, parameterSchemaSha256, manifest.deployedByAddress,
    ...normalized.slice().sort((a,b) => a.name.localeCompare(b.name)).map((v) => [v.name,v.blueprintTitle,v.parameterDigest,v.sourceCompiledCodeDigest,v.appliedScriptHash,v.address,v.referenceScriptUtxo,v.deploymentTxHash,v.deploymentSlot].join(":"))
  ].join("|")).digest("hex");
  return { ...manifest, profileRoot, blueprintSha256, parameterSchemaSha256, validators: normalized, root, deploymentTransactionCount: txs.size };
}

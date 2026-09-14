import { createHash } from "node:crypto";
import type { CardanoNetwork } from "./cardano-execution";
import type { BuilderRequest } from "./transaction-builder";
import {
  assertReferenceScriptDeployed,
  canonicalUtxoRef,
  validateCardanoConfirmation,
  type CardanoConfirmationProof,
  type ConfirmationPolicy
} from "./chain-confirmation-v2";
import { REQUIRED_VALIDATOR_TITLES } from "./onchain-evidence";
import type { SymbioticValidatorTitle } from "./parameterized-deployment";

export type ReferenceScriptDeploymentIntent = {
  title: SymbioticValidatorTitle;
  network: CardanoNetwork;
  parameterDigest: string;
  appliedScriptHash: string;
  appliedScriptCborHex: string;
  destinationAddress: string;
  minimumLovelace: string;
  expiresAt: string;
};

export type ReferenceScriptDeploymentReceipt = {
  title: SymbioticValidatorTitle;
  network: CardanoNetwork;
  parameterDigest: string;
  appliedScriptHash: string;
  outputIndex: number;
  confirmation: CardanoConfirmationProof;
};

function sha64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function scriptHash(value: string) {
  if (!/^[0-9a-f]{56}$/i.test(value)) throw new Error("Invalid reference-script hash");
}

function cardanoAddress(value: string, network: CardanoNetwork) {
  if (!/^(addr|addr_test)1[0-9a-z]+$/i.test(value)) throw new Error("Invalid reference-script destination address");
  if (network === "mainnet" && value.startsWith("addr_test1")) throw new Error("Mainnet reference script requires a mainnet address");
  if (network !== "mainnet" && value.startsWith("addr1")) throw new Error("Testnet reference script requires a testnet address");
}

function cborHex(value: string) {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) throw new Error("Applied validator script must be CBOR hex");
}

export function validateReferenceScriptDeploymentIntent(intent: ReferenceScriptDeploymentIntent, nowMs = Date.now()) {
  sha64(intent.parameterDigest, "Parameter digest");
  scriptHash(intent.appliedScriptHash);
  cborHex(intent.appliedScriptCborHex);
  cardanoAddress(intent.destinationAddress, intent.network);
  if (!/^\d+$/.test(intent.minimumLovelace) || BigInt(intent.minimumLovelace) < 1_000_000n) {
    throw new Error("Reference-script output must reserve at least 1 ADA");
  }
  const expiresAt = new Date(intent.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) throw new Error("Reference-script deployment intent is expired");
  if (expiresAt - nowMs > 15 * 60 * 1000) throw new Error("Reference-script deployment intent TTL exceeds 15 minutes");
  return intent;
}

export function createReferenceScriptBuilderRequest(input: {
  intent: ReferenceScriptDeploymentIntent;
  account: string;
  nowMs?: number;
}): BuilderRequest {
  const intent = validateReferenceScriptDeploymentIntent(input.intent, input.nowMs ?? Date.now());
  cardanoAddress(input.account, intent.network);
  const canonical = [
    intent.title,
    intent.network,
    intent.parameterDigest.toLowerCase(),
    intent.appliedScriptHash.toLowerCase(),
    createHash("sha256").update(intent.appliedScriptCborHex.toLowerCase()).digest("hex"),
    intent.destinationAddress,
    intent.minimumLovelace,
    intent.expiresAt
  ].join("|");
  const intentHash = createHash("sha256").update(canonical).digest("hex");
  return {
    action: "DEPLOY_REFERENCE_SCRIPT",
    network: intent.network,
    account: input.account,
    intentHash,
    payload: {
      title: intent.title,
      parameterDigest: intent.parameterDigest.toLowerCase(),
      appliedScriptHash: intent.appliedScriptHash.toLowerCase(),
      appliedScriptCborHex: intent.appliedScriptCborHex.toLowerCase(),
      destinationAddress: intent.destinationAddress,
      minimumLovelace: intent.minimumLovelace,
      expiresAt: intent.expiresAt
    }
  };
}

export function validateReferenceScriptDeploymentReceipt(input: {
  receipt: ReferenceScriptDeploymentReceipt;
  policy: Omit<ConfirmationPolicy, "expectedNetwork">;
  expectedParameterDigest: string;
  expectedScriptHash: string;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const receipt = input.receipt;
  sha64(receipt.parameterDigest, "Receipt parameter digest");
  scriptHash(receipt.appliedScriptHash);
  if (receipt.parameterDigest.toLowerCase() !== input.expectedParameterDigest.toLowerCase()) {
    throw new Error("Reference-script deployment parameter digest mismatch");
  }
  if (receipt.appliedScriptHash.toLowerCase() !== input.expectedScriptHash.toLowerCase()) {
    throw new Error("Reference-script deployment hash mismatch");
  }
  if (!Number.isInteger(receipt.outputIndex) || receipt.outputIndex < 0) throw new Error("Invalid reference-script output index");
  const confirmation = validateCardanoConfirmation(receipt.confirmation, {
    ...input.policy,
    expectedNetwork: receipt.network
  }, nowMs);
  const expectedReference = { txHash: confirmation.txHash, outputIndex: receipt.outputIndex };
  const reference = canonicalUtxoRef(expectedReference);
  if (!confirmation.outputRefs.includes(reference)) throw new Error("Reference-script UTxO is not present in confirmed deployment outputs");
  assertReferenceScriptDeployed({
    confirmation: receipt.confirmation,
    expectedReference,
    expectedScriptHash: receipt.appliedScriptHash
  });
  return {
    verified: true,
    title: receipt.title,
    network: receipt.network,
    parameterDigest: receipt.parameterDigest.toLowerCase(),
    appliedScriptHash: receipt.appliedScriptHash.toLowerCase(),
    referenceScriptRef: reference,
    confirmation
  };
}

export function validateReferenceScriptDeploymentBundle(input: {
  receipts: ReferenceScriptDeploymentReceipt[];
  expected: Array<{ title: SymbioticValidatorTitle; parameterDigest: string; appliedScriptHash: string }>;
  network: CardanoNetwork;
  policy: Omit<ConfirmationPolicy, "expectedNetwork">;
  nowMs?: number;
}) {
  if (input.receipts.length !== REQUIRED_VALIDATOR_TITLES.length) {
    throw new Error(`Expected ${REQUIRED_VALIDATOR_TITLES.length} reference-script deployment receipts`);
  }
  const validated = REQUIRED_VALIDATOR_TITLES.map((title) => {
    const receipt = input.receipts.find((candidate) => candidate.title === title);
    const expected = input.expected.find((candidate) => candidate.title === title);
    if (!receipt || !expected) throw new Error(`Missing reference-script deployment receipt for ${title}`);
    if (receipt.network !== input.network) throw new Error(`${title} reference-script network mismatch`);
    return validateReferenceScriptDeploymentReceipt({
      receipt,
      policy: input.policy,
      expectedParameterDigest: expected.parameterDigest,
      expectedScriptHash: expected.appliedScriptHash,
      nowMs: input.nowMs
    });
  });

  const refs = validated.map((receipt) => receipt.referenceScriptRef);
  if (new Set(refs).size !== refs.length) throw new Error("Reference-script bundle contains duplicate UTxOs");
  const txHashes = validated.map((receipt) => receipt.confirmation.txHash);
  const digest = createHash("sha256").update(validated.map((receipt) => [
    receipt.title,
    receipt.parameterDigest,
    receipt.appliedScriptHash,
    receipt.referenceScriptRef,
    receipt.confirmation.blockHash,
    receipt.confirmation.slot
  ].join(":" )).join("|")).digest("hex");

  return {
    verified: true,
    network: input.network,
    digest,
    references: refs,
    deploymentTransactions: [...new Set(txHashes)],
    receipts: validated
  };
}

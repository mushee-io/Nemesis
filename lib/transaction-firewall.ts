import type { BuilderAction } from "./transaction-builder";
import type { CardanoNetwork, PreparedCardanoTransaction } from "./cardano-execution";

export type PreparedTransactionSummary = {
  action: BuilderAction;
  account: string;
  network: CardanoNetwork;
  feeLovelace: string;
  scriptHashes: string[];
  outputs: Array<{ address: string; lovelace: string }>;
  changeAddress?: string;
  txBodyHash: string;
};

export type HardenedPreparedTransaction = PreparedCardanoTransaction & {
  summary: PreparedTransactionSummary;
};

export type TransactionFirewallPolicy = {
  account: string;
  network: CardanoNetwork;
  allowedActions: BuilderAction[];
  allowedScriptHashes: string[];
  allowedOutputAddresses?: string[];
  expectedChangeAddress?: string;
  maxFeeLovelace: bigint;
  maxOutputs?: number;
};

function parseLovelace(value: string, field: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be an unsigned integer string`);
  return BigInt(value);
}

function normalizeHash(value: string) {
  if (!/^[0-9a-f]{56}$/i.test(value)) throw new Error("Invalid validator script hash");
  return value.toLowerCase();
}

function validAddress(address: string) {
  return /^(addr|addr_test)1[0-9a-z]+$/i.test(address);
}

export function validateTransactionFirewall(input: {
  prepared: HardenedPreparedTransaction;
  policy: TransactionFirewallPolicy;
}) {
  const { prepared, policy } = input;
  const summary = prepared.summary;

  if (summary.network !== prepared.network || summary.network !== policy.network) {
    throw new Error("Transaction firewall rejected network mismatch");
  }
  if (summary.account !== policy.account) throw new Error("Transaction firewall rejected account mismatch");
  if (!policy.allowedActions.includes(summary.action)) throw new Error("Transaction action is not allowed by policy");
  if (!/^[0-9a-f]{64}$/i.test(summary.txBodyHash)) throw new Error("Transaction body hash is invalid");
  if (!validAddress(summary.account)) throw new Error("Transaction account address is invalid");

  const fee = parseLovelace(summary.feeLovelace, "feeLovelace");
  if (fee > policy.maxFeeLovelace) throw new Error("Transaction fee exceeds policy maximum");

  const maxOutputs = policy.maxOutputs ?? 12;
  if (!Number.isInteger(maxOutputs) || maxOutputs < 1 || maxOutputs > 64) throw new Error("Invalid transaction output cap");
  if (summary.outputs.length === 0 || summary.outputs.length > maxOutputs) throw new Error("Transaction output count violates policy");

  const allowedScripts = new Set(policy.allowedScriptHashes.map(normalizeHash));
  for (const hash of summary.scriptHashes) {
    if (!allowedScripts.has(normalizeHash(hash))) throw new Error("Transaction references an unapproved validator script");
  }

  const allowedOutputs = policy.allowedOutputAddresses ? new Set(policy.allowedOutputAddresses) : null;
  for (const output of summary.outputs) {
    if (!validAddress(output.address)) throw new Error("Transaction output address is invalid");
    const lovelace = parseLovelace(output.lovelace, "output lovelace");
    if (lovelace < 0n) throw new Error("Transaction output value is invalid");
    if (allowedOutputs && !allowedOutputs.has(output.address) && output.address !== policy.expectedChangeAddress) {
      throw new Error("Transaction contains an unapproved output address");
    }
  }

  if (policy.expectedChangeAddress) {
    if (summary.changeAddress !== policy.expectedChangeAddress) throw new Error("Transaction change address mismatch");
  }

  return true;
}

import { createHash } from "node:crypto";
import { assertPreprodAddress, CARDANO_PREPROD_PROFILE } from "./cardano-testnet-profile";
import type { Cip30WalletApi } from "./cardano-execution";

export type WalletPreflightPolicy = {
  requireUtxos: boolean;
  maximumUtxoPages: number;
  pageSize: number;
};

export type WalletPreflightEvidence = {
  networkId: number;
  changeAddress: string;
  utxoCount: number;
  changeAddressDigest: string;
  observedAt: string;
  digest: string;
};

function validHex(value: string) {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

export async function runPreprodWalletPreflight(api: Cip30WalletApi, policy: WalletPreflightPolicy, nowMs = Date.now()): Promise<WalletPreflightEvidence> {
  if (!Number.isInteger(policy.maximumUtxoPages) || policy.maximumUtxoPages < 1 || policy.maximumUtxoPages > 50) throw new Error("Invalid wallet UTxO page cap");
  if (!Number.isInteger(policy.pageSize) || policy.pageSize < 1 || policy.pageSize > 100) throw new Error("Invalid wallet UTxO page size");
  const networkId = await api.getNetworkId();
  if (networkId !== CARDANO_PREPROD_PROFILE.cip30NetworkId) throw new Error(`Wallet must be connected to Cardano Preprod testnet (CIP-30 network id ${CARDANO_PREPROD_PROFILE.cip30NetworkId})`);
  const changeAddress = await api.getChangeAddress();
  if (!validHex(changeAddress)) throw new Error("CIP-30 change address must be returned as CBOR hex");

  let utxoCount = 0;
  for (let page = 0; page < policy.maximumUtxoPages; page += 1) {
    const utxos = await api.getUtxos(undefined, { page, limit: policy.pageSize });
    if (utxos === null) break;
    for (const utxo of utxos) if (!validHex(utxo)) throw new Error("Wallet returned an invalid CIP-30 UTxO CBOR value");
    utxoCount += utxos.length;
    if (utxos.length < policy.pageSize) break;
  }
  if (policy.requireUtxos && utxoCount === 0) throw new Error("Preprod wallet has no spendable UTxOs; fund it with test ADA before execution");
  const observedAt = new Date(nowMs).toISOString();
  const changeAddressDigest = createHash("sha256").update(changeAddress.toLowerCase()).digest("hex");
  const digest = createHash("sha256").update([networkId, changeAddressDigest, utxoCount, observedAt].join("|")).digest("hex");
  return { networkId, changeAddress, utxoCount, changeAddressDigest, observedAt, digest };
}

export function validateBech32WalletAddress(address: string) {
  return assertPreprodAddress(address, "Decoded wallet address");
}

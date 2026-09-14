import { createHash } from "node:crypto";

export type CardanoTestnetName = "preprod";

export type CardanoTestnetProfile = {
  network: CardanoTestnetName;
  networkMagic: 1;
  cip30NetworkId: 0;
  addressPrefix: "addr_test1";
  stakeAddressPrefix: "stake_test1";
  explorerNetworkPath: "/preprod";
  protocolFamily: "cardano";
};

export const CARDANO_PREPROD_PROFILE: CardanoTestnetProfile = Object.freeze({
  network: "preprod",
  networkMagic: 1,
  cip30NetworkId: 0,
  addressPrefix: "addr_test1",
  stakeAddressPrefix: "stake_test1",
  explorerNetworkPath: "/preprod",
  protocolFamily: "cardano"
});

export function assertPreprodAddress(address: string, label = "Cardano address") {
  if (!/^addr_test1[0-9a-z]+$/.test(address)) throw new Error(`${label} must be a Cardano testnet addr_test address`);
  return address;
}

export function assertPreprodStakeAddress(address: string, label = "Cardano stake address") {
  if (!/^stake_test1[0-9a-z]+$/.test(address)) throw new Error(`${label} must be a Cardano testnet stake_test address`);
  return address;
}

export function validateCardanoTestnetProfile(profile: CardanoTestnetProfile) {
  if (profile.network !== "preprod") throw new Error("Symbiotic finalized testnet profile must be preprod");
  if (profile.networkMagic !== 1) throw new Error("Cardano Preprod testnet magic must be 1");
  if (profile.cip30NetworkId !== 0) throw new Error("CIP-30 testnet network id must be 0");
  if (profile.addressPrefix !== "addr_test1" || profile.stakeAddressPrefix !== "stake_test1") throw new Error("Invalid Preprod address prefixes");
  if (profile.explorerNetworkPath !== "/preprod") throw new Error("Invalid Preprod explorer path");
  const root = createHash("sha256").update([
    profile.protocolFamily,
    profile.network,
    profile.networkMagic,
    profile.cip30NetworkId,
    profile.addressPrefix,
    profile.stakeAddressPrefix,
    profile.explorerNetworkPath
  ].join("|")).digest("hex");
  return { ...profile, root };
}

export function preprodProfileFromEnv(env: Record<string, string | undefined>): CardanoTestnetProfile {
  const network = (env.SYMBIOTIC_CARDANO_NETWORK ?? "preprod").toLowerCase();
  if (network !== "preprod") throw new Error("SYMBIOTIC_CARDANO_NETWORK must be preprod for finalized testnet builds");
  const magic = Number(env.SYMBIOTIC_TESTNET_MAGIC ?? "1");
  if (magic !== 1) throw new Error("SYMBIOTIC_TESTNET_MAGIC must be 1 for Cardano Preprod");
  return CARDANO_PREPROD_PROFILE;
}

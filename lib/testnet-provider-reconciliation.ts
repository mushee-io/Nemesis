import { createHash } from "node:crypto";
import { assertPreprodAddress } from "./cardano-testnet-profile";

export type TestnetProviderKind = "BLOCKFROST" | "KOIOS" | "CUSTOM";
export type TestnetProviderRole = "READ" | "SUBMIT" | "INDEX";

export type TestnetProviderConfig = {
  id: string;
  kind: TestnetProviderKind;
  role: TestnetProviderRole;
  endpoint: string;
  providerGroup: string;
  region: string;
  authHeader?: string;
};

export type NormalizedTestnetUtxo = {
  txHash: string;
  outputIndex: number;
  address: string;
  lovelace: string;
  datumHash?: string;
  inlineDatumCborHex?: string;
  referenceScriptHash?: string;
};

export type TestnetChainSnapshot = {
  providerId: string;
  providerGroup: string;
  address: string;
  tipSlot: number;
  tipBlockHash: string;
  observedAt: string;
  utxos: NormalizedTestnetUtxo[];
};

export type ProviderReconciliationPolicy = {
  minimumProviders: number;
  minimumIndependentGroups: number;
  maximumTipSkewSlots: number;
  maximumObservationAgeMs: number;
};

function d64(v: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be a 64-hex digest`);
  return v.toLowerCase();
}

export function validateTestnetProviderConfig(config: TestnetProviderConfig) {
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(config.id)) throw new Error("Invalid testnet provider id");
  if (!config.providerGroup.trim() || !config.region.trim()) throw new Error("Provider group and region are required");
  let url: URL;
  try { url = new URL(config.endpoint); } catch { throw new Error("Provider endpoint must be a valid URL"); }
  if (url.protocol !== "https:") throw new Error("Preprod provider endpoints must use HTTPS");
  if (config.kind === "BLOCKFROST" && !url.hostname.includes("preprod")) throw new Error("Blockfrost endpoint must explicitly target Preprod");
  if (config.kind === "KOIOS" && !url.hostname.includes("preprod")) throw new Error("Koios endpoint must explicitly target Preprod");
  return config;
}

export function buildProviderRequest(config: TestnetProviderConfig, resource: "TIP" | "UTXOS", address?: string) {
  validateTestnetProviderConfig(config);
  if (resource === "UTXOS") assertPreprodAddress(address ?? "", "Provider UTxO address");
  const base = config.endpoint.replace(/\/$/, "");
  if (config.kind === "BLOCKFROST") {
    return resource === "TIP"
      ? { method: "GET" as const, url: `${base}/blocks/latest` }
      : { method: "GET" as const, url: `${base}/addresses/${address}/utxos?count=100&order=asc` };
  }
  if (config.kind === "KOIOS") {
    return resource === "TIP"
      ? { method: "GET" as const, url: `${base}/tip` }
      : { method: "POST" as const, url: `${base}/address_utxos`, body: JSON.stringify({ _addresses: [address], _extended: true }) };
  }
  return resource === "TIP"
    ? { method: "GET" as const, url: `${base}/tip` }
    : { method: "GET" as const, url: `${base}/addresses/${address}/utxos` };
}

export function normalizedUtxoFingerprint(utxo: NormalizedTestnetUtxo) {
  d64(utxo.txHash, "UTxO transaction hash");
  if (!Number.isInteger(utxo.outputIndex) || utxo.outputIndex < 0) throw new Error("Invalid UTxO output index");
  assertPreprodAddress(utxo.address, "UTxO address");
  if (!/^\d+$/.test(utxo.lovelace)) throw new Error("UTxO lovelace must be an unsigned integer string");
  if (utxo.datumHash) d64(utxo.datumHash, "Datum hash");
  if (utxo.referenceScriptHash && !/^[0-9a-f]{56}$/i.test(utxo.referenceScriptHash)) throw new Error("Reference script hash must be 56 hex characters");
  if (utxo.inlineDatumCborHex && (!/^[0-9a-f]+$/i.test(utxo.inlineDatumCborHex) || utxo.inlineDatumCborHex.length % 2 !== 0)) throw new Error("Inline datum must be CBOR hex");
  return `${utxo.txHash.toLowerCase()}#${utxo.outputIndex}:${utxo.address}:${utxo.lovelace}:${(utxo.datumHash ?? "").toLowerCase()}:${(utxo.referenceScriptHash ?? "").toLowerCase()}`;
}

export function reconcileTestnetSnapshots(snapshots: TestnetChainSnapshot[], policy: ProviderReconciliationPolicy, nowMs = Date.now()) {
  if (!Number.isInteger(policy.minimumProviders) || policy.minimumProviders < 2) throw new Error("Provider reconciliation requires at least two providers");
  if (!Number.isInteger(policy.minimumIndependentGroups) || policy.minimumIndependentGroups < 2) throw new Error("Provider reconciliation requires independent provider groups");
  if (snapshots.length < policy.minimumProviders) throw new Error("Insufficient provider snapshots");
  const providerIds = new Set<string>(), groups = new Set<string>(), addresses = new Set<string>();
  const normalized = snapshots.map((snapshot) => {
    if (providerIds.has(snapshot.providerId)) throw new Error("Duplicate provider snapshot");
    providerIds.add(snapshot.providerId); groups.add(snapshot.providerGroup); addresses.add(snapshot.address);
    assertPreprodAddress(snapshot.address, "Snapshot address");
    d64(snapshot.tipBlockHash, "Tip block hash");
    if (!Number.isInteger(snapshot.tipSlot) || snapshot.tipSlot < 1) throw new Error("Invalid provider tip slot");
    const observed = new Date(snapshot.observedAt).getTime();
    if (!Number.isFinite(observed) || observed > nowMs + 30_000 || nowMs - observed > policy.maximumObservationAgeMs) throw new Error("Provider snapshot is stale or future-dated");
    const utxoSet = snapshot.utxos.map(normalizedUtxoFingerprint).sort();
    if (new Set(utxoSet).size !== utxoSet.length) throw new Error("Duplicate UTxO in provider snapshot");
    return { ...snapshot, utxoRoot: createHash("sha256").update(utxoSet.join("|")).digest("hex") };
  });
  if (groups.size < policy.minimumIndependentGroups) throw new Error("Insufficient independent provider groups");
  if (addresses.size !== 1) throw new Error("Provider snapshots refer to different addresses");
  const slots = normalized.map((s) => s.tipSlot), tipSkew = Math.max(...slots) - Math.min(...slots);
  if (tipSkew > policy.maximumTipSkewSlots) throw new Error("Provider tip skew exceeds policy");
  const rootCounts = new Map<string, number>();
  for (const snapshot of normalized) rootCounts.set(snapshot.utxoRoot, (rootCounts.get(snapshot.utxoRoot) ?? 0) + 1);
  const consensus = [...rootCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!consensus || consensus[1] < policy.minimumProviders) throw new Error("Providers do not agree on a UTxO set");
  const agreeing = normalized.filter((snapshot) => snapshot.utxoRoot === consensus[0]);
  const root = createHash("sha256").update([addresses.values().next().value ?? "", consensus[0], ...agreeing.map((s) => `${s.providerId}:${s.providerGroup}:${s.tipSlot}`).sort()].join("|")).digest("hex");
  return { root, utxoRoot: consensus[0], providerCount: agreeing.length, independentGroups: new Set(agreeing.map((s) => s.providerGroup)).size, tipSkewSlots: tipSkew, address: agreeing[0].address };
}

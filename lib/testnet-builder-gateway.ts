import { createHash } from "node:crypto";
import { validateTestnetTransactionPlan, type TestnetTransactionPlan } from "./testnet-transaction-plan";

export type TestnetBuilderConfig = {
  endpoint: string;
  builderId: string;
  timeoutMs: number;
  expectedNetworkMagic: 1;
};

export type TestnetBuilderResponse = {
  builderId: string;
  planDigest: string;
  network: "preprod";
  networkMagic: 1;
  unsignedTxCborHex: string;
  txBodyHash: string;
  evaluated: boolean;
  exUnitsDigest?: string;
  builtAt: string;
};

function hex(v: string, label: string) {
  if (!/^[0-9a-f]+$/i.test(v) || v.length % 2 !== 0) throw new Error(`${label} must be non-empty even-length hex`);
  return v.toLowerCase();
}
function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be 64 hex`); return v.toLowerCase(); }

export function validateTestnetBuilderConfig(config: TestnetBuilderConfig) {
  let endpoint: URL;
  try { endpoint = new URL(config.endpoint); } catch { throw new Error("Transaction builder endpoint must be a valid URL"); }
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") throw new Error("Transaction builder endpoint must use HTTPS outside local development");
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(config.builderId)) throw new Error("Invalid transaction builder id");
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 120_000) throw new Error("Builder timeout must be between 1s and 120s");
  if (config.expectedNetworkMagic !== 1) throw new Error("Finalized testnet builder must target Preprod magic 1");
  return config;
}

export function validateTestnetBuilderResponse(response: TestnetBuilderResponse, expectedPlanDigest: string, config: TestnetBuilderConfig, nowMs = Date.now()) {
  validateTestnetBuilderConfig(config);
  if (response.builderId !== config.builderId) throw new Error("Builder response identity mismatch");
  if (response.network !== "preprod" || response.networkMagic !== 1) throw new Error("Builder response is not Cardano Preprod");
  const planDigest = d64(response.planDigest, "Builder plan digest");
  if (planDigest !== d64(expectedPlanDigest, "Expected plan digest")) throw new Error("Builder response is bound to a different transaction plan");
  const unsignedTxCborHex = hex(response.unsignedTxCborHex, "Unsigned transaction CBOR");
  const txBodyHash = d64(response.txBodyHash, "Transaction body hash");
  const builtAt = new Date(response.builtAt).getTime();
  if (!Number.isFinite(builtAt) || builtAt > nowMs + 60_000 || nowMs - builtAt > 300_000) throw new Error("Builder response is stale or future-dated");
  if (!response.evaluated) throw new Error("Plutus transaction must be evaluated before wallet signing");
  const exUnitsDigest = response.exUnitsDigest ? d64(response.exUnitsDigest, "Execution units digest") : undefined;
  const receiptDigest = createHash("sha256").update([config.builderId, planDigest, txBodyHash, createHash("sha256").update(unsignedTxCborHex).digest("hex"), exUnitsDigest ?? "", new Date(builtAt).toISOString()].join("|")).digest("hex");
  return { ...response, planDigest, unsignedTxCborHex, txBodyHash, exUnitsDigest, receiptDigest };
}

export async function buildPreprodTransaction(input: {
  plan: TestnetTransactionPlan;
  config: TestnetBuilderConfig;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const validatedPlan = validateTestnetTransactionPlan(input.plan, nowMs);
  const config = validateTestnetBuilderConfig(input.config);
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-symbiotic-network": "preprod", "x-symbiotic-network-magic": "1" },
      body: JSON.stringify({ protocol: "symbiotic-cardano", version: "v11", plan: validatedPlan }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Transaction builder failed with HTTP ${response.status}`);
    const body = await response.json() as TestnetBuilderResponse;
    return validateTestnetBuilderResponse(body, validatedPlan.digest, config, nowMs);
  } finally {
    clearTimeout(timer);
  }
}

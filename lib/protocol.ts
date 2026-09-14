import type { OptionKind } from "./options";
import type { PerpOrder, PerpSide } from "./perps";

export type OracleSample = {
  price: number;
  timestampMs: number;
  confidenceBps?: number;
};

export type OracleGuardConfig = {
  maxAgeMs: number;
  maxDeviationBps: number;
  maxConfidenceBps: number;
};

export const DEFAULT_ORACLE_GUARD: OracleGuardConfig = {
  maxAgeMs: 30_000,
  maxDeviationBps: 150,
  maxConfidenceBps: 100
};

export function validateOracleSample(input: {
  primary: OracleSample;
  reference?: OracleSample;
  nowMs?: number;
  guard?: OracleGuardConfig;
}) {
  const guard = input.guard ?? DEFAULT_ORACLE_GUARD;
  const now = input.nowMs ?? Date.now();
  const primary = input.primary;
  if (!Number.isFinite(primary.price) || primary.price <= 0) throw new Error("Oracle price is invalid");
  if (!Number.isFinite(primary.timestampMs) || primary.timestampMs > now + 5_000) throw new Error("Oracle timestamp is invalid");
  if (now - primary.timestampMs > guard.maxAgeMs) throw new Error("Oracle price is stale");
  if ((primary.confidenceBps ?? 0) > guard.maxConfidenceBps) throw new Error("Oracle confidence interval is too wide");

  if (input.reference) {
    if (!Number.isFinite(input.reference.price) || input.reference.price <= 0) throw new Error("Reference oracle price is invalid");
    const deviationBps = Math.abs(primary.price - input.reference.price) / input.reference.price * 10_000;
    if (deviationBps > guard.maxDeviationBps) throw new Error("Oracle deviation exceeds protocol guardrail");
  }
  return primary.price;
}

export type ProtocolIntent<TPayload> = {
  version: 1;
  network: string;
  account: string;
  action: string;
  createdAt: string;
  expiresAt: string;
  payload: TPayload;
};

function futureIso(seconds: number, nowMs = Date.now()) {
  return new Date(nowMs + seconds * 1000).toISOString();
}

function validateEnvelope(input: { network: string; account: string; ttlSeconds: number }) {
  if (!input.network.trim()) throw new Error("Network is required");
  if (!input.account.trim()) throw new Error("Account is required");
  if (!Number.isFinite(input.ttlSeconds) || input.ttlSeconds < 10 || input.ttlSeconds > 3600) throw new Error("TTL must be between 10 and 3600 seconds");
}

export function buildPerpOrderIntent(input: {
  network: string;
  account: string;
  order: PerpOrder;
  ttlSeconds?: number;
  nowMs?: number;
}): ProtocolIntent<PerpOrder> {
  const ttlSeconds = input.ttlSeconds ?? 120;
  const nowMs = input.nowMs ?? Date.now();
  validateEnvelope({ network: input.network, account: input.account, ttlSeconds });
  return {
    version: 1,
    network: input.network.trim(),
    account: input.account.trim(),
    action: "PERP_ORDER",
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: futureIso(ttlSeconds, nowMs),
    payload: input.order
  };
}

export type OptionOrderPayload = {
  underlying: string;
  kind: OptionKind;
  side: "BUY" | "WRITE";
  strike: number;
  expiry: string;
  contracts: number;
  maxPremiumUsd?: number;
};

export function buildOptionOrderIntent(input: {
  network: string;
  account: string;
  order: OptionOrderPayload;
  ttlSeconds?: number;
  nowMs?: number;
}): ProtocolIntent<OptionOrderPayload> {
  const ttlSeconds = input.ttlSeconds ?? 120;
  const nowMs = input.nowMs ?? Date.now();
  validateEnvelope({ network: input.network, account: input.account, ttlSeconds });
  if (!input.order.underlying.trim()) throw new Error("Underlying is required");
  if (!Number.isFinite(input.order.strike) || input.order.strike <= 0) throw new Error("Invalid strike");
  if (!Number.isFinite(input.order.contracts) || input.order.contracts <= 0) throw new Error("Invalid contracts");
  if (!Number.isFinite(new Date(input.order.expiry).getTime())) throw new Error("Invalid expiry");
  return {
    version: 1,
    network: input.network.trim(),
    account: input.account.trim(),
    action: "OPTION_ORDER",
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: futureIso(ttlSeconds, nowMs),
    payload: input.order
  };
}

export function isIntentExpired(intent: ProtocolIntent<unknown>, nowMs = Date.now()) {
  return new Date(intent.expiresAt).getTime() <= nowMs;
}

export type SymbioticCapability = {
  id: string;
  status: "IMPLEMENTED" | "FOUNDATION" | "CONFIG_REQUIRED" | "PENDING_ONCHAIN";
  boundary: string;
};

export const SYMBIOTIC_CAPABILITIES: SymbioticCapability[] = [
  { id: "perpetual-risk-engine", status: "IMPLEMENTED", boundary: "Deterministic TypeScript risk calculations; authoritative settlement still belongs on-chain." },
  { id: "advanced-orders", status: "IMPLEMENTED", boundary: "Validation and trigger rules are implemented." },
  { id: "options-settlement", status: "IMPLEMENTED", boundary: "Expiry-only settlement authorization uses fresh oracle quorum pricing and one-time settlement IDs." },
  { id: "notional-pretrade", status: "FOUNDATION", boundary: "Commit/reveal and replay controls exist; encrypted matcher transport and private L1 settlement remain separate work." },
  { id: "oracle-quorum", status: "IMPLEMENTED", boundary: "Multiple independent sources are filtered for freshness, confidence and divergence before settlement use." },
  { id: "cip30-execution", status: "IMPLEMENTED", boundary: "Wallet signs backend-prepared CBOR, a trusted assembler merges witnesses, then the wallet submits." },
  { id: "chain-indexer", status: "IMPLEMENTED", boundary: "Deterministic transaction/event reduction and confirmation interfaces exist; a live provider endpoint must be configured." },
  { id: "liquidation-keepers", status: "IMPLEMENTED", boundary: "Keeper jobs require an unsafe position, fresh oracle quorum, bounded partial liquidation and replay-safe job IDs." },
  { id: "validator-transition-mirror", status: "FOUNDATION", boundary: "Off-chain transition invariants mirror the intended Cardano validator rules; compiled/deployed Aiken validators are still required." },
  { id: "cardano-testnet-readiness", status: "CONFIG_REQUIRED", boundary: "Readiness stays false until provider, indexer, builder, oracle quorum and required validator deployments are configured." },
  { id: "cardano-validator-deployment", status: "PENDING_ONCHAIN", boundary: "Collateral, perpetual and options validators must be compiled, audited and deployed before live value can settle." }
];

/** @deprecated Use SYMBIOTIC_CAPABILITIES. */
export const NEMESIS_CAPABILITIES = SYMBIOTIC_CAPABILITIES;

export function normalizeSide(side: PerpSide) {
  return side === "LONG" ? 1 : -1;
}

import { createHash } from "node:crypto";

export type ProductStateLeaf = {
  product: "COLLATERAL" | "PERPETUAL" | "OPTIONS" | "NOTIONAL";
  stateId: string;
  utxoRef: string;
  ownerOrMarket: string;
  nonce: number;
  valueDigest: string;
};

export type ProtocolAccountingSnapshot = {
  custodyUnits: string;
  insuranceUnits: string;
  userEquityLiabilityUnits: string;
  pendingWithdrawalUnits: string;
  badDebtUnits: string;
  lockedPerpMarginUnits: string;
  lockedOptionCollateralUnits: string;
  optionPayoutLiabilityUnits: string;
  notionalEscrowUnits: string;
};

export type ProtocolStateCheckpoint = {
  deploymentEpoch: number;
  registryNonce: number;
  oracleRound: number;
  fundingRound: number;
  leaves: ProductStateLeaf[];
  accounting: ProtocolAccountingSnapshot;
  generatedAt: string;
};

function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function parseUnits(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(value);
}

function canonicalLeaf(leaf: ProductStateLeaf) {
  if (!/^[A-Z0-9:_-]{4,128}$/i.test(leaf.stateId)) throw new Error("Invalid protocol state id");
  if (!/^[0-9a-f]{64}#[0-9]{1,5}$/i.test(leaf.utxoRef)) throw new Error("Invalid protocol state UTxO reference");
  if (!leaf.ownerOrMarket.trim()) throw new Error("Protocol state owner/market is required");
  if (!Number.isInteger(leaf.nonce) || leaf.nonce < 0) throw new Error("Invalid protocol state nonce");
  digest64(leaf.valueDigest, "Protocol state value");
  return [leaf.product, leaf.stateId, leaf.utxoRef.toLowerCase(), leaf.ownerOrMarket, leaf.nonce, leaf.valueDigest.toLowerCase()].join(":");
}

export function buildProtocolStateRoot(checkpoint: ProtocolStateCheckpoint) {
  if (!Number.isInteger(checkpoint.deploymentEpoch) || checkpoint.deploymentEpoch < 1) throw new Error("Invalid checkpoint deployment epoch");
  if (!Number.isInteger(checkpoint.registryNonce) || checkpoint.registryNonce < 0) throw new Error("Invalid checkpoint registry nonce");
  if (!Number.isInteger(checkpoint.oracleRound) || checkpoint.oracleRound < 0) throw new Error("Invalid checkpoint oracle round");
  if (!Number.isInteger(checkpoint.fundingRound) || checkpoint.fundingRound < 0) throw new Error("Invalid checkpoint funding round");
  const generatedAt = new Date(checkpoint.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) throw new Error("Invalid checkpoint timestamp");
  if (!checkpoint.leaves.length) throw new Error("Protocol checkpoint requires state leaves");

  const stateIds = checkpoint.leaves.map((leaf) => leaf.stateId);
  const refs = checkpoint.leaves.map((leaf) => leaf.utxoRef.toLowerCase());
  if (new Set(stateIds).size !== stateIds.length) throw new Error("Protocol checkpoint contains duplicate state ids");
  if (new Set(refs).size !== refs.length) throw new Error("Protocol checkpoint double-counts a UTxO");

  const accountingEntries = Object.entries(checkpoint.accounting).map(([label, value]) => [label, parseUnits(value, label)] as const);
  const custody = parseUnits(checkpoint.accounting.custodyUnits, "custodyUnits");
  const insurance = parseUnits(checkpoint.accounting.insuranceUnits, "insuranceUnits");
  const liabilities =
    parseUnits(checkpoint.accounting.userEquityLiabilityUnits, "userEquityLiabilityUnits") +
    parseUnits(checkpoint.accounting.pendingWithdrawalUnits, "pendingWithdrawalUnits") +
    parseUnits(checkpoint.accounting.badDebtUnits, "badDebtUnits") +
    parseUnits(checkpoint.accounting.optionPayoutLiabilityUnits, "optionPayoutLiabilityUnits") +
    parseUnits(checkpoint.accounting.notionalEscrowUnits, "notionalEscrowUnits");
  if (custody + insurance < liabilities) throw new Error("Checkpoint accounting is insolvent");

  const canonicalLeaves = checkpoint.leaves.map(canonicalLeaf).sort();
  const canonicalAccounting = accountingEntries
    .map(([label, value]) => `${label}:${value.toString()}`)
    .sort();
  const canonical = [
    checkpoint.deploymentEpoch,
    checkpoint.registryNonce,
    checkpoint.oracleRound,
    checkpoint.fundingRound,
    ...canonicalLeaves,
    ...canonicalAccounting,
    new Date(generatedAt).toISOString()
  ].join("|");

  return {
    root: createHash("sha256").update(canonical).digest("hex"),
    leafCount: canonicalLeaves.length,
    custodyUnits: custody,
    insuranceUnits: insurance,
    liabilitiesUnits: liabilities,
    solvent: custody + insurance >= liabilities
  };
}

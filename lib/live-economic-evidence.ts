import { createHash } from "node:crypto";
import type { CardanoNetwork } from "./cardano-execution";
import {
  validateCardanoConfirmation,
  type CardanoConfirmationProof,
  type ConfirmationPolicy
} from "./chain-confirmation-v2";
import { assertFundingTransferConservation } from "./funding-rounds";

export type LiveFundingExecutionEvidence = {
  market: string;
  roundId: number;
  fundingRoundDigest: string;
  oracleRoundDigest: string;
  payerSide: "LONG" | "SHORT";
  payerUnits: string;
  receiverUnits: string;
  protocolResidualUnits: string;
  confirmation: CardanoConfirmationProof;
};

export type LiveOptionSettlementEvidence = {
  seriesId: string;
  settlementPrice: number;
  oracleRoundDigest: string;
  payoutProofDigest: string;
  lockedCollateralUnits: string;
  buyerPayoutUnits: string;
  writerResidualUnits: string;
  protocolFeeUnits: string;
  confirmation: CardanoConfirmationProof;
};

export type LiveNotionalSettlementEvidence = {
  market: string;
  side: "BUY" | "SELL";
  intentCommitment: string;
  auctionTranscriptDigest: string;
  winnerQuoteDigest: string;
  executionPrice: number;
  userLimitPrice: number;
  solverFeeBps: number;
  competitorCount: number;
  confirmation: CardanoConfirmationProof;
};

export type LiveEconomicEvidenceBundle = {
  network: CardanoNetwork;
  generatedAt: string;
  funding: LiveFundingExecutionEvidence;
  optionSettlement: LiveOptionSettlementEvidence;
  notionalSettlement: LiveNotionalSettlementEvidence;
};

function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function unsignedUnits(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an unsigned integer string`);
  return BigInt(value);
}

function validId(value: string, label: string) {
  if (!/^[a-zA-Z0-9:._/-]{2,128}$/.test(value)) throw new Error(`Invalid ${label}`);
}

function validateFunding(evidence: LiveFundingExecutionEvidence, policy: ConfirmationPolicy, nowMs: number) {
  if (!/^[A-Z0-9._/-]{2,32}$/.test(evidence.market)) throw new Error("Invalid live funding market");
  if (!Number.isInteger(evidence.roundId) || evidence.roundId < 1) throw new Error("Invalid live funding round id");
  digest64(evidence.fundingRoundDigest, "Funding round digest");
  digest64(evidence.oracleRoundDigest, "Funding oracle round digest");
  const payerUnits = unsignedUnits(evidence.payerUnits, "Funding payer units");
  const receiverUnits = unsignedUnits(evidence.receiverUnits, "Funding receiver units");
  const protocolResidualUnits = unsignedUnits(evidence.protocolResidualUnits, "Funding protocol residual units");
  assertFundingTransferConservation({ payerUnits, receiverUnits, protocolResidualUnits, maxRoundingUnits: 1n });
  const confirmation = validateCardanoConfirmation(evidence.confirmation, policy, nowMs);
  return { ...evidence, payerUnits, receiverUnits, protocolResidualUnits, confirmation };
}

function validateOptionSettlement(evidence: LiveOptionSettlementEvidence, policy: ConfirmationPolicy, nowMs: number) {
  validId(evidence.seriesId, "option series id");
  if (!Number.isFinite(evidence.settlementPrice) || evidence.settlementPrice <= 0) throw new Error("Invalid live option settlement price");
  digest64(evidence.oracleRoundDigest, "Option oracle round digest");
  digest64(evidence.payoutProofDigest, "Option payout proof digest");
  const locked = unsignedUnits(evidence.lockedCollateralUnits, "Locked option collateral units");
  const buyer = unsignedUnits(evidence.buyerPayoutUnits, "Option buyer payout units");
  const writer = unsignedUnits(evidence.writerResidualUnits, "Option writer residual units");
  const fee = unsignedUnits(evidence.protocolFeeUnits, "Option protocol fee units");
  if (buyer + writer + fee !== locked) throw new Error("Live option settlement does not conserve locked collateral");
  const confirmation = validateCardanoConfirmation(evidence.confirmation, policy, nowMs);
  return { ...evidence, locked, buyer, writer, fee, confirmation };
}

function validateNotionalSettlement(evidence: LiveNotionalSettlementEvidence, policy: ConfirmationPolicy, nowMs: number) {
  if (!/^[A-Z0-9._/-]{2,32}$/.test(evidence.market)) throw new Error("Invalid live Notional market");
  digest64(evidence.intentCommitment, "Notional intent commitment");
  digest64(evidence.auctionTranscriptDigest, "Notional auction transcript digest");
  digest64(evidence.winnerQuoteDigest, "Notional winner quote digest");
  if (!Number.isFinite(evidence.executionPrice) || evidence.executionPrice <= 0) throw new Error("Invalid Notional execution price");
  if (!Number.isFinite(evidence.userLimitPrice) || evidence.userLimitPrice <= 0) throw new Error("Invalid Notional limit price");
  if (evidence.side === "BUY" && evidence.executionPrice > evidence.userLimitPrice) throw new Error("Notional BUY execution breached user limit");
  if (evidence.side === "SELL" && evidence.executionPrice < evidence.userLimitPrice) throw new Error("Notional SELL execution breached user limit");
  if (!Number.isInteger(evidence.solverFeeBps) || evidence.solverFeeBps < 0 || evidence.solverFeeBps > 100) throw new Error("Notional solver fee exceeds live settlement policy");
  if (!Number.isInteger(evidence.competitorCount) || evidence.competitorCount < 2) throw new Error("Notional live settlement requires at least two competing solvers");
  const confirmation = validateCardanoConfirmation(evidence.confirmation, policy, nowMs);
  return { ...evidence, confirmation };
}

export function validateLiveEconomicEvidenceBundle(input: {
  bundle: LiveEconomicEvidenceBundle;
  policy: Omit<ConfirmationPolicy, "expectedNetwork">;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const generatedAt = new Date(input.bundle.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) throw new Error("Invalid live economic evidence timestamp");
  if (generatedAt > nowMs + 60_000) throw new Error("Live economic evidence is future-dated");
  if (nowMs - generatedAt > 60 * 60 * 1000) throw new Error("Live economic evidence bundle is stale");

  const policy: ConfirmationPolicy = { ...input.policy, expectedNetwork: input.bundle.network };
  const funding = validateFunding(input.bundle.funding, policy, nowMs);
  const optionSettlement = validateOptionSettlement(input.bundle.optionSettlement, policy, nowMs);
  const notionalSettlement = validateNotionalSettlement(input.bundle.notionalSettlement, policy, nowMs);

  const confirmations = [funding.confirmation, optionSettlement.confirmation, notionalSettlement.confirmation];
  if (confirmations.some((confirmation) => input.bundle.network !== policy.expectedNetwork)) {
    throw new Error("Live economic evidence network mismatch");
  }
  const txHashes = confirmations.map((confirmation) => confirmation.txHash);
  if (new Set(txHashes).size !== txHashes.length) throw new Error("Live economic evidence must use distinct settlement transactions");
  if (funding.fundingRoundDigest.toLowerCase() === funding.oracleRoundDigest.toLowerCase()) {
    throw new Error("Funding and oracle evidence digests must be independent");
  }
  if (optionSettlement.payoutProofDigest.toLowerCase() === optionSettlement.oracleRoundDigest.toLowerCase()) {
    throw new Error("Option payout and oracle evidence digests must be independent");
  }

  const digest = createHash("sha256").update([
    input.bundle.network,
    funding.market,
    funding.roundId,
    funding.fundingRoundDigest.toLowerCase(),
    funding.confirmation.txHash,
    optionSettlement.seriesId,
    optionSettlement.payoutProofDigest.toLowerCase(),
    optionSettlement.confirmation.txHash,
    notionalSettlement.intentCommitment.toLowerCase(),
    notionalSettlement.auctionTranscriptDigest.toLowerCase(),
    notionalSettlement.confirmation.txHash
  ].join("|")).digest("hex");

  return {
    verified: true,
    network: input.bundle.network,
    digest,
    generatedAt: new Date(generatedAt).toISOString(),
    transactions: txHashes
  };
}

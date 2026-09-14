import { createHash } from "node:crypto";

export type OptionKind = "CALL" | "PUT";

export type OptionSettlementProof = {
  seriesId: string;
  kind: OptionKind;
  strike: number;
  settlementPrice: number;
  contracts: number;
  contractMultiplierUnits: bigint;
  collateralUnits: bigint;
  intrinsicUnits: bigint;
  grossPayoutUnits: bigint;
  protocolFeeUnits: bigint;
  buyerPayoutUnits: bigint;
  writerResidualUnits: bigint;
  digest: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildOptionSettlementProof(input: {
  seriesId: string;
  kind: OptionKind;
  strike: number;
  settlementPrice: number;
  contracts: number;
  contractMultiplierUnits: bigint;
  collateralUnits: bigint;
  protocolFeeBps?: number;
}): OptionSettlementProof {
  if (!/^[a-zA-Z0-9:_./-]{4,128}$/.test(input.seriesId)) throw new Error("Invalid option series id");
  if (!Number.isFinite(input.strike) || input.strike <= 0) throw new Error("Invalid option strike");
  if (!Number.isFinite(input.settlementPrice) || input.settlementPrice <= 0) throw new Error("Invalid option settlement price");
  if (!Number.isInteger(input.contracts) || input.contracts <= 0) throw new Error("Invalid option contract count");
  if (input.contractMultiplierUnits <= 0n || input.collateralUnits < 0n) throw new Error("Invalid option settlement units");
  const feeBps = input.protocolFeeBps ?? 0;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1_000) throw new Error("Invalid option settlement fee");

  const intrinsicPrice = input.kind === "CALL"
    ? Math.max(0, input.settlementPrice - input.strike)
    : Math.max(0, input.strike - input.settlementPrice);
  const intrinsicScaled = BigInt(Math.round(intrinsicPrice * 1_000_000));
  const intrinsicUnits = intrinsicScaled * input.contractMultiplierUnits / 1_000_000n;
  const grossPayoutUnits = intrinsicUnits * BigInt(input.contracts);
  if (grossPayoutUnits > input.collateralUnits) throw new Error("Option payout exceeds locked collateral");
  const protocolFeeUnits = grossPayoutUnits * BigInt(feeBps) / 10_000n;
  const buyerPayoutUnits = grossPayoutUnits - protocolFeeUnits;
  const writerResidualUnits = input.collateralUnits - grossPayoutUnits;

  const digest = sha256([
    input.seriesId,
    input.kind,
    input.strike.toFixed(8),
    input.settlementPrice.toFixed(8),
    input.contracts,
    input.contractMultiplierUnits.toString(),
    input.collateralUnits.toString(),
    grossPayoutUnits.toString(),
    protocolFeeUnits.toString(),
    buyerPayoutUnits.toString(),
    writerResidualUnits.toString()
  ].join("|"));

  return {
    seriesId: input.seriesId,
    kind: input.kind,
    strike: input.strike,
    settlementPrice: input.settlementPrice,
    contracts: input.contracts,
    contractMultiplierUnits: input.contractMultiplierUnits,
    collateralUnits: input.collateralUnits,
    intrinsicUnits,
    grossPayoutUnits,
    protocolFeeUnits,
    buyerPayoutUnits,
    writerResidualUnits,
    digest
  };
}

export function assertOptionSettlementConservation(input: {
  proof: OptionSettlementProof;
  actualBuyerUnits: bigint;
  actualWriterUnits: bigint;
  actualProtocolFeeUnits: bigint;
}) {
  if (input.actualBuyerUnits < 0n || input.actualWriterUnits < 0n || input.actualProtocolFeeUnits < 0n) {
    throw new Error("Option settlement outputs cannot be negative");
  }
  if (input.actualBuyerUnits !== input.proof.buyerPayoutUnits) throw new Error("Buyer payout does not match settlement proof");
  if (input.actualWriterUnits !== input.proof.writerResidualUnits) throw new Error("Writer residual does not match settlement proof");
  if (input.actualProtocolFeeUnits !== input.proof.protocolFeeUnits) throw new Error("Protocol fee does not match settlement proof");
  const outputs = input.actualBuyerUnits + input.actualWriterUnits + input.actualProtocolFeeUnits;
  if (outputs !== input.proof.collateralUnits) throw new Error("Options settlement does not conserve collateral");
  return true;
}

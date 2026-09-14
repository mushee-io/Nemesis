import { createHash } from "node:crypto";

export type NotionalSide = "BUY" | "SELL";

export type SolverQuoteCommitment = {
  auctionId: string;
  solverId: string;
  commitment: string;
  submittedAtMs: number;
};

export type SolverQuoteReveal = {
  auctionId: string;
  solverId: string;
  price: number;
  feeBps: number;
  expiresAtMs: number;
  salt: string;
};

export type NotionalAuctionPolicy = {
  minimumSolverCount: number;
  maximumFeeBps: number;
  maximumQuoteAgeMs: number;
};

export const DEFAULT_NOTIONAL_AUCTION_POLICY: NotionalAuctionPolicy = {
  minimumSolverCount: 2,
  maximumFeeBps: 50,
  maximumQuoteAgeMs: 30_000
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validateId(value: string, label: string) {
  if (!/^[a-zA-Z0-9:_-]{3,128}$/.test(value)) throw new Error(`Invalid ${label}`);
}

export function solverQuotePreimage(reveal: SolverQuoteReveal) {
  validateId(reveal.auctionId, "auction id");
  validateId(reveal.solverId, "solver id");
  if (!Number.isFinite(reveal.price) || reveal.price <= 0) throw new Error("Invalid solver quote price");
  if (!Number.isInteger(reveal.feeBps) || reveal.feeBps < 0 || reveal.feeBps > 10_000) throw new Error("Invalid solver quote fee");
  if (!Number.isInteger(reveal.expiresAtMs) || reveal.expiresAtMs <= 0) throw new Error("Invalid solver quote expiry");
  if (!/^[0-9a-f]{32,128}$/i.test(reveal.salt)) throw new Error("Invalid solver quote salt");
  return [
    reveal.auctionId,
    reveal.solverId,
    reveal.price.toFixed(8),
    reveal.feeBps,
    reveal.expiresAtMs,
    reveal.salt.toLowerCase()
  ].join("|");
}

export function createSolverQuoteCommitment(reveal: SolverQuoteReveal, submittedAtMs: number): SolverQuoteCommitment {
  if (!Number.isInteger(submittedAtMs) || submittedAtMs <= 0 || submittedAtMs >= reveal.expiresAtMs) {
    throw new Error("Invalid solver quote submission time");
  }
  return {
    auctionId: reveal.auctionId,
    solverId: reveal.solverId,
    commitment: sha256(solverQuotePreimage(reveal)),
    submittedAtMs
  };
}

export function settleNotionalAuction(input: {
  auctionId: string;
  side: NotionalSide;
  limitPrice: number;
  commitments: SolverQuoteCommitment[];
  reveals: SolverQuoteReveal[];
  nowMs: number;
  policy?: NotionalAuctionPolicy;
}) {
  const policy = input.policy ?? DEFAULT_NOTIONAL_AUCTION_POLICY;
  validateId(input.auctionId, "auction id");
  if (!Number.isFinite(input.limitPrice) || input.limitPrice <= 0) throw new Error("Invalid Notional limit price");
  if (!Number.isInteger(input.nowMs) || input.nowMs <= 0) throw new Error("Invalid Notional auction time");
  if (!Number.isInteger(policy.minimumSolverCount) || policy.minimumSolverCount < 2) throw new Error("Notional auction requires at least two solvers");
  if (!Number.isInteger(policy.maximumFeeBps) || policy.maximumFeeBps < 0 || policy.maximumFeeBps > 1_000) throw new Error("Invalid Notional fee policy");
  if (!Number.isInteger(policy.maximumQuoteAgeMs) || policy.maximumQuoteAgeMs <= 0) throw new Error("Invalid Notional quote age policy");

  const commitmentMap = new Map<string, SolverQuoteCommitment>();
  for (const commitment of input.commitments) {
    if (commitment.auctionId !== input.auctionId) throw new Error("Solver commitment auction mismatch");
    validateId(commitment.solverId, "solver id");
    if (!/^[0-9a-f]{64}$/i.test(commitment.commitment)) throw new Error("Invalid solver commitment digest");
    if (commitmentMap.has(commitment.solverId)) throw new Error("Duplicate solver commitment");
    commitmentMap.set(commitment.solverId, commitment);
  }

  const seenReveals = new Set<string>();
  const eligible = input.reveals.map((reveal) => {
    if (reveal.auctionId !== input.auctionId) throw new Error("Solver reveal auction mismatch");
    if (seenReveals.has(reveal.solverId)) throw new Error("Duplicate solver reveal");
    seenReveals.add(reveal.solverId);
    const commitment = commitmentMap.get(reveal.solverId);
    if (!commitment) throw new Error("Solver reveal has no prior commitment");
    const expected = sha256(solverQuotePreimage(reveal));
    if (expected !== commitment.commitment.toLowerCase()) throw new Error("Solver quote commitment mismatch");
    if (reveal.feeBps > policy.maximumFeeBps) throw new Error("Solver quote fee exceeds policy");
    if (input.nowMs > reveal.expiresAtMs) throw new Error("Solver quote expired");
    if (input.nowMs - commitment.submittedAtMs > policy.maximumQuoteAgeMs) throw new Error("Solver quote is stale");
    const effectivePrice = input.side === "BUY"
      ? reveal.price * (1 + reveal.feeBps / 10_000)
      : reveal.price * (1 - reveal.feeBps / 10_000);
    const withinLimit = input.side === "BUY" ? effectivePrice <= input.limitPrice : effectivePrice >= input.limitPrice;
    return { reveal, commitment, effectivePrice, withinLimit };
  }).filter((quote) => quote.withinLimit);

  const uniqueEligibleSolvers = new Set(eligible.map((quote) => quote.reveal.solverId));
  if (uniqueEligibleSolvers.size < policy.minimumSolverCount) throw new Error("Insufficient eligible solver competition");

  eligible.sort((a, b) => {
    if (a.effectivePrice !== b.effectivePrice) {
      return input.side === "BUY" ? a.effectivePrice - b.effectivePrice : b.effectivePrice - a.effectivePrice;
    }
    return a.commitment.commitment.localeCompare(b.commitment.commitment);
  });

  const winner = eligible[0];
  const transcript = eligible.map((quote) => [
    quote.reveal.solverId,
    quote.commitment.commitment,
    quote.reveal.price.toFixed(8),
    quote.reveal.feeBps,
    quote.effectivePrice.toFixed(8)
  ].join(":"));
  const transcriptDigest = sha256([input.auctionId, input.side, input.limitPrice.toFixed(8), ...transcript].join("|"));

  return {
    winnerSolverId: winner.reveal.solverId,
    executionPrice: winner.reveal.price,
    feeBps: winner.reveal.feeBps,
    effectivePrice: winner.effectivePrice,
    eligibleSolverCount: eligible.length,
    transcriptDigest
  };
}

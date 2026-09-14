import { createHash } from "node:crypto";
import type { CardanoNetwork } from "./cardano-execution";
import { assessFinality, type FinalityPolicy } from "./chain-finality";
import type { CardanoConfirmationProof } from "./chain-confirmation-v2";

export type OracleFundingAnchor = {
  network: CardanoNetwork;
  deploymentEpoch: number;
  registryStateRoot: string;
  oracleRound: number;
  oracleRoundDigest: string;
  fundingRound: number;
  fundingRoundDigest: string;
  market: string;
  indexPrice: number;
  markPrice: number;
  confirmation: CardanoConfirmationProof;
};

export type PreviousOracleFundingAnchor = Pick<
  OracleFundingAnchor,
  "deploymentEpoch" | "oracleRound" | "oracleRoundDigest" | "fundingRound" | "fundingRoundDigest" | "market"
>;

function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

export function validateOracleFundingAnchor(input: {
  anchor: OracleFundingAnchor;
  finalityPolicy: FinalityPolicy;
  previous?: PreviousOracleFundingAnchor;
  maxMarkIndexDeviationBps?: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const anchor = input.anchor;
  if (anchor.network !== input.finalityPolicy.expectedNetwork) throw new Error("Oracle/funding anchor network mismatch");
  if (!Number.isInteger(anchor.deploymentEpoch) || anchor.deploymentEpoch < 1) throw new Error("Invalid anchor deployment epoch");
  digest64(anchor.registryStateRoot, "Registry state root");
  digest64(anchor.oracleRoundDigest, "Oracle round digest");
  digest64(anchor.fundingRoundDigest, "Funding round digest");
  if (!Number.isInteger(anchor.oracleRound) || anchor.oracleRound < 1) throw new Error("Invalid anchored oracle round");
  if (!Number.isInteger(anchor.fundingRound) || anchor.fundingRound < 1) throw new Error("Invalid anchored funding round");
  if (!/^[A-Z0-9._/-]{2,32}$/.test(anchor.market)) throw new Error("Invalid anchored market");
  if (!Number.isFinite(anchor.indexPrice) || anchor.indexPrice <= 0 || !Number.isFinite(anchor.markPrice) || anchor.markPrice <= 0) {
    throw new Error("Invalid anchored prices");
  }
  const maxDeviation = input.maxMarkIndexDeviationBps ?? 750;
  if (!Number.isFinite(maxDeviation) || maxDeviation <= 0) throw new Error("Invalid anchored mark/index policy");
  const deviationBps = Math.round(Math.abs(anchor.markPrice - anchor.indexPrice) / anchor.indexPrice * 10_000);
  if (deviationBps > maxDeviation) throw new Error("Anchored mark/index deviation exceeds policy");

  if (input.previous) {
    if (input.previous.deploymentEpoch !== anchor.deploymentEpoch) throw new Error("Oracle/funding anchor changed deployment epoch without reset");
    if (input.previous.market !== anchor.market) throw new Error("Oracle/funding anchor market changed");
    if (anchor.oracleRound !== input.previous.oracleRound + 1) throw new Error("Oracle round must advance exactly once");
    if (anchor.fundingRound !== input.previous.fundingRound + 1) throw new Error("Funding round must advance exactly once");
    if (anchor.oracleRoundDigest.toLowerCase() === input.previous.oracleRoundDigest.toLowerCase()) throw new Error("Oracle round digest replay detected");
    if (anchor.fundingRoundDigest.toLowerCase() === input.previous.fundingRoundDigest.toLowerCase()) throw new Error("Funding round digest replay detected");
  }

  const finality = assessFinality(anchor.confirmation, input.finalityPolicy, nowMs);
  if (finality.status !== "STABLE") throw new Error("Oracle/funding anchor transaction is not stable");

  const digest = createHash("sha256").update([
    anchor.network,
    anchor.deploymentEpoch,
    anchor.registryStateRoot.toLowerCase(),
    anchor.market,
    anchor.oracleRound,
    anchor.oracleRoundDigest.toLowerCase(),
    anchor.fundingRound,
    anchor.fundingRoundDigest.toLowerCase(),
    anchor.indexPrice.toFixed(8),
    anchor.markPrice.toFixed(8),
    finality.digest
  ].join("|")).digest("hex");

  return { verified: true, digest, deviationBps, finality };
}

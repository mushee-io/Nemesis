import { createHash } from "node:crypto";
import { validateDeploymentEpoch, type DeploymentEpochState } from "./deployment-epoch";
import { buildProtocolStateRoot, type ProtocolStateCheckpoint } from "./protocol-state-root";
import { reconcileCrossProductLedger, type AccountProductExposure, type ProductLedgerTotals } from "./cross-product-reconciliation";
import { validateOracleFundingAnchor, type OracleFundingAnchor } from "./oracle-funding-anchor";
import { assessFinality, type FinalityPolicy } from "./chain-finality";
import { validateReleaseLifecycleTransition, releaseLifecycleDigest, type ReleaseLifecycleState } from "./release-lifecycle";
import type { CardanoConfirmationProof } from "./chain-confirmation-v2";

export type DeepPreprodReleaseBundle = {
  epoch: DeploymentEpochState;
  previousEpoch?: DeploymentEpochState;
  registryCheckpoint: ProtocolStateCheckpoint;
  crossProductAccounts: AccountProductExposure[];
  crossProductTotals: ProductLedgerTotals;
  oracleFundingAnchor: OracleFundingAnchor;
  criticalConfirmations: CardanoConfirmationProof[];
  lifecycle: ReleaseLifecycleState;
  previousLifecycle: ReleaseLifecycleState;
};

export function verifyDeepPreprodRelease(input: {
  bundle: DeepPreprodReleaseBundle;
  finalityPolicy: FinalityPolicy;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const bundle = input.bundle;
  if (input.finalityPolicy.expectedNetwork !== "preprod") throw new Error("Deep release verifier requires Cardano Preprod finality policy");

  const epoch = validateDeploymentEpoch({ current: bundle.epoch, previous: bundle.previousEpoch, expectedNetwork: "preprod", nowMs });
  const checkpoint = buildProtocolStateRoot(bundle.registryCheckpoint);
  if (bundle.registryCheckpoint.deploymentEpoch !== bundle.epoch.epoch) throw new Error("Registry checkpoint deployment epoch mismatch");
  if (bundle.registryCheckpoint.registryNonce < 1) throw new Error("Registry checkpoint nonce must show an on-chain transition");
  if (checkpoint.root.toLowerCase() !== bundle.oracleFundingAnchor.registryStateRoot.toLowerCase()) {
    throw new Error("Oracle/funding anchor does not reference the canonical protocol state root");
  }

  const reconciliation = reconcileCrossProductLedger({ accounts: bundle.crossProductAccounts, totals: bundle.crossProductTotals });
  if (checkpoint.custodyUnits !== reconciliation.custodyUnits) throw new Error("Checkpoint custody does not match cross-product reconciliation");
  if (checkpoint.insuranceUnits !== reconciliation.insuranceUnits) throw new Error("Checkpoint insurance does not match cross-product reconciliation");

  const oracleFunding = validateOracleFundingAnchor({
    anchor: bundle.oracleFundingAnchor,
    finalityPolicy: input.finalityPolicy,
    nowMs
  });
  if (bundle.oracleFundingAnchor.deploymentEpoch !== bundle.epoch.epoch) throw new Error("Oracle/funding anchor deployment epoch mismatch");
  if (bundle.oracleFundingAnchor.oracleRound !== bundle.registryCheckpoint.oracleRound) throw new Error("Registry/oracle round mismatch");
  if (bundle.oracleFundingAnchor.fundingRound !== bundle.registryCheckpoint.fundingRound) throw new Error("Registry/funding round mismatch");

  if (!bundle.criticalConfirmations.length) throw new Error("Deep release requires critical transaction confirmations");
  const finality = bundle.criticalConfirmations.map((proof) => assessFinality(proof, input.finalityPolicy, nowMs));
  if (finality.some((entry) => entry.status !== "STABLE")) throw new Error("Every critical release transaction must be stable");
  const txHashes = finality.map((entry) => entry.txHash);
  if (new Set(txHashes).size !== txHashes.length) throw new Error("Critical finality bundle contains duplicate transactions");
  const finalityDigest = createHash("sha256").update(finality.map((entry) => entry.digest).sort().join("|")).digest("hex");

  const lifecycle = validateReleaseLifecycleTransition({
    previous: bundle.previousLifecycle,
    next: bundle.lifecycle,
    policy: { expectedNetwork: "preprod", requireStableFinalityForLive: true },
    nowMs
  });
  if (bundle.lifecycle.phase !== "PREPROD_LIVE") throw new Error("Milestone 60 requires PREPROD_LIVE lifecycle phase");
  if (bundle.lifecycle.deploymentEpoch !== bundle.epoch.epoch) throw new Error("Lifecycle deployment epoch mismatch");
  if (bundle.lifecycle.evidence.deploymentEpochDigest?.toLowerCase() !== epoch.digest) throw new Error("Lifecycle deployment epoch evidence mismatch");
  if (bundle.lifecycle.evidence.registryStateRoot?.toLowerCase() !== checkpoint.root) throw new Error("Lifecycle registry root evidence mismatch");
  if (bundle.lifecycle.evidence.finalityEvidenceDigest?.toLowerCase() !== finalityDigest) throw new Error("Lifecycle stable finality evidence mismatch");
  if (bundle.lifecycle.evidence.oracleFundingAnchorDigest?.toLowerCase() !== oracleFunding.digest) throw new Error("Lifecycle oracle/funding evidence mismatch");
  if (bundle.lifecycle.evidence.crossProductReconciliationDigest?.toLowerCase() !== reconciliation.digest) throw new Error("Lifecycle cross-product evidence mismatch");

  const digest = createHash("sha256").update([
    epoch.digest,
    checkpoint.root,
    reconciliation.digest,
    oracleFunding.digest,
    finalityDigest,
    releaseLifecycleDigest(bundle.lifecycle)
  ].join("|")).digest("hex");

  return {
    ready: true,
    network: "preprod" as const,
    digest,
    epoch: bundle.epoch.epoch,
    stateRoot: checkpoint.root,
    finalityDigest,
    stableTransactionCount: finality.length,
    lifecycleDigest: lifecycle.digest,
    surplusUnits: reconciliation.surplusUnits
  };
}

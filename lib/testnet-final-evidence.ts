import { createHash } from "node:crypto";
import { validateCardanoTestnetProfile, type CardanoTestnetProfile } from "./cardano-testnet-profile";
import { reconcileTestnetSnapshots, type ProviderReconciliationPolicy, type TestnetChainSnapshot } from "./testnet-provider-reconciliation";
import type { WalletPreflightEvidence } from "./testnet-wallet-preflight";
import { validateTestnetDeploymentManifest, type TestnetDeploymentManifest } from "./testnet-deployment-manifest";
import { validateTestnetOperatorManifest, type TestnetOperatorManifest } from "./testnet-operator-bindings";
import { validateTestnetPerpLifecycle, type TestnetPerpLifecycle } from "./testnet-perp-lifecycle";
import { validateTestnetOptionsLifecycle, type TestnetOptionsLifecycle } from "./testnet-options-lifecycle";
import { validateTestnetNotionalLifecycle, type TestnetNotionalLifecycle } from "./testnet-notional-lifecycle";
import { validateTestnetFinality, type TestnetFinalityBundle, type TestnetFinalityPolicy } from "./testnet-finality-reconciliation";
import { reconcileTestnetIndexer, type TestnetIndexerObservation, type TestnetIndexerPolicy } from "./testnet-indexer-reconciliation";
import { validateTestnetFailureEvidence, type TestnetFailurePolicy, type TestnetFailureResult } from "./testnet-failure-evidence";
import { buildProtocolStateRoot, type ProtocolStateCheckpoint } from "./protocol-state-root";

export type FinalizedTestnetEvidenceBundle = {
  profile: CardanoTestnetProfile;
  providerSnapshots: TestnetChainSnapshot[];
  providerPolicy: ProviderReconciliationPolicy;
  walletPreflight: WalletPreflightEvidence;
  deployment: TestnetDeploymentManifest;
  operators: TestnetOperatorManifest;
  perps: TestnetPerpLifecycle;
  options: TestnetOptionsLifecycle;
  notional: TestnetNotionalLifecycle;
  finality: TestnetFinalityBundle;
  finalityPolicy: TestnetFinalityPolicy;
  checkpoint: ProtocolStateCheckpoint;
  indexers: TestnetIndexerObservation[];
  indexerPolicy: TestnetIndexerPolicy;
  failures: TestnetFailureResult[];
  failurePolicy: TestnetFailurePolicy;
  generatedAt: string;
};

function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be 64 hex`); return v.toLowerCase(); }

export function buildFinalizedTestnetEvidence(bundle: FinalizedTestnetEvidenceBundle, minimumLifecycleConfirmations: number, nowMs = Date.now()) {
  const profile = validateCardanoTestnetProfile(bundle.profile);
  const providers = reconcileTestnetSnapshots(bundle.providerSnapshots, bundle.providerPolicy, nowMs);
  if (bundle.walletPreflight.networkId !== 0) throw new Error("Wallet preflight is not bound to Cardano testnet network id 0");
  const walletDigest = d64(bundle.walletPreflight.digest, "Wallet preflight digest");
  const deployment = validateTestnetDeploymentManifest(bundle.deployment, nowMs);
  if (deployment.profileRoot !== profile.root) throw new Error("Deployment manifest is bound to a different Cardano testnet profile");
  const operators = validateTestnetOperatorManifest(bundle.operators, nowMs);
  const perps = validateTestnetPerpLifecycle(bundle.perps, minimumLifecycleConfirmations, nowMs);
  const options = validateTestnetOptionsLifecycle(bundle.options, minimumLifecycleConfirmations, nowMs);
  const notional = validateTestnetNotionalLifecycle(bundle.notional, minimumLifecycleConfirmations, nowMs);
  const lifecycleTxHashes = [...perps.receipts, ...options.receipts, ...notional.receipts].map((receipt) => receipt.txHash);
  if (new Set(lifecycleTxHashes).size !== lifecycleTxHashes.length) throw new Error("A Cardano transaction cannot satisfy multiple finalized product lifecycle receipts");
  const finality = validateTestnetFinality({ manifest: bundle.deployment, bundle: bundle.finality, policy: bundle.finalityPolicy, requiredLifecycleTxHashes: lifecycleTxHashes, nowMs });
  const checkpoint = buildProtocolStateRoot(bundle.checkpoint);
  const indexers = reconcileTestnetIndexer({ checkpoint: bundle.checkpoint, observations: bundle.indexers, policy: bundle.indexerPolicy, nowMs });
  if (indexers.stateRoot !== checkpoint.root) throw new Error("Indexer reconciliation does not reproduce the canonical testnet state root");
  const failures = validateTestnetFailureEvidence(bundle.failures, bundle.failurePolicy, nowMs);
  const generatedAt = new Date(bundle.generatedAt).getTime();
  if (!Number.isFinite(generatedAt) || generatedAt > nowMs + 60_000 || nowMs - generatedAt > 86_400_000) throw new Error("Finalized testnet evidence timestamp is invalid");
  const root = createHash("sha256").update([
    "SYMBIOTIC_CARDANO_PREPROD_FINAL",
    profile.root,
    providers.root,
    walletDigest,
    deployment.root,
    operators.root,
    perps.root,
    options.root,
    notional.root,
    finality.root,
    checkpoint.root,
    indexers.root,
    failures.root,
    new Date(generatedAt).toISOString()
  ].join("|")).digest("hex");
  return {
    root,
    profileRoot: profile.root,
    providerRoot: providers.root,
    walletRoot: walletDigest,
    deploymentRoot: deployment.root,
    operatorRoot: operators.root,
    perpRoot: perps.root,
    optionsRoot: options.root,
    notionalRoot: notional.root,
    finalityRoot: finality.root,
    stateRoot: checkpoint.root,
    indexerRoot: indexers.root,
    failureRoot: failures.root,
    lifecycleTransactionCount: lifecycleTxHashes.length,
    stable: finality.stable,
    reconciled: indexers.reconciled,
    generatedAt: new Date(generatedAt).toISOString()
  };
}

import { evaluateReleaseGate, type SecurityEvidence } from "./release-gate";
import type { SymbioticDeploymentManifest } from "./deployment";

export type V11TestnetEvidenceFlags = {
  preprodProfileVerified: boolean;
  providerReconciliationVerified: boolean;
  walletPreflightVerified: boolean;
  testnetDeploymentManifestVerified: boolean;
  builderGatewayVerified: boolean;
  perpLifecycleVerified: boolean;
  optionsLifecycleVerified: boolean;
  notionalLifecycleVerified: boolean;
  operatorBindingsVerified: boolean;
  finalityReconciliationVerified: boolean;
  indexerReconciliationVerified: boolean;
  failureSuiteVerified: boolean;
  finalizedEvidenceRootVerified: boolean;
  v11TestnetFinalizationVerified: boolean;
};

export function evaluateTestnetReleaseGateV11(input: {
  manifest: SymbioticDeploymentManifest;
  legacyEvidence: SecurityEvidence;
  v11: V11TestnetEvidenceFlags;
}) {
  if (input.manifest.network !== "preprod") throw new Error("V11 finalized testnet readiness only supports Cardano Preprod");
  const base = evaluateReleaseGate({ manifest: input.manifest, evidence: input.legacyEvidence, allowMainnet: false });
  const checks = [
    ...base.checks,
    { id: "v11-preprod-profile", ready: input.v11.preprodProfileVerified, detail: "Cardano Preprod profile must be pinned to network magic 1 and CIP-30 network id 0." },
    { id: "v11-provider-reconciliation", ready: input.v11.providerReconciliationVerified, detail: "Independent Preprod providers must reconcile one fresh UTxO view." },
    { id: "v11-wallet-preflight", ready: input.v11.walletPreflightVerified, detail: "Connected CIP-30 wallet must be on testnet and pass funding/UTxO preflight." },
    { id: "v11-deployment-manifest", ready: input.v11.testnetDeploymentManifestVerified, detail: "All five parameterized validators and reference-script UTxOs must be bound in the finalized deployment manifest." },
    { id: "v11-builder-gateway", ready: input.v11.builderGatewayVerified, detail: "Unsigned CBOR must come from an evaluated builder response bound to the exact transaction plan." },
    { id: "v11-perp-lifecycle", ready: input.v11.perpLifecycleVerified, detail: "Preprod must prove collateral deposit, funding, normal close, liquidation and withdrawal." },
    { id: "v11-options-lifecycle", ready: input.v11.optionsLifecycleVerified, detail: "Preprod must prove write, buy, settle and close with exact collateral conservation." },
    { id: "v11-notional-lifecycle", ready: input.v11.notionalLifecycleVerified, detail: "Preprod must prove competitive Notional fill plus independent cancel path within committed user limits." },
    { id: "v11-operator-bindings", ready: input.v11.operatorBindingsVerified, detail: "Preprod governor, guardian, oracle, keeper, solver and builder identities must be bound with infrastructure diversity." },
    { id: "v11-finality", ready: input.v11.finalityReconciliationVerified, detail: "Reference-script deployments and every lifecycle transaction must reach stable Preprod finality." },
    { id: "v11-indexer", ready: input.v11.indexerReconciliationVerified, detail: "Independent indexers must reproduce the canonical protocol state UTxO set." },
    { id: "v11-failure-suite", ready: input.v11.failureSuiteVerified, detail: "Stale input, validity, timeout, provider, indexer, oracle and reorg recovery scenarios must pass with no data loss." },
    { id: "v11-evidence-root", ready: input.v11.finalizedEvidenceRootVerified, detail: "The complete Cardano Preprod evidence graph must produce the Registry-bound testnet root." },
    { id: "v11-finalized", ready: input.v11.v11TestnetFinalizationVerified, detail: "The V11 object-level verifier must finalize the exact Preprod generation." }
  ];
  return { network: "preprod" as const, gate: "cardano-preprod-final-v11" as const, ready: checks.every((check) => check.ready), checks, missing: checks.filter((check) => !check.ready).map((check) => check.id) };
}

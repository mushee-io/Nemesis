import { evaluateDeploymentReadiness, type SymbioticDeploymentManifest } from "./deployment";

export type SecurityEvidence = {
  protocolTestsPassed: boolean;
  executionTestsPassed: boolean;
  hardeningTestsPassed: boolean;
  validatorArtifactsPinned: boolean;
  dependencyAuditReviewed: boolean;
  securityContactConfigured: boolean;
  emergencyRunbookConfigured: boolean;
  aikenCheckPassed: boolean;
  blueprintVerified: boolean;
  validatorDeploymentsBound: boolean;
  e2eLifecyclePassed: boolean;
  releaseProvenanceVerified: boolean;
  operatorPolicyVerified: boolean;
  incidentRecoveryConfigured: boolean;
  preprodSoakPassed: boolean;
  stateTransitionBindingPassed: boolean;
  oracleRoundIntegrityPassed: boolean;
  executionLeaseControlsPassed: boolean;
  exposureControlsPassed: boolean;
  canaryRollbackConfigured: boolean;
  canaryRollbackDrillPassed: boolean;
  solvencyConservationPassed: boolean;
  fundingIntegrityPassed: boolean;
  optionsSettlementConservationPassed: boolean;
  notionalAuctionFairnessPassed: boolean;
  chaosRecoveryPassed: boolean;
  releaseCertificateVerified: boolean;
  parameterSchemaPinned: boolean;
  parameterizedDeploymentVerified: boolean;
  referenceScriptsConfirmed: boolean;
  chainConfirmationProofsVerified: boolean;
  liveFundingConfirmed: boolean;
  liveOptionsSettlementConfirmed: boolean;
  liveNotionalSettlementConfirmed: boolean;
  preprodReleaseAttestationVerified: boolean;
  deploymentEpochChainVerified: boolean;
  protocolRegistryCheckpointVerified: boolean;
  stableFinalityVerified: boolean;
  oracleFundingAnchorVerified: boolean;
  crossProductReconciliationVerified: boolean;
  releaseLifecycleVerified: boolean;
  deepPreprodReleaseVerified: boolean;
};

export function evaluateReleaseGate(input: {
  manifest: SymbioticDeploymentManifest;
  evidence: SecurityEvidence;
  allowMainnet?: boolean;
}) {
  const deployment = evaluateDeploymentReadiness(input.manifest);
  const checks = [
    ...deployment.checks,
    { id: "protocol-tests", ready: input.evidence.protocolTestsPassed, detail: "Protocol regression tests must pass." },
    { id: "execution-tests", ready: input.evidence.executionTestsPassed, detail: "Cardano execution tests must pass." },
    { id: "hardening-tests", ready: input.evidence.hardeningTestsPassed, detail: "Adversarial hardening tests must pass." },
    { id: "aiken-check", ready: input.evidence.aikenCheckPassed, detail: "Pinned Aiken validators and invariant properties must pass." },
    { id: "blueprint-verified", ready: input.evidence.blueprintVerified, detail: "The CIP-0057 blueprint must contain collateral, perpetual, options, Notional and registry validators." },
    { id: "validator-artifacts", ready: input.evidence.validatorArtifactsPinned, detail: "Validator artifacts and fingerprints must be pinned to the release." },
    { id: "validator-deployment-binding", ready: input.evidence.validatorDeploymentsBound, detail: "All five deployed script hashes and addresses must be bound to compiled validator fingerprints." },
    { id: "e2e-cardano-lifecycle", ready: input.evidence.e2eLifecyclePassed, detail: "Confirmed Cardano evidence must include registry deployment/checkpoint plus the full product lifecycle." },
    { id: "release-provenance", ready: input.evidence.releaseProvenanceVerified, detail: "Release commit, build, blueprint, validator manifest and config digests must be cryptographically bound." },
    { id: "operator-policy", ready: input.evidence.operatorPolicyVerified, detail: "Oracle, keeper, solver and governance operator quorum policy must be reviewed and verified." },
    { id: "incident-recovery", ready: input.evidence.incidentRecoveryConfigured, detail: "Emergency escalation and delayed recovery procedures must be configured." },
    { id: "preprod-soak", ready: input.evidence.preprodSoakPassed, detail: "Preprod must pass deep soak limits for chain freshness, confirmation latency, reorgs, oracle quorum and transaction failures." },
    { id: "state-transition-binding", ready: input.evidence.stateTransitionBindingPassed, detail: "Builder summaries and validators must enforce unique protocol state transitions and continuing outputs." },
    { id: "oracle-round-integrity", ready: input.evidence.oracleRoundIntegrityPassed, detail: "Oracle rounds must be fresh, monotonic, replay-resistant and independently sourced." },
    { id: "execution-leases", ready: input.evidence.executionLeaseControlsPassed, detail: "Keeper and solver execution must be bounded by one-time expiring leases and operator rate limits." },
    { id: "exposure-controls", ready: input.evidence.exposureControlsPassed, detail: "Global, market, account and withdrawal exposure caps must be active." },
    { id: "canary-rollback", ready: input.evidence.canaryRollbackConfigured, detail: "A staged canary rollout and independently fingerprinted rollback release must be configured." },
    { id: "rollback-drill", ready: input.evidence.canaryRollbackDrillPassed, detail: "The rollback target must be restored in a timed drill with consistent state and no data loss." },
    { id: "solvency-conservation", ready: input.evidence.solvencyConservationPassed, detail: "Custody, liabilities, insurance, locked margin and collateral conservation must reconcile." },
    { id: "funding-integrity", ready: input.evidence.fundingIntegrityPassed, detail: "Perpetual funding rounds must be contiguous, bounded, replay-resistant and value-conserving." },
    { id: "options-conservation", ready: input.evidence.optionsSettlementConservationPassed, detail: "Options settlement proofs must conserve locked collateral across buyer, writer and protocol outputs." },
    { id: "notional-auction", ready: input.evidence.notionalAuctionFairnessPassed, detail: "Notional execution must use committed competing solver quotes and deterministic best execution." },
    { id: "chaos-recovery", ready: input.evidence.chaosRecoveryPassed, detail: "All required provider, indexer, oracle, replay, reorg, withdrawal and rollback fault scenarios must recover within policy." },
    { id: "release-certificate", ready: input.evidence.releaseCertificateVerified, detail: "A fresh governor-approved release certificate must bind code, contracts, SBOM and all economic/security evidence." },
    { id: "parameter-schema", ready: input.evidence.parameterSchemaPinned, detail: "CIP-0057 validator parameter schemas must be fingerprinted and pinned before applying runtime parameters." },
    { id: "parameterized-deployment", ready: input.evidence.parameterizedDeploymentVerified, detail: "All validator parameter CBOR, applied script hashes, addresses and deployment epochs must be cryptographically bound." },
    { id: "reference-scripts", ready: input.evidence.referenceScriptsConfirmed, detail: "All five applied Plutus V3 validators must have confirmed Cardano reference-script UTxOs." },
    { id: "chain-confirmations-v2", ready: input.evidence.chainConfirmationProofsVerified, detail: "Release transactions must carry fresh block, slot, height, tx-index, UTxO and reference-input confirmation proofs." },
    { id: "live-funding", ready: input.evidence.liveFundingConfirmed, detail: "At least one confirmed Preprod funding settlement must bind oracle/funding rounds and conserve transferred collateral." },
    { id: "live-options", ready: input.evidence.liveOptionsSettlementConfirmed, detail: "A confirmed Preprod option settlement must conserve locked collateral across buyer, writer and protocol fee outputs." },
    { id: "live-notional", ready: input.evidence.liveNotionalSettlementConfirmed, detail: "A confirmed Preprod Notional fill must bind intent commitment, solver auction transcript, user limit and execution receipt." },
    { id: "preprod-attestation", ready: input.evidence.preprodReleaseAttestationVerified, detail: "A short-lived governor-approved Preprod attestation must bind parameterized deployment, reference scripts, confirmations and live economic executions." },
    { id: "deployment-epoch-chain", ready: input.evidence.deploymentEpochChainVerified, detail: "Deployment epochs must form a monotonic predecessor chain and consume each release attestation only once." },
    { id: "protocol-registry-checkpoint", ready: input.evidence.protocolRegistryCheckpointVerified, detail: "The on-chain registry must anchor deployment epoch, parameter/deployment digests, protocol state root and oracle/funding rounds." },
    { id: "stable-finality", ready: input.evidence.stableFinalityVerified, detail: "Critical release transactions must be beyond the configured Cardano stability window and not orphaned by rollback." },
    { id: "oracle-funding-anchor", ready: input.evidence.oracleFundingAnchorVerified, detail: "Oracle and funding rounds must advance monotonically and be anchored to the canonical registry state root." },
    { id: "cross-product-reconciliation", ready: input.evidence.crossProductReconciliationVerified, detail: "Collateral, Perps, Options, Notional, withdrawals, insurance and liabilities must reconcile across every account and protocol total." },
    { id: "release-lifecycle", ready: input.evidence.releaseLifecycleVerified, detail: "Release state must advance BUILDING→DEPLOYED→CANARY→SOAK→CERTIFIED→PREPROD_LIVE without skipped normal transitions." },
    { id: "deep-preprod-release", ready: input.evidence.deepPreprodReleaseVerified, detail: "The object-level V7 verifier must bind epoch, registry root, stable finality, oracle/funding anchor, reconciliation and lifecycle evidence." },
    { id: "dependency-audit", ready: input.evidence.dependencyAuditReviewed, detail: "Dependency audit findings must be reviewed before release." },
    { id: "security-contact", ready: input.evidence.securityContactConfigured, detail: "A security contact must be configured." },
    { id: "emergency-runbook", ready: input.evidence.emergencyRunbookConfigured, detail: "Emergency response procedures must be configured." }
  ];

  if (input.manifest.network === "mainnet") {
    checks.push({ id: "mainnet-explicit-enable", ready: input.allowMainnet === true, detail: "Mainnet requires an explicit release-time enable flag." });
  }

  return {
    network: input.manifest.network,
    ready: checks.every((check) => check.ready),
    checks,
    missing: checks.filter((check) => !check.ready).map((check) => check.id)
  };
}

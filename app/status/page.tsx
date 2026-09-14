import { deploymentManifestFromEnv } from "@/lib/deployment";
import { evaluateReleaseGate } from "@/lib/release-gate";

export const dynamic = "force-dynamic";

function flag(value: string | undefined) {
  return value === "true" || value === "1";
}

export default function StatusPage() {
  const manifest = deploymentManifestFromEnv(process.env);
  const readiness = evaluateReleaseGate({
    manifest,
    allowMainnet: flag(process.env.SYMBIOTIC_ALLOW_MAINNET),
    evidence: {
      protocolTestsPassed: flag(process.env.SYMBIOTIC_PROTOCOL_TESTS_PASSED),
      executionTestsPassed: flag(process.env.SYMBIOTIC_EXECUTION_TESTS_PASSED),
      hardeningTestsPassed: flag(process.env.SYMBIOTIC_HARDENING_TESTS_PASSED),
      aikenCheckPassed: flag(process.env.SYMBIOTIC_AIKEN_CHECK_PASSED),
      blueprintVerified: flag(process.env.SYMBIOTIC_BLUEPRINT_VERIFIED),
      validatorArtifactsPinned: flag(process.env.SYMBIOTIC_VALIDATOR_ARTIFACTS_PINNED),
      validatorDeploymentsBound: flag(process.env.SYMBIOTIC_VALIDATOR_DEPLOYMENTS_BOUND),
      e2eLifecyclePassed: flag(process.env.SYMBIOTIC_E2E_LIFECYCLE_PASSED),
      releaseProvenanceVerified: flag(process.env.SYMBIOTIC_RELEASE_PROVENANCE_VERIFIED),
      operatorPolicyVerified: flag(process.env.SYMBIOTIC_OPERATOR_POLICY_VERIFIED),
      incidentRecoveryConfigured: flag(process.env.SYMBIOTIC_INCIDENT_RECOVERY_CONFIGURED),
      preprodSoakPassed: flag(process.env.SYMBIOTIC_PREPROD_SOAK_PASSED),
      stateTransitionBindingPassed: flag(process.env.SYMBIOTIC_STATE_TRANSITION_BINDING_PASSED),
      oracleRoundIntegrityPassed: flag(process.env.SYMBIOTIC_ORACLE_ROUND_INTEGRITY_PASSED),
      executionLeaseControlsPassed: flag(process.env.SYMBIOTIC_EXECUTION_LEASE_CONTROLS_PASSED),
      exposureControlsPassed: flag(process.env.SYMBIOTIC_EXPOSURE_CONTROLS_PASSED),
      canaryRollbackConfigured: flag(process.env.SYMBIOTIC_CANARY_ROLLBACK_CONFIGURED),
      canaryRollbackDrillPassed: flag(process.env.SYMBIOTIC_CANARY_ROLLBACK_DRILL_PASSED),
      solvencyConservationPassed: flag(process.env.SYMBIOTIC_SOLVENCY_CONSERVATION_PASSED),
      fundingIntegrityPassed: flag(process.env.SYMBIOTIC_FUNDING_INTEGRITY_PASSED),
      optionsSettlementConservationPassed: flag(process.env.SYMBIOTIC_OPTIONS_SETTLEMENT_CONSERVATION_PASSED),
      notionalAuctionFairnessPassed: flag(process.env.SYMBIOTIC_NOTIONAL_AUCTION_FAIRNESS_PASSED),
      chaosRecoveryPassed: flag(process.env.SYMBIOTIC_CHAOS_RECOVERY_PASSED),
      releaseCertificateVerified: flag(process.env.SYMBIOTIC_RELEASE_CERTIFICATE_VERIFIED),
      parameterSchemaPinned: flag(process.env.SYMBIOTIC_PARAMETER_SCHEMA_PINNED),
      parameterizedDeploymentVerified: flag(process.env.SYMBIOTIC_PARAMETERIZED_DEPLOYMENT_VERIFIED),
      referenceScriptsConfirmed: flag(process.env.SYMBIOTIC_REFERENCE_SCRIPTS_CONFIRMED),
      chainConfirmationProofsVerified: flag(process.env.SYMBIOTIC_CHAIN_CONFIRMATIONS_V2_VERIFIED),
      liveFundingConfirmed: flag(process.env.SYMBIOTIC_LIVE_FUNDING_CONFIRMED),
      liveOptionsSettlementConfirmed: flag(process.env.SYMBIOTIC_LIVE_OPTIONS_CONFIRMED),
      liveNotionalSettlementConfirmed: flag(process.env.SYMBIOTIC_LIVE_NOTIONAL_CONFIRMED),
      preprodReleaseAttestationVerified: flag(process.env.SYMBIOTIC_PREPROD_ATTESTATION_VERIFIED),
      deploymentEpochChainVerified: flag(process.env.SYMBIOTIC_DEPLOYMENT_EPOCH_CHAIN_VERIFIED),
      protocolRegistryCheckpointVerified: flag(process.env.SYMBIOTIC_REGISTRY_CHECKPOINT_VERIFIED),
      stableFinalityVerified: flag(process.env.SYMBIOTIC_STABLE_FINALITY_VERIFIED),
      oracleFundingAnchorVerified: flag(process.env.SYMBIOTIC_ORACLE_FUNDING_ANCHOR_VERIFIED),
      crossProductReconciliationVerified: flag(process.env.SYMBIOTIC_CROSS_PRODUCT_RECONCILIATION_VERIFIED),
      releaseLifecycleVerified: flag(process.env.SYMBIOTIC_RELEASE_LIFECYCLE_VERIFIED),
      deepPreprodReleaseVerified: flag(process.env.SYMBIOTIC_DEEP_PREPROD_RELEASE_VERIFIED),
      dependencyAuditReviewed: flag(process.env.SYMBIOTIC_DEPENDENCY_AUDIT_REVIEWED),
      securityContactConfigured: Boolean(process.env.SYMBIOTIC_SECURITY_CONTACT?.trim()),
      emergencyRunbookConfigured: Boolean(process.env.SYMBIOTIC_EMERGENCY_RUNBOOK_URL?.trim())
    }
  });

  return (
    <main style={{ minHeight: "100vh", padding: "48px", background: "#080808", color: "#f4f4ef", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <p style={{ letterSpacing: ".14em", color: "#818181", fontSize: 11 }}>SYMBIOTIC / DEEP PREPROD RELEASE GATE V7</p>
      <h1 style={{ fontSize: 54, margin: "18px 0 10px" }}>{readiness.ready ? "RELEASE READY" : "FAIL CLOSED"}</h1>
      <p style={{ color: "#999", maxWidth: 1080, lineHeight: 1.6 }}>V7 adds a fifth on-chain Registry validator, deployment-epoch anti-replay, stable-chain finality with rollback handling, canonical protocol state roots, oracle/funding anchoring, cross-product accounting reconciliation, and an ordered release lifecycle. The visible gate remains fail-closed until the underlying object-level evidence verifies.</p>
      <div style={{ marginTop: 36, border: "1px solid #262626" }}>
        {readiness.checks.map((check) => (
          <div key={check.id} style={{ display: "grid", gridTemplateColumns: "320px 100px 1fr", gap: 20, padding: 16, borderBottom: "1px solid #262626", alignItems: "center" }}>
            <strong>{check.id}</strong>
            <span style={{ color: check.ready ? "#e8ff47" : "#ff6161" }}>{check.ready ? "READY" : "MISSING"}</span>
            <span style={{ color: "#818181" }}>{check.detail}</span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 24, color: "#818181" }}>Network: {readiness.network} · Missing: {readiness.missing.length ? readiness.missing.join(", ") : "none"}</p>
    </main>
  );
}

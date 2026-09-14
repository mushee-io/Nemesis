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
      dependencyAuditReviewed: flag(process.env.SYMBIOTIC_DEPENDENCY_AUDIT_REVIEWED),
      securityContactConfigured: Boolean(process.env.SYMBIOTIC_SECURITY_CONTACT?.trim()),
      emergencyRunbookConfigured: Boolean(process.env.SYMBIOTIC_EMERGENCY_RUNBOOK_URL?.trim())
    }
  });

  return (
    <main style={{ minHeight: "100vh", padding: "48px", background: "#080808", color: "#f4f4ef", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <p style={{ letterSpacing: ".14em", color: "#818181", fontSize: 11 }}>SYMBIOTIC / HARDENED PREPROD RELEASE GATE</p>
      <h1 style={{ fontSize: 54, margin: "18px 0 10px" }}>{readiness.ready ? "RELEASE READY" : "FAIL CLOSED"}</h1>
      <p style={{ color: "#999", maxWidth: 900, lineHeight: 1.6 }}>Symbiotic only reports release-ready when Cardano infrastructure, all four compiled validators, deployment fingerprints, lifecycle receipts, build provenance, operator separation, incident recovery controls and a sustained Preprod soak all pass together.</p>
      <div style={{ marginTop: 36, border: "1px solid #262626" }}>
        {readiness.checks.map((check) => (
          <div key={check.id} style={{ display: "grid", gridTemplateColumns: "260px 100px 1fr", gap: 20, padding: 16, borderBottom: "1px solid #262626", alignItems: "center" }}>
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

import { NextResponse } from "next/server";
import { deploymentManifestFromEnv } from "@/lib/deployment";
import { evaluateReleaseGate } from "@/lib/release-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function flag(value: string | undefined) {
  return value === "true" || value === "1";
}

export async function GET() {
  try {
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
        dependencyAuditReviewed: flag(process.env.SYMBIOTIC_DEPENDENCY_AUDIT_REVIEWED),
        securityContactConfigured: Boolean(process.env.SYMBIOTIC_SECURITY_CONTACT?.trim()),
        emergencyRunbookConfigured: Boolean(process.env.SYMBIOTIC_EMERGENCY_RUNBOOK_URL?.trim())
      }
    });
    return NextResponse.json({
      product: "Symbiotic",
      gate: "onchain-release-v2",
      generatedAt: new Date().toISOString(),
      ...readiness
    }, { status: readiness.ready ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      product: "Symbiotic",
      gate: "onchain-release-v2",
      ready: false,
      error: error instanceof Error ? error.message : "Unable to evaluate readiness"
    }, { status: 500 });
  }
}

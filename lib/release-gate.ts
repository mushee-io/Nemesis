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
    { id: "blueprint-verified", ready: input.evidence.blueprintVerified, detail: "The generated CIP-0057 blueprint must contain collateral, perpetual, options and Notional validators." },
    { id: "validator-artifacts", ready: input.evidence.validatorArtifactsPinned, detail: "Validator artifacts and fingerprints must be pinned to the release." },
    { id: "validator-deployment-binding", ready: input.evidence.validatorDeploymentsBound, detail: "All four deployed script hashes and addresses must be bound to compiled validator fingerprints." },
    { id: "e2e-cardano-lifecycle", ready: input.evidence.e2eLifecyclePassed, detail: "Confirmed Cardano evidence must cover collateral deposit, perp open/close/liquidation, options settlement and Notional settlement." },
    { id: "dependency-audit", ready: input.evidence.dependencyAuditReviewed, detail: "Dependency audit findings must be reviewed before release." },
    { id: "security-contact", ready: input.evidence.securityContactConfigured, detail: "A security contact must be configured." },
    { id: "emergency-runbook", ready: input.evidence.emergencyRunbookConfigured, detail: "Emergency response procedures must be configured." }
  ];

  if (input.manifest.network === "mainnet") {
    checks.push({
      id: "mainnet-explicit-enable",
      ready: input.allowMainnet === true,
      detail: "Mainnet requires an explicit release-time enable flag."
    });
  }

  return {
    network: input.manifest.network,
    ready: checks.every((check) => check.ready),
    checks,
    missing: checks.filter((check) => !check.ready).map((check) => check.id)
  };
}

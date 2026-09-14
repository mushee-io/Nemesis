import {
  bindDeploymentEvidence,
  evaluateE2EReleaseEvidence,
  REQUIRED_PREPROD_ACTIONS,
  REQUIRED_VALIDATOR_TITLES,
  validateArtifactManifest,
  type DeployedValidatorEvidence,
  type E2EExecutionEvidence,
  type ValidatorArtifactManifest
} from "./onchain-evidence";

export type PreprodEvidenceBundle = {
  network: "preprod";
  artifactManifest: ValidatorArtifactManifest;
  deployments: DeployedValidatorEvidence[];
  executions: E2EExecutionEvidence[];
  generatedAt: string;
};

export function evaluatePreprodEvidence(
  bundle: PreprodEvidenceBundle,
  nowMs = Date.now(),
  maxEvidenceAgeMs = 2 * 60 * 60 * 1000
) {
  const generatedAt = new Date(bundle.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) throw new Error("Invalid Preprod evidence timestamp");
  if (generatedAt > nowMs + 60_000) throw new Error("Preprod evidence timestamp is in the future");
  if (maxEvidenceAgeMs <= 0) throw new Error("Invalid Preprod evidence maximum age");
  if (nowMs - generatedAt > maxEvidenceAgeMs) throw new Error("Preprod evidence is stale");

  const artifactManifest = validateArtifactManifest(bundle.artifactManifest);
  const deployments = bindDeploymentEvidence({
    manifest: artifactManifest,
    deployments: bundle.deployments,
    network: "preprod"
  });
  const lifecycle = evaluateE2EReleaseEvidence({
    network: "preprod",
    executions: bundle.executions,
    requiredActions: [...REQUIRED_PREPROD_ACTIONS]
  });

  return {
    ready: deployments.validators.length === REQUIRED_VALIDATOR_TITLES.length && lifecycle.ready,
    network: "preprod" as const,
    validatorCount: deployments.validators.length,
    requiredValidatorCount: REQUIRED_VALIDATOR_TITLES.length,
    executionCount: lifecycle.executionCount,
    missingActions: lifecycle.missingActions,
    generatedAt: new Date(generatedAt).toISOString(),
    evidenceAgeMs: nowMs - generatedAt
  };
}

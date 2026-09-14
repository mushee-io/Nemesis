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

export function evaluatePreprodEvidence(bundle: PreprodEvidenceBundle) {
  const generatedAt = new Date(bundle.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) throw new Error("Invalid Preprod evidence timestamp");

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
    generatedAt: new Date(generatedAt).toISOString()
  };
}

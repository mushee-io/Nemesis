import assert from "node:assert/strict";
import test from "node:test";
import {
  bindDeploymentEvidence,
  evaluateE2EReleaseEvidence,
  validateArtifactManifest,
  type ValidatorArtifactManifest
} from "../lib/onchain-evidence";
import { evaluatePreprodEvidence } from "../lib/preprod-readiness";

const H64 = "a".repeat(64);
const H64B = "b".repeat(64);
const H64C = "c".repeat(64);
const H64D = "d".repeat(64);
const H64E = "e".repeat(64);
const H56 = "e".repeat(56);
const PREPROD_NOW = new Date("2026-09-14T10:06:00.000Z").getTime();

function manifest(): ValidatorArtifactManifest {
  return {
    schemaVersion: 1,
    project: "mushee-io/symbiotic",
    plutusVersion: "v3",
    blueprintSha256: H64,
    validators: [
      { title: "collateral.collateral.spend", hash: null, compiledCodeSha256: H64, compiledBytes: 200, parameterized: true },
      { title: "perpetual.perpetual.spend", hash: null, compiledCodeSha256: H64B, compiledBytes: 300, parameterized: true },
      { title: "options.options.spend", hash: null, compiledCodeSha256: H64C, compiledBytes: 400, parameterized: true },
      { title: "notional.notional.spend", hash: null, compiledCodeSha256: H64D, compiledBytes: 250, parameterized: true },
      { title: "registry.registry.spend", hash: null, compiledCodeSha256: H64E, compiledBytes: 280, parameterized: true }
    ]
  };
}

function deployments() {
  return [
    { title: "collateral.collateral.spend", scriptHash: H56, address: `addr_test1${"q".repeat(40)}`, compiledCodeSha256: H64, network: "preprod" as const },
    { title: "perpetual.perpetual.spend", scriptHash: "1".repeat(56), address: `addr_test1${"w".repeat(40)}`, compiledCodeSha256: H64B, network: "preprod" as const },
    { title: "options.options.spend", scriptHash: "2".repeat(56), address: `addr_test1${"e".repeat(40)}`, compiledCodeSha256: H64C, network: "preprod" as const },
    { title: "notional.notional.spend", scriptHash: "3".repeat(56), address: `addr_test1${"r".repeat(40)}`, compiledCodeSha256: H64D, network: "preprod" as const },
    { title: "registry.registry.spend", scriptHash: "4".repeat(56), address: `addr_test1${"t".repeat(40)}`, compiledCodeSha256: H64E, network: "preprod" as const }
  ];
}

function executions() {
  const actions = ["DEPLOY_REGISTRY", "DEPOSIT_COLLATERAL", "OPEN_PERP", "CLOSE_PERP", "LIQUIDATE", "SETTLE_OPTION", "SETTLE_NOTIONAL", "CHECKPOINT_PROTOCOL_STATE"];
  return actions.map((action, index) => ({
    requestId: `request-${index + 100}`,
    action,
    intentHash: H64,
    unsignedTxSha256: H64B,
    witnessSetSha256: H64C,
    signedTxSha256: "f".repeat(64),
    txHash: (index + 1).toString(16).padStart(64, "0"),
    submittedAt: "2026-09-14T10:00:00.000Z",
    confirmedAt: "2026-09-14T10:00:30.000Z",
    confirmationSlot: 10_000 + index,
    network: "preprod" as const
  }));
}

test("compiled validator manifest requires all five Symbiotic validators", () => {
  assert.equal(validateArtifactManifest(manifest()).validators.length, 5);
  const broken = manifest();
  broken.validators = broken.validators.filter((validator) => !validator.title.startsWith("registry."));
  assert.throws(() => validateArtifactManifest(broken), /Missing validator artifact/);
});

test("deployment evidence binds all compiled validators", () => {
  const result = bindDeploymentEvidence({ manifest: manifest(), network: "preprod", deployments: deployments() });
  assert.equal(result.validators.length, 5);
});

test("deployment evidence rejects code fingerprint substitution", () => {
  const bad = deployments();
  bad[0] = { ...bad[0], compiledCodeSha256: H64B };
  assert.throws(() => bindDeploymentEvidence({ manifest: manifest(), network: "preprod", deployments: bad }), /fingerprint mismatch/);
});

test("release evidence requires registry, product lifecycle and checkpoint actions", () => {
  const release = evaluateE2EReleaseEvidence({ network: "preprod", executions: executions() });
  assert.equal(release.ready, true);
  assert.equal(release.missingActions.length, 0);
});

test("Preprod evidence fails closed when protocol checkpoint is missing", () => {
  const bundle = executions().filter((execution) => execution.action !== "CHECKPOINT_PROTOCOL_STATE");
  const result = evaluatePreprodEvidence({ network: "preprod", artifactManifest: manifest(), deployments: deployments(), executions: bundle, generatedAt: "2026-09-14T10:05:00.000Z" }, PREPROD_NOW);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missingActions, ["CHECKPOINT_PROTOCOL_STATE"]);
});

test("Preprod evidence turns ready only with five validators and eight lifecycle actions", () => {
  const result = evaluatePreprodEvidence({ network: "preprod", artifactManifest: manifest(), deployments: deployments(), executions: executions(), generatedAt: "2026-09-14T10:05:00.000Z" }, PREPROD_NOW);
  assert.equal(result.ready, true);
  assert.equal(result.validatorCount, 5);
  assert.equal(result.executionCount, 8);
  assert.equal(result.evidenceAgeMs, 60_000);
});

test("Preprod evidence rejects stale lifecycle bundles", () => {
  assert.throws(() => evaluatePreprodEvidence({ network: "preprod", artifactManifest: manifest(), deployments: deployments(), executions: executions(), generatedAt: "2026-09-14T07:00:00.000Z" }, PREPROD_NOW), /stale/);
});

test("release evidence rejects duplicate transaction receipts", () => {
  const base = executions()[0];
  assert.throws(() => evaluateE2EReleaseEvidence({ network: "preprod", executions: [base, { ...base, requestId: "request-999", action: "OPEN_PERP" }] }), /Duplicate E2E transaction hash/);
});

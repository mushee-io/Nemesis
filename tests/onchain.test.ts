import assert from "node:assert/strict";
import test from "node:test";
import {
  bindDeploymentEvidence,
  evaluateE2EReleaseEvidence,
  validateArtifactManifest,
  type ValidatorArtifactManifest
} from "../lib/onchain-evidence";

const H64 = "a".repeat(64);
const H64B = "b".repeat(64);
const H64C = "c".repeat(64);
const H56 = "d".repeat(56);

function manifest(): ValidatorArtifactManifest {
  return {
    schemaVersion: 1,
    project: "mushee-io/symbiotic",
    plutusVersion: "v3",
    blueprintSha256: H64,
    validators: [
      { title: "collateral.collateral.spend", hash: H56, compiledCodeSha256: H64, compiledBytes: 200, parameterized: false },
      { title: "perpetual.perpetual.spend", hash: H56, compiledCodeSha256: H64B, compiledBytes: 300, parameterized: false },
      { title: "options.options.spend", hash: null, compiledCodeSha256: H64C, compiledBytes: 400, parameterized: true }
    ]
  };
}

test("compiled validator manifest requires every Symbiotic validator", () => {
  assert.equal(validateArtifactManifest(manifest()).validators.length, 3);
  const broken = manifest();
  broken.validators = broken.validators.filter((validator) => !validator.title.startsWith("options."));
  assert.throws(() => validateArtifactManifest(broken), /Missing validator artifact/);
});

test("deployment evidence is cryptographically bound to compiled artifacts", () => {
  const result = bindDeploymentEvidence({
    manifest: manifest(),
    network: "preprod",
    deployments: [
      { title: "collateral.collateral.spend", scriptHash: H56, address: `addr_test1${"q".repeat(40)}`, compiledCodeSha256: H64, network: "preprod" },
      { title: "perpetual.perpetual.spend", scriptHash: H56, address: `addr_test1${"w".repeat(40)}`, compiledCodeSha256: H64B, network: "preprod" },
      { title: "options.options.spend", scriptHash: "e".repeat(56), address: `addr_test1${"e".repeat(40)}`, compiledCodeSha256: H64C, network: "preprod" }
    ]
  });
  assert.equal(result.validators.length, 3);
});

test("deployment evidence rejects code fingerprint substitution", () => {
  assert.throws(() => bindDeploymentEvidence({
    manifest: manifest(),
    network: "preprod",
    deployments: [
      { title: "collateral.collateral.spend", scriptHash: H56, address: `addr_test1${"q".repeat(40)}`, compiledCodeSha256: H64B, network: "preprod" },
      { title: "perpetual.perpetual.spend", scriptHash: H56, address: `addr_test1${"w".repeat(40)}`, compiledCodeSha256: H64B, network: "preprod" },
      { title: "options.options.spend", scriptHash: "e".repeat(56), address: `addr_test1${"e".repeat(40)}`, compiledCodeSha256: H64C, network: "preprod" }
    ]
  }), /fingerprint mismatch/);
});

test("release evidence requires confirmed transactions for the core lifecycle", () => {
  const actions = ["DEPOSIT_COLLATERAL", "OPEN_PERP", "CLOSE_PERP", "SETTLE_OPTION"];
  const executions = actions.map((action, index) => ({
    requestId: `request-${index + 100}`,
    action,
    intentHash: H64,
    unsignedTxSha256: H64B,
    witnessSetSha256: H64C,
    signedTxSha256: "f".repeat(64),
    txHash: index.toString(16).padStart(64, "0"),
    submittedAt: "2026-09-14T10:00:00.000Z",
    confirmedAt: "2026-09-14T10:00:30.000Z",
    confirmationSlot: 10_000 + index,
    network: "preprod" as const
  }));
  const release = evaluateE2EReleaseEvidence({ network: "preprod", executions });
  assert.equal(release.ready, true);
  assert.equal(release.missingActions.length, 0);
});

test("release evidence rejects duplicate transaction receipts", () => {
  const base = {
    requestId: "request-100",
    action: "DEPOSIT_COLLATERAL",
    intentHash: H64,
    unsignedTxSha256: H64B,
    witnessSetSha256: H64C,
    signedTxSha256: "f".repeat(64),
    txHash: "1".repeat(64),
    submittedAt: "2026-09-14T10:00:00.000Z",
    confirmedAt: "2026-09-14T10:00:30.000Z",
    confirmationSlot: 10_000,
    network: "preprod" as const
  };
  assert.throws(() => evaluateE2EReleaseEvidence({
    network: "preprod",
    executions: [base, { ...base, requestId: "request-101", action: "OPEN_PERP" }]
  }), /Duplicate E2E transaction hash/);
});

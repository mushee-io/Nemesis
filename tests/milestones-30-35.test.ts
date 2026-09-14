import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseProvenance } from "../lib/release-provenance";
import { assertIndependentCriticalRoles, authorizeOperatorQuorum, type OperatorPolicy } from "../lib/operator-policy";
import { authorizeIncidentTransition, type IncidentReceipt } from "../lib/incident-controls";
import { evaluatePreprodSoak } from "../lib/preprod-soak";

const D64A = "a".repeat(64);
const D64B = "b".repeat(64);
const D64C = "c".repeat(64);
const D64D = "d".repeat(64);
const COMMIT = "e".repeat(40);

test("release provenance binds network, commit and distinct artifact digests", () => {
  const result = validateReleaseProvenance({
    network: "preprod",
    commitSha: COMMIT,
    buildSha256: D64A,
    blueprintSha256: D64B,
    validatorManifestSha256: D64C,
    configSha256: D64D,
    generatedAt: "2026-09-14T09:00:00.000Z"
  }, {
    expectedNetwork: "preprod",
    expectedCommitSha: COMMIT,
    expectedBlueprintSha256: D64B,
    maxAgeMs: 3_600_000
  }, new Date("2026-09-14T09:30:00.000Z").getTime());
  assert.equal(result.verified, true);

  assert.throws(() => validateReleaseProvenance({
    network: "preprod",
    commitSha: COMMIT,
    buildSha256: D64A,
    blueprintSha256: D64A,
    validatorManifestSha256: D64C,
    configSha256: D64D,
    generatedAt: "2026-09-14T09:00:00.000Z"
  }, { expectedNetwork: "preprod" }, new Date("2026-09-14T09:30:00.000Z").getTime()), /distinct artifacts/);
});

test("operator quorum rejects unknown or duplicate signers and separates critical roles", () => {
  const policy: OperatorPolicy = {
    ORACLE: { members: ["oracle-a", "oracle-b", "oracle-c"], threshold: 2 },
    KEEPER: { members: ["keeper-a", "keeper-b"], threshold: 1 },
    SOLVER: { members: ["solver-a", "solver-b"], threshold: 1 },
    GOVERNOR: { members: ["gov-a", "gov-b", "gov-c"], threshold: 2 }
  };
  assert.equal(authorizeOperatorQuorum({ role: "ORACLE", signers: ["oracle-a", "oracle-b"], policy }).authorized, true);
  assert.throws(() => authorizeOperatorQuorum({ role: "ORACLE", signers: ["oracle-a", "intruder"], policy }), /Unauthorized/);
  assert.throws(() => authorizeOperatorQuorum({ role: "ORACLE", signers: ["oracle-a", "oracle-a"], policy }), /Duplicate/);
  assert.equal(assertIndependentCriticalRoles(policy), true);
});

test("incident controls allow fast tightening but delay recovery", () => {
  const pause: IncidentReceipt = {
    incidentId: "incident-001",
    from: "NORMAL",
    to: "PAUSED",
    reasonHash: D64A,
    activatedAt: "2026-09-14T09:00:00.000Z",
    approvals: ["guardian-a"]
  };
  assert.equal(authorizeIncidentTransition({
    receipt: pause,
    guardianApprovals: ["guardian-a"],
    governorApprovals: [],
    guardianThreshold: 1,
    governorThreshold: 2,
    nowMs: new Date("2026-09-14T09:00:05.000Z").getTime()
  }).path, "EMERGENCY");

  const recover: IncidentReceipt = {
    incidentId: "incident-002",
    from: "PAUSED",
    to: "NORMAL",
    reasonHash: D64B,
    activatedAt: "2026-09-14T09:00:00.000Z",
    recoverAfter: "2026-09-14T10:00:00.000Z",
    approvals: ["gov-a", "gov-b"]
  };
  assert.throws(() => authorizeIncidentTransition({ receipt: recover, guardianApprovals: [], governorApprovals: ["gov-a", "gov-b"], guardianThreshold: 1, governorThreshold: 2, nowMs: new Date("2026-09-14T09:30:00.000Z").getTime() }), /delay/);
  assert.equal(authorizeIncidentTransition({ receipt: recover, guardianApprovals: [], governorApprovals: ["gov-a", "gov-b"], guardianThreshold: 1, governorThreshold: 2, nowMs: new Date("2026-09-14T10:01:00.000Z").getTime() }).path, "RECOVERY");
});

test("preprod soak requires sustained healthy samples", () => {
  const start = new Date("2026-09-14T08:00:00.000Z").getTime();
  const samples = Array.from({ length: 7 }, (_, index) => ({
    timestamp: new Date(start + index * 10 * 60 * 1000).toISOString(),
    readinessPassed: true,
    providerLagSlots: 2,
    indexerLagSlots: 4,
    oracleSourceCount: 3,
    failedTxRateBps: 25
  }));
  const result = evaluatePreprodSoak(samples);
  assert.equal(result.passed, true);
  assert.equal(result.sampleCount, 7);

  const degraded = samples.map((sample, index) => index === 3 ? { ...sample, oracleSourceCount: 1 } : sample);
  assert.throws(() => evaluatePreprodSoak(degraded), /Oracle quorum degraded/);
});

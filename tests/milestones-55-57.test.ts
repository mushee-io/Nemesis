import assert from "node:assert/strict";
import test from "node:test";
import { deploymentEpochDigest, DeploymentEpochRegistry, validateDeploymentEpoch, type DeploymentEpochState } from "../lib/deployment-epoch";
import { assessFinality, FinalityRegistry, type FinalityPolicy } from "../lib/chain-finality";
import type { CardanoConfirmationProof } from "../lib/chain-confirmation-v2";

const NOW = new Date("2026-09-14T12:00:00.000Z").getTime();
const d = (c: string) => c.repeat(64);
const tx = (n: number) => n.toString(16).padStart(64, "0");

const policy: FinalityPolicy = {
  expectedNetwork: "preprod",
  minimumConfirmations: 3,
  stabilityWindowSlots: 100,
  maximumObservationAgeMs: 600_000
};

function proof(index: number, depth = 200): CardanoConfirmationProof {
  const slot = 10_000 + index;
  return {
    network: "preprod",
    txHash: tx(index),
    blockHash: tx(index + 500),
    slot,
    blockHeight: 5_000 + index,
    txIndex: index % 8,
    confirmations: 12,
    tipSlot: slot + depth,
    observedAt: new Date(NOW - 30_000).toISOString(),
    inputRefs: [{ txHash: tx(index + 100), outputIndex: 0 }],
    outputRefs: [{ txHash: tx(index), outputIndex: 0 }],
    referenceInputRefs: [],
    referenceScripts: []
  };
}

function first(): DeploymentEpochState {
  return {
    network: "preprod", epoch: 1, epochId: "preprod-epoch-001",
    parameterSchemaSha256: d("1"), parameterizedDeploymentSha256: d("2"),
    referenceScriptBundleSha256: d("3"), releaseAttestationSha256: d("4"),
    governorSetSha256: d("5"), activatedAt: "2026-09-14T10:00:00.000Z"
  };
}

function second(previous = first()): DeploymentEpochState {
  return {
    network: "preprod", epoch: 2, epochId: "preprod-epoch-002",
    previousEpochDigest: deploymentEpochDigest(previous),
    parameterSchemaSha256: d("6"), parameterizedDeploymentSha256: d("7"),
    referenceScriptBundleSha256: d("8"), releaseAttestationSha256: d("9"),
    governorSetSha256: d("a"), activatedAt: "2026-09-14T11:00:00.000Z"
  };
}

test("milestone 55 deployment epochs are monotonic and attestation-replay resistant", () => {
  const a = first();
  const b = second(a);
  assert.equal(validateDeploymentEpoch({ current: a, expectedNetwork: "preprod", nowMs: NOW }).epoch, 1);
  assert.equal(validateDeploymentEpoch({ current: b, previous: a, expectedNetwork: "preprod", nowMs: NOW }).epoch, 2);
  const registry = new DeploymentEpochRegistry();
  registry.append(a, "preprod", NOW);
  registry.append(b, "preprod", NOW);
  const replay = { ...b, epoch: 3, epochId: "preprod-epoch-003", previousEpochDigest: deploymentEpochDigest(b), activatedAt: "2026-09-14T11:30:00.000Z" };
  assert.throws(() => registry.append(replay, "preprod", NOW), /already been consumed/);
});

test("milestone 57 separates confirmed from stable and invalidates orphaned transactions", () => {
  const stable = assessFinality(proof(1, 200), policy, NOW);
  const shallow = assessFinality(proof(2, 20), policy, NOW);
  assert.equal(stable.status, "STABLE");
  assert.equal(shallow.status, "CONFIRMED");

  const registry = new FinalityRegistry();
  registry.record(stable);
  registry.applyRollback({
    rollbackId: "rollback-preprod-001",
    network: "preprod",
    detectedAt: "2026-09-14T11:59:00.000Z",
    fromTipSlot: stable.tipSlot,
    toTipSlot: stable.slot - 1,
    orphanedBlockHashes: [stable.blockHash],
    orphanedTxHashes: [stable.txHash]
  }, "preprod", NOW);
  assert.equal(registry.status(stable.txHash), "ORPHANED");
});

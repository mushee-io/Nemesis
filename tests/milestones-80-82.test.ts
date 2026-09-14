import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProviderQuorum, authorizeProviderFailover } from "../lib/provider-failover";
import { classifyLedgerFailure, validateRebuildAttempt } from "../lib/transaction-rebuild";
import { invalidateTransactionChainFrom, validateTransactionChain } from "../lib/bounded-transaction-chain";

const NOW = new Date("2026-09-14T11:20:00.000Z").getTime();
const h = (c: string) => c.repeat(64);
const ref = (n: number) => `${n.toString(16).padStart(64, "0")}#0`;

const providerPolicy = {
  minimumHealthyReads: 2,
  minimumProviderGroups: 2,
  maximumTipSkewSlots: 3,
  maximumLatencyMs: 2_000,
  maximumErrorRateBps: 500,
  maximumSampleAgeMs: 60_000,
  failoverCooldownMs: 30_000
};

function providers() {
  const observedAt = new Date(NOW - 5_000).toISOString();
  return [
    { providerId: "read-a", providerGroup: "group-a", region: "eu-west", role: "READ" as const, tipSlot: 1000, latencyMs: 100, errorRateBps: 10, observedAt, healthy: true },
    { providerId: "read-b", providerGroup: "group-b", region: "us-east", role: "READ" as const, tipSlot: 1001, latencyMs: 120, errorRateBps: 5, observedAt, healthy: true },
    { providerId: "submit-a", providerGroup: "group-c", region: "eu-central", role: "SUBMIT" as const, tipSlot: 1001, latencyMs: 90, errorRateBps: 5, observedAt, healthy: true }
  ];
}

test("milestone 80 requires independent fresh provider quorum and deterministic selection", () => {
  const quorum = evaluateProviderQuorum(providers(), providerPolicy, NOW);
  assert.equal(quorum.selectedReadProviderId, "read-b");
  assert.equal(quorum.selectedSubmitProviderId, "submit-a");
  const selection = authorizeProviderFailover({
    next: { generation: 1, selectedReadProviderId: "read-b", selectedSubmitProviderId: "submit-a", switchedAt: new Date(NOW - 1_000).toISOString() },
    quorum,
    policy: providerPolicy,
    nowMs: NOW
  });
  assert.match(selection.digest, /^[0-9a-f]{64}$/);
  const concentrated = providers().map((sample) => sample.role === "READ" ? { ...sample, providerGroup: "same-group" } : sample);
  assert.throws(() => evaluateProviderQuorum(concentrated, providerPolicy, NOW), /provider groups/);
});

test("milestone 81 rebuilds BadInputs from fresh state and verifies timeout before retry", () => {
  const policy = { maximumAttempts: 4, maximumAgeMs: 60_000, minimumValidityExtensionSlots: 50, requireFreshStateRootOnBadInputs: true, requireTxLookupAfterTimeout: true };
  const previous = { intentHash: h("a"), generation: 1, transactionHash: h("b"), stateRoot: h("c"), providerEvidenceRoot: h("d"), consumedUtxoRefs: [ref(1)], validityStartSlot: 1000, validityEndSlot: 1200, builtAt: new Date(NOW - 20_000).toISOString() };
  const next = { ...previous, generation: 2, transactionHash: h("e"), stateRoot: h("f"), consumedUtxoRefs: [ref(2)], builtAt: new Date(NOW - 10_000).toISOString() };
  const result = validateRebuildAttempt({ previous, next, failure: "BAD_INPUTS", policy, nowMs: NOW });
  assert.equal(result.action, "REBUILD_FRESH_STATE");
  assert.equal(classifyLedgerFailure("VALUE_NOT_CONSERVED"), "FAIL_CLOSED");
  assert.throws(() => validateRebuildAttempt({ previous, next, failure: "PROVIDER_TIMEOUT", policy, nowMs: NOW }), /lookup/);
});

test("milestone 82 validates bounded chains and invalidates all downstream descendants", () => {
  const shared = ref(200);
  const plan = {
    chainId: "perp-chain-001",
    builtAtSlot: 1000,
    links: [
      { index: 0, txHash: h("1"), producedRef: `${h("1")}#0`, validityEndSlot: 1400, collateralRef: ref(101), referenceInputs: [shared] },
      { index: 1, txHash: h("2"), dependsOnTxHash: h("1"), consumesRef: `${h("1")}#0`, producedRef: `${h("2")}#0`, validityEndSlot: 1400, collateralRef: ref(102), referenceInputs: [shared] },
      { index: 2, txHash: h("3"), dependsOnTxHash: h("2"), consumesRef: `${h("2")}#0`, producedRef: `${h("3")}#0`, validityEndSlot: 1400, collateralRef: ref(103), referenceInputs: [shared] }
    ]
  };
  const policy = { maximumDepth: 4, minimumRemainingValiditySlots: 100, maximumSharedReferenceInputs: 2, requireDedicatedCollateralPerScriptTx: true };
  const result = validateTransactionChain(plan, policy, 1050);
  assert.equal(result.depth, 3);
  const invalidated = invalidateTransactionChainFrom(plan, h("2"));
  assert.deepEqual(invalidated.invalidatedTransactionHashes, [h("2"), h("3")]);
  const broken = structuredClone(plan); broken.links[2].consumesRef = `${h("1")}#0`;
  assert.throws(() => validateTransactionChain(broken, policy, 1050), /immediate predecessor/);
});

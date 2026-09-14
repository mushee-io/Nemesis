import assert from "node:assert/strict";
import test from "node:test";
import { buildLivenessPolicyRoot } from "../lib/liveness-policy-root";
import { buildV10LivenessReview } from "../lib/liveness-review-v10";

const NOW = new Date("2026-09-14T11:20:00.000Z").getTime();
const h = (c: string) => c.repeat(64);
const ref = (n: number) => `${n.toString(16).padStart(64, "0")}#0`;

const policies = {
  provider: { minimumHealthyReads: 2, minimumProviderGroups: 2, maximumTipSkewSlots: 3, maximumLatencyMs: 2_000, maximumErrorRateBps: 500, maximumSampleAgeMs: 60_000, failoverCooldownMs: 30_000 },
  rebuild: { maximumAttempts: 4, maximumAgeMs: 60_000, minimumValidityExtensionSlots: 50, requireFreshStateRootOnBadInputs: true, requireTxLookupAfterTimeout: true },
  chain: { maximumDepth: 4, minimumRemainingValiditySlots: 100, maximumSharedReferenceInputs: 2, requireDedicatedCollateralPerScriptTx: true },
  degradedMarket: { maxIndexerLagNormal: 3, maxIndexerLagReduceOnly: 15, maxTxFailureBpsNormal: 100, maxTxFailureBpsReduceOnly: 500, minimumRecoveryObservations: 3, minimumModeDurationMs: 60_000 },
  operatorFailover: { minimumCandidates: 2, maximumRecommended: 2, heartbeatStaleMs: 60_000, minimumBondUnits: "1000", maximumStrikes: 2, reviewLeaseSlots: 120, minimumRegionDiversity: 2, minimumProviderGroupDiversity: 2 }
};

function bundle() {
  const livenessRoot = buildLivenessPolicyRoot(policies).root;
  const observedAt = new Date(NOW - 5_000).toISOString();
  const shared = ref(200);
  return {
    previousV9Digest: h("f"),
    registry: {
      deploymentEpoch: 4,
      registryNonce: 12,
      stateRoot: h("1"), riskRoot: h("2"), operatorRoot: h("3"), settlementRoot: h("4"), migrationRoot: h("5"),
      reviewRoot: h("6"), recoveryRoot: h("7"), economicsRoot: h("8"), oraclePolicyRoot: h("9"), disputeRoot: h("a"), accountabilityRoot: h("b"), invariantRoot: h("c"), upgradeRecoveryRoot: h("d"),
      livenessRoot,
      oracleRound: 20,
      fundingRound: 19,
      paused: false
    },
    policies,
    providerSamples: [
      { providerId: "read-a", providerGroup: "group-a", region: "eu-west", role: "READ" as const, tipSlot: 1000, latencyMs: 100, errorRateBps: 10, observedAt, healthy: true },
      { providerId: "read-b", providerGroup: "group-b", region: "us-east", role: "READ" as const, tipSlot: 1001, latencyMs: 120, errorRateBps: 5, observedAt, healthy: true },
      { providerId: "submit-a", providerGroup: "group-c", region: "eu-central", role: "SUBMIT" as const, tipSlot: 1001, latencyMs: 90, errorRateBps: 5, observedAt, healthy: true }
    ],
    providerSelectionNext: { generation: 1, selectedReadProviderId: "read-b", selectedSubmitProviderId: "submit-a", switchedAt: new Date(NOW - 1_000).toISOString() },
    rebuild: {
      previous: { intentHash: h("e"), generation: 1, transactionHash: h("1"), stateRoot: h("2"), providerEvidenceRoot: h("3"), consumedUtxoRefs: [ref(1)], validityStartSlot: 1000, validityEndSlot: 1200, builtAt: new Date(NOW - 20_000).toISOString() },
      next: { intentHash: h("e"), generation: 2, transactionHash: h("4"), stateRoot: h("5"), providerEvidenceRoot: h("3"), consumedUtxoRefs: [ref(2)], validityStartSlot: 1000, validityEndSlot: 1200, builtAt: new Date(NOW - 10_000).toISOString() },
      failure: "BAD_INPUTS" as const
    },
    chain: {
      currentSlot: 1050,
      plan: {
        chainId: "review-chain-001",
        builtAtSlot: 1000,
        links: [
          { index: 0, txHash: h("6"), producedRef: `${h("6")}#0`, validityEndSlot: 1400, collateralRef: ref(101), referenceInputs: [shared] },
          { index: 1, txHash: h("7"), dependsOnTxHash: h("6"), consumesRef: `${h("6")}#0`, producedRef: `${h("7")}#0`, validityEndSlot: 1400, collateralRef: ref(102), referenceInputs: [shared] }
        ]
      }
    },
    degradedMarket: {
      snapshot: { providerHealthy: true, indexerLagSlots: 6, oracleHealthy: true, finalityHealthy: true, keeperHealthy: true, solverHealthy: false, transactionFailureBps: 150, unresolvedCriticalDisputes: 0, insolvencyDetected: false, observedAt },
      previous: { market: "BTC-USD", mode: "NORMAL" as const, generation: 1, enteredAt: new Date(NOW - 120_000).toISOString(), recoveryObservations: 0 },
      next: { market: "BTC-USD", mode: "LIMIT_ONLY" as const, generation: 2, enteredAt: new Date(NOW - 1_000).toISOString(), recoveryObservations: 0 }
    },
    failoverReview: {
      reviewId: "keeper-review-v10",
      role: "KEEPER" as const,
      epoch: 4,
      currentSlot: 50_000,
      roundSeed: h("8"),
      operatorRoot: h("3"),
      candidates: [
        { operatorId: "keeper-a", role: "KEEPER" as const, region: "eu-west", providerGroup: "infra-a", bondUnits: "5000", strikes: 0, heartbeatAt: observedAt, disabled: false },
        { operatorId: "keeper-b", role: "KEEPER" as const, region: "us-east", providerGroup: "infra-b", bondUnits: "4000", strikes: 1, heartbeatAt: observedAt, disabled: false }
      ]
    },
    reviewerApprovals: ["reviewer-a", "reviewer-b", "reviewer-c"],
    issuedAt: new Date(NOW - 10_000).toISOString(),
    expiresAt: new Date(NOW + 3_600_000).toISOString()
  };
}

test("milestone 85 V10 recomputes liveness policy and runtime evidence but remains non-activating", () => {
  const result = buildV10LivenessReview({ bundle: bundle(), minimumReviewers: 3, nowMs: NOW });
  assert.equal(result.reviewReady, true);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.version, "V10");
  assert.equal(result.requiredMode, "LIMIT_ONLY");
  assert.match(result.digest, /^[0-9a-f]{64}$/);

  const bad = bundle();
  bad.registry.livenessRoot = h("0");
  assert.throws(() => buildV10LivenessReview({ bundle: bad, minimumReviewers: 3, nowMs: NOW }), /liveness root/);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildProtocolStateRoot, type ProtocolStateCheckpoint } from "../lib/protocol-state-root";
import { reconcileCrossProductLedger } from "../lib/cross-product-reconciliation";
import { validateOracleFundingAnchor } from "../lib/oracle-funding-anchor";
import { assessFinality, type FinalityPolicy } from "../lib/chain-finality";
import { deploymentEpochDigest, type DeploymentEpochState } from "../lib/deployment-epoch";
import { releaseLifecycleDigest, validateReleaseLifecycleTransition, type ReleaseLifecycleState } from "../lib/release-lifecycle";
import { verifyDeepPreprodRelease } from "../lib/deep-preprod-release";
import type { CardanoConfirmationProof } from "../lib/chain-confirmation-v2";

const NOW = new Date("2026-09-14T12:00:00.000Z").getTime();
const d = (c: string) => c.repeat(64);
const tx = (n: number) => n.toString(16).padStart(64, "0");
const policy: FinalityPolicy = { expectedNetwork: "preprod", minimumConfirmations: 3, stabilityWindowSlots: 100, maximumObservationAgeMs: 600_000 };

function proof(index: number, depth = 200): CardanoConfirmationProof {
  const slot = 20_000 + index;
  return { network: "preprod", txHash: tx(index), blockHash: tx(index + 700), slot, blockHeight: 9_000 + index, txIndex: index % 8, confirmations: 12, tipSlot: slot + depth, observedAt: new Date(NOW - 30_000).toISOString(), inputRefs: [{ txHash: tx(index + 100), outputIndex: 0 }], outputRefs: [{ txHash: tx(index), outputIndex: 0 }], referenceInputRefs: [], referenceScripts: [] };
}

function checkpoint(): ProtocolStateCheckpoint {
  return {
    deploymentEpoch: 2, registryNonce: 4, oracleRound: 9, fundingRound: 9,
    leaves: [
      { product: "COLLATERAL", stateId: "collateral:acct-a", utxoRef: `${tx(201)}#0`, ownerOrMarket: "acct-a", nonce: 3, valueDigest: d("b") },
      { product: "PERPETUAL", stateId: "perp:btc:acct-a", utxoRef: `${tx(202)}#0`, ownerOrMarket: "BTC-USD", nonce: 5, valueDigest: d("c") },
      { product: "OPTIONS", stateId: "option:btc:sep", utxoRef: `${tx(203)}#0`, ownerOrMarket: "BTC-USD", nonce: 2, valueDigest: d("d") },
      { product: "NOTIONAL", stateId: "notional:auction-9", utxoRef: `${tx(204)}#0`, ownerOrMarket: "BTC-USD", nonce: 8, valueDigest: d("e") }
    ],
    accounting: { custodyUnits: "1000", insuranceUnits: "300", userEquityLiabilityUnits: "700", pendingWithdrawalUnits: "50", badDebtUnits: "0", lockedPerpMarginUnits: "300", lockedOptionCollateralUnits: "200", optionPayoutLiabilityUnits: "50", notionalEscrowUnits: "50" },
    generatedAt: "2026-09-14T11:50:00.000Z"
  };
}

const accounts = [
  { account: "acct-a", collateralUnits: "600", perpMarginUnits: "200", perpPnlLiabilityUnits: "50", optionCollateralUnits: "100", optionPayoutLiabilityUnits: "50", notionalEscrowUnits: "50", pendingWithdrawalUnits: "50" },
  { account: "acct-b", collateralUnits: "400", perpMarginUnits: "100", perpPnlLiabilityUnits: "0", optionCollateralUnits: "100", optionPayoutLiabilityUnits: "0", notionalEscrowUnits: "0", pendingWithdrawalUnits: "0" }
];
const totals = { custodyUnits: "1000", insuranceUnits: "300", badDebtUnits: "0", perpMarginUnits: "300", perpPnlLiabilityUnits: "50", optionCollateralUnits: "200", optionPayoutLiabilityUnits: "50", notionalEscrowUnits: "50", pendingWithdrawalUnits: "50" };

function epochs(): [DeploymentEpochState, DeploymentEpochState] {
  const first: DeploymentEpochState = { network: "preprod", epoch: 1, epochId: "preprod-epoch-001", parameterSchemaSha256: d("1"), parameterizedDeploymentSha256: d("2"), referenceScriptBundleSha256: d("3"), releaseAttestationSha256: d("4"), governorSetSha256: d("5"), activatedAt: "2026-09-14T10:00:00.000Z" };
  const second: DeploymentEpochState = { network: "preprod", epoch: 2, epochId: "preprod-epoch-002", previousEpochDigest: deploymentEpochDigest(first), parameterSchemaSha256: d("6"), parameterizedDeploymentSha256: d("7"), referenceScriptBundleSha256: d("8"), releaseAttestationSha256: d("9"), governorSetSha256: d("a"), activatedAt: "2026-09-14T11:00:00.000Z" };
  return [first, second];
}

test("milestones 56 and 59 produce a canonical solvent root and reject double-counted UTxOs", () => {
  const root = buildProtocolStateRoot(checkpoint());
  const reconciliation = reconcileCrossProductLedger({ accounts, totals });
  assert.equal(root.solvent, true);
  assert.equal(reconciliation.surplusUnits, 200n);
  const broken = checkpoint();
  broken.leaves[1] = { ...broken.leaves[1], utxoRef: broken.leaves[0].utxoRef };
  assert.throws(() => buildProtocolStateRoot(broken), /double-counts a UTxO/);
});

test("milestone 58 requires a stable oracle/funding anchor tied to the registry root", () => {
  const root = buildProtocolStateRoot(checkpoint()).root;
  const anchor = { network: "preprod" as const, deploymentEpoch: 2, registryStateRoot: root, oracleRound: 9, oracleRoundDigest: d("f"), fundingRound: 9, fundingRoundDigest: d("0"), market: "BTC-USD", indexPrice: 60_000, markPrice: 60_120, confirmation: proof(301) };
  assert.equal(validateOracleFundingAnchor({ anchor, finalityPolicy: policy, nowMs: NOW }).finality.status, "STABLE");
  assert.throws(() => validateOracleFundingAnchor({ anchor: { ...anchor, confirmation: proof(302, 20) }, finalityPolicy: policy, nowMs: NOW }), /not stable/);
});

test("milestone 60 forbids skipped release phases", () => {
  const building: ReleaseLifecycleState = { releaseId: "symbiotic-v0-11-preprod", network: "preprod", phase: "BUILDING", deploymentEpoch: 2, generation: 1, evidence: {}, enteredAt: "2026-09-14T10:00:00.000Z" };
  const bad: ReleaseLifecycleState = { ...building, phase: "SOAK", generation: 2, previousStateDigest: releaseLifecycleDigest(building), enteredAt: "2026-09-14T10:10:00.000Z", evidence: { deploymentEpochDigest: d("1"), registryStateRoot: d("2"), oracleFundingAnchorDigest: d("3"), crossProductReconciliationDigest: d("4"), soakEvidenceDigest: d("5") } };
  assert.throws(() => validateReleaseLifecycleTransition({ previous: building, next: bad, policy: { expectedNetwork: "preprod", requireStableFinalityForLive: true }, nowMs: NOW }), /Invalid release lifecycle transition/);
});

test("milestone 60 verifies the complete deep Preprod evidence graph", () => {
  const [first, second] = epochs();
  const state = checkpoint();
  const stateRoot = buildProtocolStateRoot(state).root;
  const reconciliation = reconcileCrossProductLedger({ accounts, totals });
  const anchor = { network: "preprod" as const, deploymentEpoch: 2, registryStateRoot: stateRoot, oracleRound: 9, oracleRoundDigest: d("f"), fundingRound: 9, fundingRoundDigest: d("0"), market: "BTC-USD", indexPrice: 60_000, markPrice: 60_120, confirmation: proof(310) };
  const anchored = validateOracleFundingAnchor({ anchor, finalityPolicy: policy, nowMs: NOW });
  const critical = [proof(401), proof(402), proof(403)];
  const finalityDigest = createHash("sha256").update(critical.map((entry) => assessFinality(entry, policy, NOW).digest).sort().join("|")).digest("hex");
  const epochDigest = deploymentEpochDigest(second);
  const certified: ReleaseLifecycleState = { releaseId: "symbiotic-v0-11-preprod", network: "preprod", phase: "CERTIFIED", deploymentEpoch: 2, generation: 5, evidence: { deploymentEpochDigest: epochDigest, registryStateRoot: stateRoot, oracleFundingAnchorDigest: anchored.digest, crossProductReconciliationDigest: reconciliation.digest, releaseAttestationDigest: d("6"), soakEvidenceDigest: d("7") }, enteredAt: "2026-09-14T11:30:00.000Z", previousStateDigest: d("8") };
  const live: ReleaseLifecycleState = { ...certified, phase: "PREPROD_LIVE", generation: 6, previousStateDigest: releaseLifecycleDigest(certified), enteredAt: "2026-09-14T11:55:00.000Z", evidence: { ...certified.evidence, finalityEvidenceDigest: finalityDigest } };
  const result = verifyDeepPreprodRelease({ bundle: { epoch: second, previousEpoch: first, registryCheckpoint: state, crossProductAccounts: accounts, crossProductTotals: totals, oracleFundingAnchor: anchor, criticalConfirmations: critical, lifecycle: live, previousLifecycle: certified }, finalityPolicy: policy, nowMs: NOW });
  assert.equal(result.ready, true);
  assert.equal(result.stableTransactionCount, 3);
});

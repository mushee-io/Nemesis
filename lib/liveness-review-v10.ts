import { createHash } from "node:crypto";
import { validateRegistryLivenessV10, type RegistryLivenessV10State } from "./registry-liveness-v10";
import { buildLivenessPolicyRoot, type LivenessPolicyBundle } from "./liveness-policy-root";
import { evaluateProviderQuorum, authorizeProviderFailover, type ProviderHealthSample, type ProviderSelectionState } from "./provider-failover";
import { validateRebuildAttempt, type LedgerFailureCode, type RebuildAttempt } from "./transaction-rebuild";
import { validateTransactionChain, type TransactionChainPlan } from "./bounded-transaction-chain";
import { requiredMarketMode, validateMarketModeTransition, type MarketHealthSnapshot, type MarketModeState } from "./degraded-market-control";
import { buildOperatorFailoverReview, type FailoverReviewRound } from "./operator-failover-plan";

export type V10LivenessReviewBundle = {
  previousV9Digest: string;
  registry: RegistryLivenessV10State;
  policies: LivenessPolicyBundle;
  providerSamples: ProviderHealthSample[];
  providerSelectionPrevious?: ProviderSelectionState;
  providerSelectionNext: ProviderSelectionState;
  rebuild: {
    previous: RebuildAttempt;
    next: RebuildAttempt;
    failure: LedgerFailureCode;
    txPresenceChecked?: boolean;
    txAlreadyObserved?: boolean;
  };
  chain: { plan: TransactionChainPlan; currentSlot: number };
  degradedMarket: { snapshot: MarketHealthSnapshot; previous: MarketModeState; next: MarketModeState };
  failoverReview: FailoverReviewRound;
  reviewerApprovals: string[];
  issuedAt: string;
  expiresAt: string;
};

function d64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be SHA-256`);
  return value.toLowerCase();
}

export function buildV10LivenessReview(input: { bundle: V10LivenessReviewBundle; minimumReviewers: number; nowMs?: number }) {
  const nowMs = input.nowMs ?? Date.now();
  const b = input.bundle;
  const previousV9Digest = d64(b.previousV9Digest, "Previous V9 review");
  const registry = validateRegistryLivenessV10(b.registry);
  if (registry.paused) throw new Error("V10 liveness review cannot pass while Registry is paused");
  const policies = buildLivenessPolicyRoot(b.policies);
  if (policies.root !== registry.livenessRoot) throw new Error("Registry liveness root mismatch");

  const providerQuorum = evaluateProviderQuorum(b.providerSamples, b.policies.provider, nowMs);
  const providerFailover = authorizeProviderFailover({
    previous: b.providerSelectionPrevious,
    next: b.providerSelectionNext,
    quorum: providerQuorum,
    policy: b.policies.provider,
    nowMs
  });

  const rebuild = validateRebuildAttempt({ ...b.rebuild, policy: b.policies.rebuild, nowMs });
  const chain = validateTransactionChain(b.chain.plan, b.policies.chain, b.chain.currentSlot);
  const requiredMode = requiredMarketMode(b.degradedMarket.snapshot, b.policies.degradedMarket, nowMs);
  const market = validateMarketModeTransition({
    previous: b.degradedMarket.previous,
    next: b.degradedMarket.next,
    requiredMode,
    policy: b.policies.degradedMarket,
    nowMs
  });
  const operatorReview = buildOperatorFailoverReview(b.failoverReview, b.policies.operatorFailover, nowMs);
  if (operatorReview.executionAllowed !== false) throw new Error("Operator failover review must remain non-executable");

  if (!Number.isInteger(input.minimumReviewers) || input.minimumReviewers < 3) throw new Error("V10 liveness review requires at least three reviewers");
  if (new Set(b.reviewerApprovals).size !== b.reviewerApprovals.length || b.reviewerApprovals.length < input.minimumReviewers) throw new Error("Insufficient independent V10 reviewer approvals");
  const issuedAt = new Date(b.issuedAt).getTime();
  const expiresAt = new Date(b.expiresAt).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || issuedAt > nowMs + 60_000 || nowMs > expiresAt) throw new Error("V10 liveness review window is invalid");

  const digest = createHash("sha256").update([
    previousV9Digest,
    registry.digest,
    policies.root,
    providerQuorum.evidenceRoot,
    providerFailover.digest,
    rebuild.digest,
    chain.root,
    market.digest,
    operatorReview.root,
    ...b.reviewerApprovals.slice().sort(),
    new Date(issuedAt).toISOString(),
    new Date(expiresAt).toISOString()
  ].join("|")).digest("hex");

  return {
    reviewReady: true,
    activationAllowed: false as const,
    version: "V10" as const,
    digest,
    registryDigest: registry.digest,
    livenessRoot: policies.root,
    providerEvidenceRoot: providerQuorum.evidenceRoot,
    chainDepth: chain.depth,
    requiredMode,
    recommendedOperators: operatorReview.recommendations.map((entry) => entry.operatorId)
  };
}

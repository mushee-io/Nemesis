import { createHash } from "node:crypto";

export type LedgerFailureCode =
  | "BAD_INPUTS"
  | "OUTSIDE_VALIDITY"
  | "VALUE_NOT_CONSERVED"
  | "FEE_TOO_SMALL"
  | "PROVIDER_TIMEOUT"
  | "MEMPOOL_REJECTED"
  | "UNKNOWN";

export type RebuildAction = "REBUILD_FRESH_STATE" | "REBUILD_VALIDITY" | "VERIFY_THEN_RESUBMIT" | "FAIL_CLOSED";

export type TransactionRebuildPolicy = {
  maximumAttempts: number;
  maximumAgeMs: number;
  minimumValidityExtensionSlots: number;
  requireFreshStateRootOnBadInputs: boolean;
  requireTxLookupAfterTimeout: boolean;
};

export type RebuildAttempt = {
  intentHash: string;
  generation: number;
  transactionHash: string;
  stateRoot: string;
  providerEvidenceRoot: string;
  consumedUtxoRefs: string[];
  validityStartSlot: number;
  validityEndSlot: number;
  builtAt: string;
};

function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be SHA-256`);
  return value.toLowerCase();
}
function refs(values: string[], label: string) {
  if (!values.length) throw new Error(`${label} cannot be empty`);
  const normalized = values.map((value) => {
    if (!/^[0-9a-f]{64}#[0-9]{1,5}$/i.test(value)) throw new Error(`Invalid ${label} UTxO reference`);
    return value.toLowerCase();
  });
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicate UTxOs`);
  return normalized;
}

export function transactionRebuildPolicyRoot(policy: TransactionRebuildPolicy) {
  if (!Number.isInteger(policy.maximumAttempts) || policy.maximumAttempts < 1 || policy.maximumAttempts > 10) throw new Error("Invalid rebuild attempt cap");
  if (!Number.isInteger(policy.maximumAgeMs) || policy.maximumAgeMs < 1) throw new Error("Invalid rebuild age");
  if (!Number.isInteger(policy.minimumValidityExtensionSlots) || policy.minimumValidityExtensionSlots < 1) throw new Error("Invalid rebuild validity extension");
  return createHash("sha256").update([
    policy.maximumAttempts,
    policy.maximumAgeMs,
    policy.minimumValidityExtensionSlots,
    policy.requireFreshStateRootOnBadInputs ? 1 : 0,
    policy.requireTxLookupAfterTimeout ? 1 : 0
  ].join("|")).digest("hex");
}

export function classifyLedgerFailure(code: LedgerFailureCode): RebuildAction {
  if (code === "BAD_INPUTS") return "REBUILD_FRESH_STATE";
  if (code === "OUTSIDE_VALIDITY") return "REBUILD_VALIDITY";
  if (code === "PROVIDER_TIMEOUT") return "VERIFY_THEN_RESUBMIT";
  return "FAIL_CLOSED";
}

export function validateRebuildAttempt(input: {
  previous: RebuildAttempt;
  next: RebuildAttempt;
  failure: LedgerFailureCode;
  policy: TransactionRebuildPolicy;
  txPresenceChecked?: boolean;
  txAlreadyObserved?: boolean;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  transactionRebuildPolicyRoot(input.policy);
  const action = classifyLedgerFailure(input.failure);
  if (action === "FAIL_CLOSED") throw new Error(`Ledger failure is not safely retryable: ${input.failure}`);
  const previous = normalizeAttempt(input.previous, input.policy, nowMs);
  const next = normalizeAttempt(input.next, input.policy, nowMs);
  if (next.intentHash !== previous.intentHash) throw new Error("Rebuild changed the signed intent identity");
  if (next.generation !== previous.generation + 1) throw new Error("Rebuild generation must advance exactly once");
  if (next.generation > input.policy.maximumAttempts) throw new Error("Rebuild attempt cap exceeded");
  if (next.transactionHash === previous.transactionHash) throw new Error("Rebuild must produce a new transaction hash");

  if (action === "REBUILD_FRESH_STATE") {
    if (input.policy.requireFreshStateRootOnBadInputs && next.stateRoot === previous.stateRoot) throw new Error("BadInputs rebuild requires fresh chain state");
    if (sameRefs(next.consumedUtxoRefs, previous.consumedUtxoRefs)) throw new Error("BadInputs rebuild reused the stale input set");
  }
  if (action === "REBUILD_VALIDITY") {
    if (next.validityEndSlot < previous.validityEndSlot + input.policy.minimumValidityExtensionSlots) throw new Error("Validity rebuild did not extend the validity window enough");
  }
  if (action === "VERIFY_THEN_RESUBMIT") {
    if (input.policy.requireTxLookupAfterTimeout && !input.txPresenceChecked) throw new Error("Timeout recovery requires transaction lookup before retry");
    if (input.txAlreadyObserved) throw new Error("Observed transaction must not be rebuilt or resubmitted");
  }

  const digest = createHash("sha256").update([
    input.failure,
    action,
    previous.transactionHash,
    next.transactionHash,
    next.generation,
    next.stateRoot,
    next.providerEvidenceRoot,
    ...next.consumedUtxoRefs,
    next.validityStartSlot,
    next.validityEndSlot
  ].join("|")).digest("hex");
  return { authorized: true, action, digest, generation: next.generation };
}

function normalizeAttempt(attempt: RebuildAttempt, policy: TransactionRebuildPolicy, nowMs: number) {
  const builtAtMs = new Date(attempt.builtAt).getTime();
  if (!Number.isFinite(builtAtMs) || builtAtMs > nowMs + 60_000 || nowMs - builtAtMs > policy.maximumAgeMs) throw new Error("Rebuild attempt evidence is stale or invalid");
  if (!Number.isInteger(attempt.generation) || attempt.generation < 1) throw new Error("Invalid rebuild generation");
  if (!Number.isInteger(attempt.validityStartSlot) || !Number.isInteger(attempt.validityEndSlot) || attempt.validityEndSlot <= attempt.validityStartSlot) throw new Error("Invalid transaction validity window");
  return {
    ...attempt,
    intentHash: digest64(attempt.intentHash, "Intent hash"),
    transactionHash: digest64(attempt.transactionHash, "Transaction hash"),
    stateRoot: digest64(attempt.stateRoot, "State root"),
    providerEvidenceRoot: digest64(attempt.providerEvidenceRoot, "Provider evidence root"),
    consumedUtxoRefs: refs(attempt.consumedUtxoRefs, "Consumed inputs")
  };
}

function sameRefs(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const aa = [...a].sort(), bb = [...b].sort();
  return aa.every((value, index) => value === bb[index]);
}

import { createHash } from "node:crypto";
import { REQUIRED_VALIDATOR_TITLES } from "./onchain-evidence";

export type MigrationMode = "GENESIS" | "UPGRADE";
export type MigrationValidator = { title: (typeof REQUIRED_VALIDATOR_TITLES)[number]; previousScriptHash?: string; previousReference?: string; nextScriptHash: string; nextReference: string };
export type MigrationState = { stateId: string; product: "COLLATERAL" | "PERPETUAL" | "OPTIONS" | "NOTIONAL" | "REGISTRY"; previousUtxoRef: string; nextUtxoRef: string; beforeDigest: string; afterDigest: string; nonceBefore: number; nonceAfter: number };
export type ProtocolMigrationPlan = {
  id: string; network: "preprod" | "mainnet"; mode: MigrationMode; fromEpoch: number; toEpoch: number;
  previousRegistryRoot: string; nextRegistryRoot: string; parameterSchemaSha256: string; nextDeploymentSha256: string;
  validators: MigrationValidator[]; state: MigrationState[]; governorApprovals: string[]; proposedAt: string; expiresAt: string;
};
function h64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be SHA-256`); return v.toLowerCase(); }
function h56(v: string | undefined, label: string) { if (!v || !/^[0-9a-f]{56}$/i.test(v)) throw new Error(`${label} must be a script hash`); return v.toLowerCase(); }
function ref(v: string | undefined, label: string) { if (!v || !/^[0-9a-f]{64}#[0-9]{1,5}$/i.test(v)) throw new Error(`${label} must be a UTxO reference`); return v.toLowerCase(); }
function unique(values: string[], label: string) { if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`); }

export function validateProtocolMigration(plan: ProtocolMigrationPlan, minimumGovernorApprovals: number, nowMs = Date.now()) {
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(plan.id)) throw new Error("Invalid migration id");
  if (!Number.isInteger(minimumGovernorApprovals) || minimumGovernorApprovals < 1) throw new Error("Invalid migration quorum");
  unique(plan.governorApprovals, "Migration approvals");
  if (plan.governorApprovals.length < minimumGovernorApprovals) throw new Error("Insufficient migration approvals");
  const proposedAt = new Date(plan.proposedAt).getTime(), expiresAt = new Date(plan.expiresAt).getTime();
  if (!Number.isFinite(proposedAt) || !Number.isFinite(expiresAt) || expiresAt <= proposedAt || proposedAt > nowMs + 60_000 || nowMs > expiresAt) throw new Error("Migration is outside its authorization window");
  const previousRoot = h64(plan.previousRegistryRoot, "Previous registry root"), nextRoot = h64(plan.nextRegistryRoot, "Next registry root");
  if (previousRoot === nextRoot) throw new Error("Migration must change registry root");
  h64(plan.parameterSchemaSha256, "Parameter schema"); h64(plan.nextDeploymentSha256, "Next deployment");
  if (plan.mode === "GENESIS") {
    if (plan.fromEpoch !== 0 || plan.toEpoch !== 1 || plan.state.length) throw new Error("Genesis migration must create an empty epoch one");
    if (previousRoot !== "0".repeat(64)) throw new Error("Genesis migration must use zero predecessor root");
  } else if (plan.fromEpoch < 1 || plan.toEpoch !== plan.fromEpoch + 1 || !plan.state.length) {
    throw new Error("Upgrade migration must advance one epoch and account for live state");
  }
  if (plan.validators.length !== REQUIRED_VALIDATOR_TITLES.length) throw new Error("Migration must cover all validators");
  const nextHashes: string[] = [], nextRefs: string[] = [];
  for (const title of REQUIRED_VALIDATOR_TITLES) {
    const item = plan.validators.find((v) => v.title === title);
    if (!item) throw new Error(`Missing migration validator ${title}`);
    nextHashes.push(h56(item.nextScriptHash, `${title} next hash`)); nextRefs.push(ref(item.nextReference, `${title} next reference`));
    if (plan.mode === "UPGRADE") { h56(item.previousScriptHash, `${title} previous hash`); ref(item.previousReference, `${title} previous reference`); }
    else if (item.previousScriptHash || item.previousReference) throw new Error("Genesis migration cannot claim previous validator state");
  }
  unique(nextHashes, "Next script hashes"); unique(nextRefs, "Next references");
  const ids: string[] = [], beforeRefs: string[] = [], afterRefs: string[] = [];
  const leaves = plan.state.map((s) => {
    const before = ref(s.previousUtxoRef, "Migration source"), after = ref(s.nextUtxoRef, "Migration target");
    if (!/^[a-zA-Z0-9:_-]{4,128}$/.test(s.stateId) || before === after || s.nonceBefore < 0 || s.nonceAfter !== s.nonceBefore + 1) throw new Error("Invalid migration state transition");
    ids.push(s.stateId); beforeRefs.push(before); afterRefs.push(after);
    return [s.product, s.stateId, before, after, h64(s.beforeDigest, "Before digest"), h64(s.afterDigest, "After digest"), s.nonceBefore, s.nonceAfter].join(":");
  });
  unique(ids, "Migration state ids"); unique(beforeRefs, "Migration sources"); unique(afterRefs, "Migration targets");
  const digest = createHash("sha256").update([plan.id, plan.network, plan.mode, plan.fromEpoch, plan.toEpoch, previousRoot, nextRoot, plan.parameterSchemaSha256.toLowerCase(), plan.nextDeploymentSha256.toLowerCase(), ...plan.validators.map((v) => `${v.title}:${v.nextScriptHash}:${v.nextReference}`).sort(), ...leaves.sort(), ...plan.governorApprovals.slice().sort()].join("|")).digest("hex");
  return { verified: true, digest, mode: plan.mode, stateCount: plan.state.length, toEpoch: plan.toEpoch };
}

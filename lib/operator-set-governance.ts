import { createHash } from "node:crypto";

export type OperatorRole = "GOVERNOR" | "GUARDIAN" | "ORACLE" | "KEEPER" | "SOLVER" | "BUILDER";
export type OperatorIdentity = { id: string; credentialDigest: string; roles: OperatorRole[]; activeFromSlot: number; activeUntilSlot?: number };
export type OperatorSet = { epoch: number; members: OperatorIdentity[]; thresholds: Record<OperatorRole, number> };
export type OperatorSetChange = { id: string; previousRoot: string; next: OperatorSet; retiredCredentials: string[]; emergency: boolean; governorApprovals: string[]; guardianApprovals: string[]; activateAtSlot: number };
export type OperatorSetPolicy = { governorQuorum: number; guardianQuorum: number; minimumOverlapSlots: number; minimumOracleMembers: number; minimumKeeperMembers: number; minimumSolverMembers: number };
function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be SHA-256`); return v.toLowerCase(); }
function uniq(v: string[], label: string) { if (new Set(v).size !== v.length) throw new Error(`${label} contains duplicates`); }
function byRole(set: OperatorSet, role: OperatorRole) { return set.members.filter((m) => m.roles.includes(role)); }

export function operatorSetRoot(set: OperatorSet) {
  if (!Number.isInteger(set.epoch) || set.epoch < 1 || !set.members.length) throw new Error("Invalid operator set");
  uniq(set.members.map((m) => m.id), "Operator ids"); uniq(set.members.map((m) => d64(m.credentialDigest, "Operator credential")), "Operator credentials");
  for (const m of set.members) {
    if (!/^[a-zA-Z0-9:_-]{3,96}$/.test(m.id) || !m.roles.length || new Set(m.roles).size !== m.roles.length) throw new Error("Invalid operator member");
    if (!Number.isInteger(m.activeFromSlot) || m.activeFromSlot < 1 || (m.activeUntilSlot != null && m.activeUntilSlot <= m.activeFromSlot)) throw new Error("Invalid operator activation window");
    if (m.roles.includes("GOVERNOR") && m.roles.includes("GUARDIAN")) throw new Error("Governor and guardian roles must be separated");
    if (m.roles.includes("BUILDER") && (m.roles.includes("GOVERNOR") || m.roles.includes("GUARDIAN"))) throw new Error("Builder and governance roles must be separated");
  }
  for (const role of ["GOVERNOR", "GUARDIAN", "ORACLE", "KEEPER", "SOLVER", "BUILDER"] as OperatorRole[]) {
    const threshold = set.thresholds[role], count = byRole(set, role).length;
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > count) throw new Error(`Invalid ${role} threshold`);
  }
  const body = set.members.map((m) => `${m.id}:${m.credentialDigest.toLowerCase()}:${m.roles.slice().sort().join(",")}:${m.activeFromSlot}:${m.activeUntilSlot ?? "OPEN"}`).sort();
  const thresholds = Object.entries(set.thresholds).map(([r, t]) => `${r}:${t}`).sort();
  return createHash("sha256").update([set.epoch, ...body, ...thresholds].join("|")).digest("hex");
}

export function authorizeOperatorSetChange(previous: OperatorSet, change: OperatorSetChange, policy: OperatorSetPolicy, currentSlot: number) {
  const previousRoot = operatorSetRoot(previous);
  if (change.previousRoot.toLowerCase() !== previousRoot || change.next.epoch !== previous.epoch + 1) throw new Error("Operator set continuity failed");
  if (!Number.isInteger(change.activateAtSlot) || change.activateAtSlot <= currentSlot) throw new Error("Operator activation must be in the future");
  uniq(change.governorApprovals, "Governor approvals"); uniq(change.guardianApprovals, "Guardian approvals");
  const retired = change.retiredCredentials.map((v) => d64(v, "Retired credential")); uniq(retired, "Retired credentials");
  const nextCredentials = new Set(change.next.members.map((m) => d64(m.credentialDigest, "Next credential")));
  if (retired.some((v) => nextCredentials.has(v))) throw new Error("Retired credential remains active");
  const nextRoot = operatorSetRoot(change.next);
  if (byRole(change.next, "ORACLE").length < policy.minimumOracleMembers || byRole(change.next, "KEEPER").length < policy.minimumKeeperMembers || byRole(change.next, "SOLVER").length < policy.minimumSolverMembers) throw new Error("Operator diversity requirement failed");
  if (change.emergency) {
    if (change.guardianApprovals.length < policy.guardianQuorum || !retired.length) throw new Error("Emergency operator change authorization failed");
  } else {
    if (change.governorApprovals.length < policy.governorQuorum) throw new Error("Operator change lacks governor quorum");
    const overlap = previous.members.filter((m) => nextCredentials.has(m.credentialDigest.toLowerCase()));
    if (!overlap.length || change.activateAtSlot - currentSlot < policy.minimumOverlapSlots) throw new Error("Operator overlap window is insufficient");
  }
  const digest = createHash("sha256").update([change.id, previousRoot, nextRoot, change.activateAtSlot, change.emergency ? 1 : 0, ...retired.sort()].join("|")).digest("hex");
  return { authorized: true, digest, previousRoot, nextRoot, epoch: change.next.epoch };
}

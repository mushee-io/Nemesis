import { createHash } from "node:crypto";
import { operatorSetRoot, type OperatorSet } from "./operator-set-governance";

export type InitialOperatorAuthorization = {
  id: string;
  operators: OperatorSet;
  governorApprovals: string[];
  authorizedAt: string;
  expiresAt: string;
};

export function authorizeInitialOperatorSet(input: {
  authorization: InitialOperatorAuthorization;
  governorQuorum: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const a = input.authorization;
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(a.id)) throw new Error("Invalid initial operator authorization id");
  if (!Number.isInteger(input.governorQuorum) || input.governorQuorum < 1) throw new Error("Invalid operator governor quorum");
  if (new Set(a.governorApprovals).size !== a.governorApprovals.length || a.governorApprovals.length < input.governorQuorum) throw new Error("Initial operator set lacks governor quorum");
  const authorizedAt = new Date(a.authorizedAt).getTime();
  const expiresAt = new Date(a.expiresAt).getTime();
  if (!Number.isFinite(authorizedAt) || !Number.isFinite(expiresAt) || expiresAt <= authorizedAt) throw new Error("Invalid initial operator authorization window");
  if (authorizedAt > nowMs + 60_000 || nowMs > expiresAt) throw new Error("Initial operator authorization is outside its valid window");
  const operatorRoot = operatorSetRoot(a.operators);
  const digest = createHash("sha256").update([a.id, operatorRoot, ...a.governorApprovals.slice().sort(), new Date(authorizedAt).toISOString(), new Date(expiresAt).toISOString()].join("|")).digest("hex");
  return { authorized: true, operatorRoot, digest };
}

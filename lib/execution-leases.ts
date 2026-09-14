export type LeaseRole = "KEEPER" | "SOLVER";

export type ExecutionLease = {
  leaseId: string;
  role: LeaseRole;
  operator: string;
  action: string;
  market: string;
  intentHash: string;
  oracleRoundId: number;
  maxNotionalUsd: number;
  notBefore: string;
  expiresAt: string;
};

export type LeasePolicy = {
  maxTtlMs: number;
  maxNotionalUsd: number;
  maxUsesPerOperatorWindow: number;
  windowMs: number;
};

export const DEFAULT_LEASE_POLICY: LeasePolicy = {
  maxTtlMs: 60_000,
  maxNotionalUsd: 250_000,
  maxUsesPerOperatorWindow: 20,
  windowMs: 60_000
};

export function validateExecutionLease(lease: ExecutionLease, nowMs = Date.now(), policy: LeasePolicy = DEFAULT_LEASE_POLICY) {
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(lease.leaseId)) throw new Error("Invalid execution lease id");
  if (!lease.operator.trim()) throw new Error("Execution lease operator is required");
  if (!lease.action.trim()) throw new Error("Execution lease action is required");
  if (!lease.market.trim()) throw new Error("Execution lease market is required");
  if (!/^[0-9a-f]{64}$/i.test(lease.intentHash)) throw new Error("Execution lease intent hash is invalid");
  if (!Number.isInteger(lease.oracleRoundId) || lease.oracleRoundId <= 0) throw new Error("Execution lease oracle round is invalid");
  if (!Number.isFinite(lease.maxNotionalUsd) || lease.maxNotionalUsd <= 0 || lease.maxNotionalUsd > policy.maxNotionalUsd) throw new Error("Execution lease notional exceeds policy");
  const notBefore = new Date(lease.notBefore).getTime();
  const expiresAt = new Date(lease.expiresAt).getTime();
  if (!Number.isFinite(notBefore) || !Number.isFinite(expiresAt) || expiresAt <= notBefore) throw new Error("Execution lease time window is invalid");
  if (expiresAt - notBefore > policy.maxTtlMs) throw new Error("Execution lease TTL exceeds policy");
  if (nowMs < notBefore) throw new Error("Execution lease is not active yet");
  if (nowMs >= expiresAt) throw new Error("Execution lease has expired");
  return true;
}

export class ExecutionLeaseRegistry {
  private readonly consumed = new Set<string>();
  private readonly usage = new Map<string, number[]>();

  consume(lease: ExecutionLease, nowMs = Date.now(), policy: LeasePolicy = DEFAULT_LEASE_POLICY) {
    validateExecutionLease(lease, nowMs, policy);
    const id = lease.leaseId.toLowerCase();
    if (this.consumed.has(id)) throw new Error("Execution lease already consumed");
    const operator = lease.operator.trim().toLowerCase();
    const active = (this.usage.get(operator) ?? []).filter((time) => nowMs - time < policy.windowMs);
    if (active.length >= policy.maxUsesPerOperatorWindow) throw new Error("Operator execution rate limit exceeded");
    active.push(nowMs);
    this.usage.set(operator, active);
    this.consumed.add(id);
    return { consumed: true, leaseId: id, operator, windowUses: active.length };
  }
}

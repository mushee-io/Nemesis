export type ProtocolMode = "NORMAL" | "REDUCE_ONLY" | "SETTLEMENT_ONLY" | "PAUSED";
export type GovernanceRole = "GOVERNOR" | "GUARDIAN" | "KEEPER";
export type ProtocolAction = "DEPOSIT" | "WITHDRAW" | "OPEN_PERP" | "CLOSE_PERP" | "BUY_OPTION" | "WRITE_OPTION" | "SETTLE_OPTION" | "LIQUIDATE" | "SETTLE_NOTIONAL";

const MODE_ACTIONS: Record<ProtocolMode, Set<ProtocolAction>> = {
  NORMAL: new Set(["DEPOSIT", "WITHDRAW", "OPEN_PERP", "CLOSE_PERP", "BUY_OPTION", "WRITE_OPTION", "SETTLE_OPTION", "LIQUIDATE", "SETTLE_NOTIONAL"]),
  REDUCE_ONLY: new Set(["WITHDRAW", "CLOSE_PERP", "SETTLE_OPTION", "LIQUIDATE", "SETTLE_NOTIONAL"]),
  SETTLEMENT_ONLY: new Set(["WITHDRAW", "SETTLE_OPTION", "LIQUIDATE", "SETTLE_NOTIONAL"]),
  PAUSED: new Set(["WITHDRAW", "SETTLE_OPTION"])
};

export function assertActionAllowed(mode: ProtocolMode, action: ProtocolAction) {
  if (!MODE_ACTIONS[mode].has(action)) throw new Error(`${action} is disabled while protocol mode is ${mode}`);
  return true;
}

export type GovernanceProposal = {
  id: string;
  action: string;
  payloadHash: string;
  proposer: string;
  createdAtMs: number;
  executeAfterMs: number;
  expiresAtMs: number;
};

export function createGovernanceProposal(input: {
  id: string;
  action: string;
  payloadHash: string;
  proposer: string;
  role: GovernanceRole;
  nowMs?: number;
  minimumDelayMs?: number;
  ttlMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const minimumDelayMs = input.minimumDelayMs ?? 24 * 60 * 60 * 1000;
  const ttlMs = input.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  if (input.role !== "GOVERNOR") throw new Error("Only governors may create timelocked configuration proposals");
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(input.id)) throw new Error("Invalid governance proposal id");
  if (!/^[0-9a-f]{64}$/i.test(input.payloadHash)) throw new Error("Governance payload hash must be 32-byte hex");
  if (!input.action.trim() || !input.proposer.trim()) throw new Error("Governance action and proposer are required");
  if (!Number.isFinite(minimumDelayMs) || minimumDelayMs < 60 * 60 * 1000) throw new Error("Governance delay is below safety minimum");
  if (!Number.isFinite(ttlMs) || ttlMs <= minimumDelayMs) throw new Error("Governance TTL must exceed execution delay");
  return {
    id: input.id,
    action: input.action.trim(),
    payloadHash: input.payloadHash.toLowerCase(),
    proposer: input.proposer.trim(),
    createdAtMs: nowMs,
    executeAfterMs: nowMs + minimumDelayMs,
    expiresAtMs: nowMs + ttlMs
  } satisfies GovernanceProposal;
}

export function authorizeGovernanceExecution(input: {
  proposal: GovernanceProposal;
  role: GovernanceRole;
  payloadHash: string;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  if (input.role !== "GOVERNOR") throw new Error("Only governors may execute governance proposals");
  if (input.payloadHash.toLowerCase() !== input.proposal.payloadHash) throw new Error("Governance payload hash mismatch");
  if (nowMs < input.proposal.executeAfterMs) throw new Error("Governance timelock has not elapsed");
  if (nowMs >= input.proposal.expiresAtMs) throw new Error("Governance proposal has expired");
  return true;
}

export function authorizeEmergencyModeChange(input: { role: GovernanceRole; from: ProtocolMode; to: ProtocolMode }) {
  if (input.role === "GUARDIAN") {
    const severity: Record<ProtocolMode, number> = { NORMAL: 0, REDUCE_ONLY: 1, SETTLEMENT_ONLY: 2, PAUSED: 3 };
    if (severity[input.to] < severity[input.from]) throw new Error("Guardian cannot relax an emergency mode");
    return true;
  }
  if (input.role !== "GOVERNOR") throw new Error("Role is not authorized to change protocol mode");
  return true;
}

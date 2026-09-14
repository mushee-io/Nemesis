export type IncidentMode = "NORMAL" | "REDUCE_ONLY" | "SETTLEMENT_ONLY" | "PAUSED";

export type IncidentReceipt = {
  incidentId: string;
  from: IncidentMode;
  to: IncidentMode;
  reasonHash: string;
  activatedAt: string;
  recoverAfter?: string;
  approvals: string[];
};

const severity: Record<IncidentMode, number> = {
  NORMAL: 0,
  REDUCE_ONLY: 1,
  SETTLEMENT_ONLY: 2,
  PAUSED: 3
};

function digest64(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("Incident reason hash must be a 32-byte hex digest");
}

export function validateIncidentReceipt(receipt: IncidentReceipt) {
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(receipt.incidentId)) throw new Error("Invalid incident id");
  digest64(receipt.reasonHash);
  const activatedAt = new Date(receipt.activatedAt).getTime();
  if (!Number.isFinite(activatedAt)) throw new Error("Invalid incident activation time");
  if (!receipt.approvals.length || new Set(receipt.approvals.map((value) => value.toLowerCase())).size !== receipt.approvals.length) {
    throw new Error("Incident approvals must be unique and non-empty");
  }
  if (severity[receipt.to] < severity[receipt.from]) {
    const recoverAfter = receipt.recoverAfter ? new Date(receipt.recoverAfter).getTime() : NaN;
    if (!Number.isFinite(recoverAfter) || recoverAfter <= activatedAt) {
      throw new Error("Incident recovery must define a delayed recoverAfter timestamp");
    }
  }
  return true;
}

export function authorizeIncidentTransition(input: {
  receipt: IncidentReceipt;
  guardianApprovals: string[];
  governorApprovals: string[];
  guardianThreshold: number;
  governorThreshold: number;
  nowMs?: number;
}) {
  validateIncidentReceipt(input.receipt);
  const nowMs = input.nowMs ?? Date.now();
  const tightening = severity[input.receipt.to] >= severity[input.receipt.from];
  const uniqueGuardians = new Set(input.guardianApprovals.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const uniqueGovernors = new Set(input.governorApprovals.map((value) => value.trim().toLowerCase()).filter(Boolean));

  if (tightening) {
    if (uniqueGuardians.size < input.guardianThreshold) throw new Error("Guardian quorum not reached");
    return { authorized: true, path: "EMERGENCY" as const };
  }

  const recoverAfter = new Date(input.receipt.recoverAfter ?? "").getTime();
  if (!Number.isFinite(recoverAfter) || nowMs < recoverAfter) throw new Error("Recovery delay has not elapsed");
  if (uniqueGovernors.size < input.governorThreshold) throw new Error("Governor recovery quorum not reached");
  return { authorized: true, path: "RECOVERY" as const };
}

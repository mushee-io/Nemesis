import { createHash } from "node:crypto";

export type RegistryCriticalState = {
  deploymentEpoch: number; registryNonce: number; stateRoot: string; riskRoot: string; operatorRoot: string;
  settlementRoot: string; migrationRoot: string; oracleRound: number; fundingRound: number; paused: boolean;
  reviewRoot?: string; recoveryRoot?: string; economicsRoot?: string; oraclePolicyRoot?: string;
  disputeRoot?: string; accountabilityRoot?: string; invariantRoot?: string; upgradeRecoveryRoot?: string;
};

const ZERO = "0".repeat(64);
function d(value: string | undefined, label: string, required = true) {
  if (!value) { if (required) throw new Error(`${label} is required`); return ZERO; }
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

export function validateRegistryCriticalState(state: RegistryCriticalState, requireV9 = false) {
  if (!Number.isInteger(state.deploymentEpoch) || state.deploymentEpoch < 1) throw new Error("Invalid registry deployment epoch");
  if (!Number.isInteger(state.registryNonce) || state.registryNonce < 1) throw new Error("Invalid registry nonce");
  if (!Number.isInteger(state.oracleRound) || state.oracleRound < 0) throw new Error("Invalid registry oracle round");
  if (!Number.isInteger(state.fundingRound) || state.fundingRound < 0) throw new Error("Invalid registry funding round");
  const n = {
    ...state,
    stateRoot: d(state.stateRoot, "Registry state root"), riskRoot: d(state.riskRoot, "Registry risk root"),
    operatorRoot: d(state.operatorRoot, "Registry operator root"), settlementRoot: d(state.settlementRoot, "Registry settlement root"),
    migrationRoot: d(state.migrationRoot, "Registry migration root"), reviewRoot: d(state.reviewRoot, "Registry review root", requireV9),
    recoveryRoot: d(state.recoveryRoot, "Registry recovery root", requireV9), economicsRoot: d(state.economicsRoot, "Registry economics root", requireV9),
    oraclePolicyRoot: d(state.oraclePolicyRoot, "Registry oracle policy root", requireV9), disputeRoot: d(state.disputeRoot, "Registry dispute root", requireV9),
    accountabilityRoot: d(state.accountabilityRoot, "Registry accountability root", requireV9), invariantRoot: d(state.invariantRoot, "Registry invariant root", requireV9),
    upgradeRecoveryRoot: d(state.upgradeRecoveryRoot, "Registry upgrade recovery root", requireV9)
  };
  if (requireV9 && [n.reviewRoot,n.recoveryRoot,n.economicsRoot,n.oraclePolicyRoot,n.disputeRoot,n.accountabilityRoot,n.invariantRoot,n.upgradeRecoveryRoot].includes(ZERO)) throw new Error("V9 Registry roots cannot be zero");
  const digest = createHash("sha256").update([
    n.deploymentEpoch,n.registryNonce,n.stateRoot,n.riskRoot,n.operatorRoot,n.settlementRoot,n.migrationRoot,
    n.reviewRoot,n.recoveryRoot,n.economicsRoot,n.oraclePolicyRoot,n.disputeRoot,n.accountabilityRoot,n.invariantRoot,n.upgradeRecoveryRoot,
    n.oracleRound,n.fundingRound,n.paused ? 1 : 0
  ].join("|")).digest("hex");
  return { ...n, digest };
}

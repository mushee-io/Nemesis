import { createHash } from "node:crypto";

export type RegistryCriticalState = {
  deploymentEpoch: number;
  registryNonce: number;
  stateRoot: string;
  riskRoot: string;
  operatorRoot: string;
  settlementRoot: string;
  migrationRoot: string;
  oracleRound: number;
  fundingRound: number;
  paused: boolean;
};

function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

export function validateRegistryCriticalState(state: RegistryCriticalState) {
  if (!Number.isInteger(state.deploymentEpoch) || state.deploymentEpoch < 1) throw new Error("Invalid registry deployment epoch");
  if (!Number.isInteger(state.registryNonce) || state.registryNonce < 1) throw new Error("Invalid registry nonce");
  if (!Number.isInteger(state.oracleRound) || state.oracleRound < 0) throw new Error("Invalid registry oracle round");
  if (!Number.isInteger(state.fundingRound) || state.fundingRound < 0) throw new Error("Invalid registry funding round");

  const normalized = {
    ...state,
    stateRoot: digest64(state.stateRoot, "Registry state root"),
    riskRoot: digest64(state.riskRoot, "Registry risk root"),
    operatorRoot: digest64(state.operatorRoot, "Registry operator root"),
    settlementRoot: digest64(state.settlementRoot, "Registry settlement root"),
    migrationRoot: digest64(state.migrationRoot, "Registry migration root")
  };

  const digest = createHash("sha256").update([
    normalized.deploymentEpoch,
    normalized.registryNonce,
    normalized.stateRoot,
    normalized.riskRoot,
    normalized.operatorRoot,
    normalized.settlementRoot,
    normalized.migrationRoot,
    normalized.oracleRound,
    normalized.fundingRound,
    normalized.paused ? 1 : 0
  ].join("|")).digest("hex");

  return { ...normalized, digest };
}

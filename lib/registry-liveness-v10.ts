import { createHash } from "node:crypto";
import { validateRegistryCriticalState, type RegistryCriticalState } from "./registry-critical-state";

export type RegistryLivenessV10State = RegistryCriticalState & { livenessRoot: string };

export function validateRegistryLivenessV10(state: RegistryLivenessV10State) {
  const base = validateRegistryCriticalState(state, true);
  if (!/^[0-9a-f]{64}$/i.test(state.livenessRoot) || /^0+$/.test(state.livenessRoot)) throw new Error("V10 Registry liveness root must be a nonzero SHA-256 digest");
  const livenessRoot = state.livenessRoot.toLowerCase();
  const digest = createHash("sha256").update([base.digest, livenessRoot, "V10_LIVENESS"].join("|")).digest("hex");
  return { ...base, livenessRoot, digest };
}

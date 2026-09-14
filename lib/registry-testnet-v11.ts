import { createHash } from "node:crypto";
import { validateRegistryLivenessV10, type RegistryLivenessV10State } from "./registry-liveness-v10";

export type RegistryTestnetV11State = RegistryLivenessV10State & { testnetRoot: string };

export function validateRegistryTestnetV11(state: RegistryTestnetV11State) {
  const base = validateRegistryLivenessV10(state);
  if (!/^[0-9a-f]{64}$/i.test(state.testnetRoot) || /^0+$/.test(state.testnetRoot)) throw new Error("V11 Registry testnet root must be a nonzero SHA-256 digest");
  const testnetRoot = state.testnetRoot.toLowerCase();
  const digest = createHash("sha256").update([base.digest,testnetRoot,"V11_CARDANO_PREPROD"].join("|")).digest("hex");
  return { ...base, testnetRoot, digest };
}

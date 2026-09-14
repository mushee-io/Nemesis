import { createHash } from "node:crypto";
import { assertPreprodAddress } from "./cardano-testnet-profile";

export type TestnetAction =
  | "DEPLOY_REFERENCE_SCRIPT" | "INIT_REGISTRY"
  | "DEPOSIT_COLLATERAL" | "WITHDRAW_COLLATERAL"
  | "OPEN_PERP" | "INCREASE_PERP" | "REDUCE_PERP" | "CLOSE_PERP" | "LIQUIDATE_PERP" | "APPLY_FUNDING"
  | "WRITE_OPTION" | "BUY_OPTION" | "SETTLE_OPTION" | "CLOSE_OPTION"
  | "COMMIT_NOTIONAL" | "FILL_NOTIONAL" | "CANCEL_NOTIONAL"
  | "REGISTRY_CHECKPOINT";

export type PlannedValue = { unit: string; quantity: string };
export type PlannedOutput = { address: string; values: PlannedValue[]; inlineDatumCborHex?: string; referenceScriptHash?: string };

export type TestnetTransactionPlan = {
  planId: string;
  network: "preprod";
  networkMagic: 1;
  action: TestnetAction;
  stateRootBefore: string;
  inputRefs: string[];
  referenceInputRefs: string[];
  collateralInputRefs: string[];
  outputs: PlannedOutput[];
  requiredSignerHashes: string[];
  redeemerCborHex?: string;
  metadataDigest?: string;
  validityStartSlot: number;
  validityEndSlot: number;
  feeLovelace: string;
  changeAddress: string;
  createdAt: string;
};

function d64(v: string, label: string) { if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be 64 hex`); return v.toLowerCase(); }
function ref(v: string, label: string) { if (!/^[0-9a-f]{64}#[0-9]+$/i.test(v)) throw new Error(`${label} must be txHash#index`); return v.toLowerCase(); }
function cbor(v: string, label: string) { if (!/^[0-9a-f]+$/i.test(v) || v.length % 2 !== 0) throw new Error(`${label} must be non-empty even-length CBOR hex`); return v.toLowerCase(); }
function quantity(v: string, label: string) { if (!/^-?\d+$/.test(v)) throw new Error(`${label} must be an integer string`); return BigInt(v); }

export function validateTestnetTransactionPlan(plan: TestnetTransactionPlan, nowMs = Date.now()) {
  if (!/^[a-z0-9:_-]{8,128}$/i.test(plan.planId)) throw new Error("Invalid transaction plan id");
  if (plan.network !== "preprod" || plan.networkMagic !== 1) throw new Error("Transaction plan must target Cardano Preprod magic 1");
  const stateRootBefore = d64(plan.stateRootBefore, "State root before");
  const inputRefs = plan.inputRefs.map((v,i) => ref(v, `Input ${i}`));
  const referenceInputRefs = plan.referenceInputRefs.map((v,i) => ref(v, `Reference input ${i}`));
  const collateralInputRefs = plan.collateralInputRefs.map((v,i) => ref(v, `Collateral input ${i}`));
  if (new Set(inputRefs).size !== inputRefs.length || new Set(referenceInputRefs).size !== referenceInputRefs.length || new Set(collateralInputRefs).size !== collateralInputRefs.length) throw new Error("Transaction plan contains duplicate UTxO references");
  const consumed = new Set([...inputRefs, ...collateralInputRefs]);
  for (const value of referenceInputRefs) if (consumed.has(value)) throw new Error("Reference inputs cannot also be consumed");
  if (plan.action !== "INIT_REGISTRY" && plan.action !== "DEPLOY_REFERENCE_SCRIPT" && inputRefs.length === 0) throw new Error("State-changing transaction plan requires at least one input");
  assertPreprodAddress(plan.changeAddress, "Transaction change address");
  if (!Number.isInteger(plan.validityStartSlot) || !Number.isInteger(plan.validityEndSlot) || plan.validityStartSlot < 0 || plan.validityEndSlot <= plan.validityStartSlot) throw new Error("Invalid Cardano validity interval");
  const fee = quantity(plan.feeLovelace, "Fee");
  if (fee <= 0n) throw new Error("Transaction fee must be positive");
  const requiredSignerHashes = plan.requiredSignerHashes.map((v) => {
    if (!/^[0-9a-f]{56}$/i.test(v)) throw new Error("Required signer hash must be 56 hex");
    return v.toLowerCase();
  });
  if (new Set(requiredSignerHashes).size !== requiredSignerHashes.length) throw new Error("Required signer hashes must be unique");
  if (plan.redeemerCborHex) cbor(plan.redeemerCborHex, "Redeemer");
  if (plan.metadataDigest) d64(plan.metadataDigest, "Metadata digest");
  const outputs = plan.outputs.map((output, oi) => {
    assertPreprodAddress(output.address, `Output ${oi} address`);
    if (output.values.length === 0) throw new Error("Every output requires at least one value");
    const seen = new Set<string>();
    const values = output.values.map((value) => {
      if (!/^(lovelace|[0-9a-f]{56}[0-9a-f]*)$/i.test(value.unit)) throw new Error("Output asset unit is invalid");
      if (seen.has(value.unit.toLowerCase())) throw new Error("Output contains duplicate asset units");
      seen.add(value.unit.toLowerCase());
      const q = quantity(value.quantity, "Output quantity");
      if (q < 0n) throw new Error("Output quantity cannot be negative");
      return { unit: value.unit.toLowerCase(), quantity: q.toString() };
    });
    if (output.inlineDatumCborHex) cbor(output.inlineDatumCborHex, "Inline datum");
    if (output.referenceScriptHash && !/^[0-9a-f]{56}$/i.test(output.referenceScriptHash)) throw new Error("Output reference script hash must be 56 hex");
    return { ...output, values };
  });
  const createdAt = new Date(plan.createdAt).getTime();
  if (!Number.isFinite(createdAt) || createdAt > nowMs + 60_000) throw new Error("Transaction plan timestamp is invalid");
  const digest = createHash("sha256").update(JSON.stringify({
    planId: plan.planId, network: plan.network, networkMagic: plan.networkMagic, action: plan.action, stateRootBefore,
    inputRefs, referenceInputRefs, collateralInputRefs, outputs, requiredSignerHashes,
    redeemerCborHex: plan.redeemerCborHex?.toLowerCase() ?? null, metadataDigest: plan.metadataDigest?.toLowerCase() ?? null,
    validityStartSlot: plan.validityStartSlot, validityEndSlot: plan.validityEndSlot, feeLovelace: fee.toString(), changeAddress: plan.changeAddress, createdAt: new Date(createdAt).toISOString()
  })).digest("hex");
  return { ...plan, stateRootBefore, inputRefs, referenceInputRefs, collateralInputRefs, outputs, requiredSignerHashes, feeLovelace: fee.toString(), digest };
}

import { createHash } from "node:crypto";
import { validateReceiptChain, type TestnetActionReceipt } from "./testnet-lifecycle-core";

const REQUIRED = ["COMMIT_NOTIONAL","FILL_NOTIONAL","COMMIT_NOTIONAL","CANCEL_NOTIONAL"] as const;

export type TestnetNotionalLifecycle = {
  market: string;
  receipts: TestnetActionReceipt[];
  fill: {
    side: "BUY" | "SELL";
    limitPrice: string;
    executionPrice: string;
    winningSolverId: string;
    competingSolverCount: number;
    solverFeeBps: number;
  };
};

type ExactDecimal = { units: bigint; scale: number; canonical: string };

function decimal(v: string, label: string): ExactDecimal {
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`${label} must be a positive decimal string`);
  const [whole, fraction = ""] = v.split(".");
  const units = BigInt(`${whole}${fraction}`);
  if (units <= 0n) throw new Error(`${label} must be positive`);
  const trimmedFraction = fraction.replace(/0+$/, "");
  const canonical = trimmedFraction ? `${BigInt(whole).toString()}.${trimmedFraction}` : BigInt(whole).toString();
  return { units: BigInt(`${whole}${trimmedFraction}`), scale: trimmedFraction.length, canonical };
}

function compare(a: ExactDecimal, b: ExactDecimal) {
  const scale = Math.max(a.scale, b.scale);
  const aa = a.units * 10n ** BigInt(scale - a.scale);
  const bb = b.units * 10n ** BigInt(scale - b.scale);
  return aa < bb ? -1 : aa > bb ? 1 : 0;
}

export function validateTestnetNotionalLifecycle(lifecycle: TestnetNotionalLifecycle, minimumConfirmations: number, nowMs = Date.now()) {
  if (!/^[A-Z0-9][A-Z0-9:_/-]{2,31}$/.test(lifecycle.market)) throw new Error("Invalid Notional market id");
  const actions = lifecycle.receipts.map((receipt) => receipt.action);
  if (actions.length !== REQUIRED.length || actions.some((action,index) => action !== REQUIRED[index])) throw new Error("Notional lifecycle must prove one fill and one independent cancel path");
  const limit = decimal(lifecycle.fill.limitPrice, "Limit price"), execution = decimal(lifecycle.fill.executionPrice, "Execution price");
  const comparison = compare(execution, limit);
  if (lifecycle.fill.side === "BUY" && comparison > 0) throw new Error("Notional BUY executed above committed limit");
  if (lifecycle.fill.side === "SELL" && comparison < 0) throw new Error("Notional SELL executed below committed limit");
  if (!/^[a-z0-9:_-]{3,64}$/i.test(lifecycle.fill.winningSolverId)) throw new Error("Invalid winning solver id");
  if (!Number.isInteger(lifecycle.fill.competingSolverCount) || lifecycle.fill.competingSolverCount < 2) throw new Error("Notional testnet fill requires at least two competing solvers");
  if (!Number.isInteger(lifecycle.fill.solverFeeBps) || lifecycle.fill.solverFeeBps < 0 || lifecycle.fill.solverFeeBps > 100) throw new Error("Solver fee exceeds testnet cap");
  const chain = validateReceiptChain(lifecycle.receipts, minimumConfirmations, nowMs);
  const root = createHash("sha256").update([lifecycle.market,lifecycle.fill.side,limit.canonical,execution.canonical,lifecycle.fill.winningSolverId,lifecycle.fill.competingSolverCount,lifecycle.fill.solverFeeBps,chain.root].join("|")).digest("hex");
  return { ...chain, market: lifecycle.market, root };
}

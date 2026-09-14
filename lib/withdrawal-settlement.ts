import { createHash } from "node:crypto";
import { assessFinality, type FinalityPolicy } from "./chain-finality";
import type { CardanoConfirmationProof } from "./chain-confirmation-v2";

export type WithdrawalTicket = {
  id: string;
  account: string;
  asset: string;
  amountUnits: string;
  requestedAtSlot: number;
  earliestSettlementSlot: number;
  accountStateRoot: string;
  riskRoot: string;
};

export type WithdrawalPolicy = {
  minimumDelaySlots: number;
  maxTicketUnits: string;
  rollingWindowSlots: number;
  maxWindowOutflowUnits: string;
  minimumPostWithdrawalHealthBps: number;
};

export type SettledWithdrawal = {
  id: string;
  amountUnits: string;
  settlementSlot: number;
};

function units(v: string, label: string) {
  if (!/^\d+$/.test(v)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(v);
}
function h64(v: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${label} must be SHA-256`);
  return v.toLowerCase();
}

export function withdrawalPolicyDigest(policy: WithdrawalPolicy) {
  if (!Number.isInteger(policy.minimumDelaySlots) || policy.minimumDelaySlots < 1) throw new Error("Invalid withdrawal delay");
  if (!Number.isInteger(policy.rollingWindowSlots) || policy.rollingWindowSlots < 1) throw new Error("Invalid withdrawal window");
  if (!Number.isInteger(policy.minimumPostWithdrawalHealthBps) || policy.minimumPostWithdrawalHealthBps < 10_000) throw new Error("Invalid withdrawal health floor");
  units(policy.maxTicketUnits, "Max withdrawal ticket"); units(policy.maxWindowOutflowUnits, "Max withdrawal outflow");
  return createHash("sha256").update([policy.minimumDelaySlots, policy.maxTicketUnits, policy.rollingWindowSlots, policy.maxWindowOutflowUnits, policy.minimumPostWithdrawalHealthBps].join("|")).digest("hex");
}

export function validateWithdrawalTicket(ticket: WithdrawalTicket, policy: WithdrawalPolicy) {
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(ticket.id)) throw new Error("Invalid withdrawal ticket id");
  if (!ticket.account.trim() || !ticket.asset.trim()) throw new Error("Withdrawal account and asset are required");
  const amount = units(ticket.amountUnits, "Withdrawal amount");
  if (amount <= 0n || amount > units(policy.maxTicketUnits, "Max ticket")) throw new Error("Withdrawal amount exceeds ticket policy");
  if (!Number.isInteger(ticket.requestedAtSlot) || ticket.requestedAtSlot < 1) throw new Error("Invalid withdrawal request slot");
  if (ticket.earliestSettlementSlot < ticket.requestedAtSlot + policy.minimumDelaySlots) throw new Error("Withdrawal delay is too short");
  h64(ticket.accountStateRoot, "Withdrawal account state root"); h64(ticket.riskRoot, "Withdrawal risk root");
  return ticket;
}

export function authorizeWithdrawalSettlement(input: {
  ticket: WithdrawalTicket;
  policy: WithdrawalPolicy;
  finalityProof: CardanoConfirmationProof;
  finalityPolicy: FinalityPolicy;
  currentSlot: number;
  postWithdrawalHealthBps: number;
  recentSettlements: SettledWithdrawal[];
  protocolPaused: boolean;
  nowMs?: number;
}) {
  const ticket = validateWithdrawalTicket(input.ticket, input.policy);
  if (input.protocolPaused) throw new Error("Withdrawals are frozen while protocol is paused");
  if (!Number.isInteger(input.currentSlot) || input.currentSlot < ticket.earliestSettlementSlot) throw new Error("Withdrawal maturity slot has not been reached");
  if (!Number.isInteger(input.postWithdrawalHealthBps) || input.postWithdrawalHealthBps < input.policy.minimumPostWithdrawalHealthBps) throw new Error("Post-withdrawal health is below policy");
  const finality = assessFinality(input.finalityProof, input.finalityPolicy, input.nowMs);
  if (finality.status !== "STABLE") throw new Error("Withdrawal request transaction is not stable");
  const windowStart = input.currentSlot - input.policy.rollingWindowSlots;
  const ids = input.recentSettlements.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new Error("Withdrawal history contains duplicate tickets");
  const recentOutflow = input.recentSettlements
    .filter((s) => s.settlementSlot >= windowStart && s.settlementSlot <= input.currentSlot)
    .reduce((sum, s) => sum + units(s.amountUnits, "Historical withdrawal"), 0n);
  const nextOutflow = recentOutflow + units(ticket.amountUnits, "Withdrawal amount");
  if (nextOutflow > units(input.policy.maxWindowOutflowUnits, "Window outflow cap")) throw new Error("Withdrawal rolling outflow cap exceeded");
  const digest = createHash("sha256").update([ticket.id, ticket.amountUnits, ticket.accountStateRoot.toLowerCase(), ticket.riskRoot.toLowerCase(), finality.digest, input.currentSlot, input.postWithdrawalHealthBps, withdrawalPolicyDigest(input.policy)].join("|")).digest("hex");
  return { authorized: true, digest, finalityDigest: finality.digest, rollingOutflowUnits: nextOutflow.toString() };
}

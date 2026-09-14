import { createHash } from "node:crypto";
import { buildProtocolStateRoot, type ProtocolStateCheckpoint } from "./protocol-state-root";
import { validateProtocolEconomics, type ProtocolEconomicsSnapshot } from "./protocol-economics";
import { oracleIndependencePolicyRoot, type OracleIndependencePolicy } from "./oracle-independence";
import { settlementDisputeRoot, type SettlementDisputeCase, type SettlementDisputePolicy } from "./settlement-disputes";
import { operatorAccountabilityRoot, type OperatorBondState } from "./operator-accountability";

export type GlobalInvariantSnapshot = {
  checkpoint: ProtocolStateCheckpoint;
  economics: ProtocolEconomicsSnapshot;
  oraclePolicy: OracleIndependencePolicy;
  settlementCases: SettlementDisputeCase[];
  disputePolicy: SettlementDisputePolicy;
  accountableOperators: OperatorBondState[];
  appliedFaultProofDigests: string[];
  generatedAt: string;
};

function units(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(value);
}

export function buildGlobalInvariantSnapshot(snapshot: GlobalInvariantSnapshot, nowMs = Date.now()) {
  const generatedAt = new Date(snapshot.generatedAt).getTime();
  if (!Number.isFinite(generatedAt) || generatedAt > nowMs + 60_000) throw new Error("Invalid global invariant timestamp");
  if (new Date(snapshot.checkpoint.generatedAt).getTime() > generatedAt) throw new Error("Protocol checkpoint cannot post-date global invariant snapshot");
  if (new Date(snapshot.economics.generatedAt).getTime() > generatedAt) throw new Error("Economics snapshot cannot post-date global invariant snapshot");

  const checkpoint = buildProtocolStateRoot(snapshot.checkpoint);
  const economics = validateProtocolEconomics(snapshot.economics, nowMs);
  if (snapshot.economics.epoch !== snapshot.checkpoint.deploymentEpoch) throw new Error("Economics epoch does not match protocol checkpoint");
  if (economics.insuranceClosingUnits !== units(snapshot.checkpoint.accounting.insuranceUnits, "Checkpoint insurance")) {
    throw new Error("Economics insurance reserve does not match canonical checkpoint accounting");
  }

  const oraclePolicyRoot = oracleIndependencePolicyRoot(snapshot.oraclePolicy);
  const disputeRoot = settlementDisputeRoot(snapshot.settlementCases, snapshot.disputePolicy, nowMs);
  const accountabilityRoot = operatorAccountabilityRoot({ states: snapshot.accountableOperators, appliedProofDigests: snapshot.appliedFaultProofDigests });

  const custody = units(snapshot.checkpoint.accounting.custodyUnits, "Custody");
  const insurance = units(snapshot.checkpoint.accounting.insuranceUnits, "Insurance");
  const liabilities =
    units(snapshot.checkpoint.accounting.userEquityLiabilityUnits, "User equity liability") +
    units(snapshot.checkpoint.accounting.pendingWithdrawalUnits, "Pending withdrawals") +
    units(snapshot.checkpoint.accounting.badDebtUnits, "Bad debt") +
    units(snapshot.checkpoint.accounting.optionPayoutLiabilityUnits, "Option payout liability") +
    units(snapshot.checkpoint.accounting.notionalEscrowUnits, "Notional escrow");
  const assets = custody + insurance;
  if (assets < liabilities) throw new Error("Global invariant snapshot is insolvent");
  const surplus = assets - liabilities;

  const root = createHash("sha256").update([
    snapshot.checkpoint.deploymentEpoch,
    checkpoint.root,
    economics.root,
    oraclePolicyRoot,
    disputeRoot,
    accountabilityRoot,
    assets.toString(),
    liabilities.toString(),
    surplus.toString(),
    new Date(generatedAt).toISOString()
  ].join("|")).digest("hex");

  return {
    verified: true,
    root,
    stateRoot: checkpoint.root,
    economicsRoot: economics.root,
    oraclePolicyRoot,
    disputeRoot,
    accountabilityRoot,
    assetsUnits: assets,
    liabilitiesUnits: liabilities,
    surplusUnits: surplus
  };
}

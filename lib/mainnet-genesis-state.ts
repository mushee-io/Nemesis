import { createHash } from "node:crypto";

export type MainnetGenesisState = {
  deploymentEpoch: number;
  custodySeedUnits: string;
  insuranceSeedUnits: string;
  userLiabilityUnits: string;
  pendingWithdrawalUnits: string;
  openPerpPositions: number;
  openOptionSeries: number;
  openNotionalIntents: number;
  generatedAt: string;
};

function units(v: string, label: string) {
  if (!/^\d+$/.test(v)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(v);
}

export function buildMainnetGenesisRoot(state: MainnetGenesisState) {
  if (!Number.isInteger(state.deploymentEpoch) || state.deploymentEpoch < 1) throw new Error("Invalid mainnet genesis epoch");
  const custody = units(state.custodySeedUnits, "Genesis custody");
  const insurance = units(state.insuranceSeedUnits, "Genesis insurance");
  const liabilities = units(state.userLiabilityUnits, "Genesis user liabilities");
  const withdrawals = units(state.pendingWithdrawalUnits, "Genesis pending withdrawals");
  if (liabilities !== 0n || withdrawals !== 0n) throw new Error("Mainnet genesis cannot begin with user liabilities or pending withdrawals");
  if ([state.openPerpPositions, state.openOptionSeries, state.openNotionalIntents].some((value) => !Number.isInteger(value) || value !== 0)) throw new Error("Mainnet genesis must begin with zero live product state");
  if (insurance > custody) throw new Error("Genesis insurance seed cannot exceed custody seed");
  const generatedAt = new Date(state.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) throw new Error("Invalid mainnet genesis timestamp");
  const root = createHash("sha256").update([
    state.deploymentEpoch, custody.toString(), insurance.toString(), liabilities.toString(), withdrawals.toString(),
    state.openPerpPositions, state.openOptionSeries, state.openNotionalIntents, new Date(generatedAt).toISOString()
  ].join("|")).digest("hex");
  return { root, custodyUnits: custody, insuranceUnits: insurance, generatedAt: new Date(generatedAt).toISOString() };
}

export type SolvencySnapshot = {
  custodyUnits: bigint;
  insuranceUnits: bigint;
  userEquityLiabilityUnits: bigint;
  optionPayoutLiabilityUnits: bigint;
  pendingWithdrawalUnits: bigint;
  badDebtUnits: bigint;
  lockedPerpMarginUnits: bigint;
  lockedOptionCollateralUnits: bigint;
};

export type SolvencyPolicy = {
  minimumCoverageBps: number;
  minimumInsuranceCoverageBps: number;
  maximumBadDebtBps: number;
};

export const DEFAULT_SOLVENCY_POLICY: SolvencyPolicy = {
  minimumCoverageBps: 10_000,
  minimumInsuranceCoverageBps: 10_000,
  maximumBadDebtBps: 100
};

function nonNegative(value: bigint, label: string) {
  if (value < 0n) throw new Error(`${label} cannot be negative`);
}

function ratioBps(numerator: bigint, denominator: bigint) {
  if (denominator === 0n) return 100_000;
  return Number(numerator * 10_000n / denominator);
}

export function evaluateProtocolSolvency(
  snapshot: SolvencySnapshot,
  policy: SolvencyPolicy = DEFAULT_SOLVENCY_POLICY
) {
  for (const [label, value] of Object.entries(snapshot) as [keyof SolvencySnapshot, bigint][]) {
    nonNegative(value, label);
  }
  if (!Number.isInteger(policy.minimumCoverageBps) || policy.minimumCoverageBps < 10_000) {
    throw new Error("Minimum solvency coverage must be at least 100%");
  }
  if (!Number.isInteger(policy.minimumInsuranceCoverageBps) || policy.minimumInsuranceCoverageBps < 0) {
    throw new Error("Invalid insurance coverage policy");
  }
  if (!Number.isInteger(policy.maximumBadDebtBps) || policy.maximumBadDebtBps < 0) {
    throw new Error("Invalid bad-debt policy");
  }

  const assets = snapshot.custodyUnits + snapshot.insuranceUnits;
  const liabilities =
    snapshot.userEquityLiabilityUnits +
    snapshot.optionPayoutLiabilityUnits +
    snapshot.pendingWithdrawalUnits +
    snapshot.badDebtUnits;
  const locked = snapshot.lockedPerpMarginUnits + snapshot.lockedOptionCollateralUnits;
  if (locked > snapshot.custodyUnits) throw new Error("Locked collateral exceeds custody");

  const coverageBps = ratioBps(assets, liabilities);
  const insuranceCoverageBps = ratioBps(snapshot.insuranceUnits, snapshot.badDebtUnits);
  const badDebtBps = ratioBps(snapshot.badDebtUnits, assets);

  if (coverageBps < policy.minimumCoverageBps) throw new Error("Protocol is undercollateralized");
  if (snapshot.badDebtUnits > 0n && insuranceCoverageBps < policy.minimumInsuranceCoverageBps) {
    throw new Error("Insurance coverage is below policy");
  }
  if (badDebtBps > policy.maximumBadDebtBps) throw new Error("Bad debt exceeds protocol policy");

  return {
    solvent: true,
    assets,
    liabilities,
    locked,
    freeCustodyUnits: snapshot.custodyUnits - locked,
    coverageBps,
    insuranceCoverageBps,
    badDebtBps
  };
}

export function assertCollateralConservation(input: {
  beforeUnits: bigint;
  afterUnits: bigint;
  externalInUnits?: bigint;
  externalOutUnits?: bigint;
  feeUnits?: bigint;
  toleratedRoundingUnits?: bigint;
}) {
  const externalIn = input.externalInUnits ?? 0n;
  const externalOut = input.externalOutUnits ?? 0n;
  const fee = input.feeUnits ?? 0n;
  const tolerance = input.toleratedRoundingUnits ?? 0n;
  for (const [label, value] of Object.entries({
    beforeUnits: input.beforeUnits,
    afterUnits: input.afterUnits,
    externalIn,
    externalOut,
    fee,
    tolerance
  })) nonNegative(value, label);

  const left = input.beforeUnits + externalIn;
  const right = input.afterUnits + externalOut + fee;
  const delta = left >= right ? left - right : right - left;
  if (delta > tolerance) throw new Error("Collateral conservation invariant failed");
  return { conserved: true, deltaUnits: delta };
}

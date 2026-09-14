import assert from "node:assert/strict";
import test from "node:test";
import { buildCriticalLiquidationPlan } from "../lib/critical-liquidation";
import { authorizeOperatorSetChange, operatorSetRoot, type OperatorSet } from "../lib/operator-set-governance";

const NOW = new Date("2026-09-14T10:00:00.000Z").getTime();
const liquidationPolicy = { minimumQuotes: 2, maxCloseBps: 5_000, maxPriceImpactBps: 200, maxKeeperFeeBps: 50, minimumKeeperBondUnits: "1000", insuranceFloorUnits: "5000", maxInsuranceDrawUnits: "3000", allowAdl: true };

function operators(epoch = 1): OperatorSet {
  const roles = [
    ["gov-a", "1", ["GOVERNOR"]], ["gov-b", "2", ["GOVERNOR"]], ["guardian-a", "3", ["GUARDIAN"]],
    ["oracle-a", "4", ["ORACLE"]], ["oracle-b", "5", ["ORACLE"]], ["keeper-a", "6", ["KEEPER"]],
    ["keeper-b", "7", ["KEEPER"]], ["solver-a", "8", ["SOLVER"]], ["solver-b", "9", ["SOLVER"]], ["builder-a", "a", ["BUILDER"]]
  ] as const;
  return {
    epoch,
    members: roles.map(([id, char, memberRoles]) => ({ id, credentialDigest: char.repeat(64), roles: [...memberRoles], activeFromSlot: 1_000 })),
    thresholds: { GOVERNOR: 2, GUARDIAN: 1, ORACLE: 2, KEEPER: 2, SOLVER: 2, BUILDER: 1 }
  };
}

test("milestone 64 chooses the best bounded liquidation quote", () => {
  const result = buildCriticalLiquidationPlan({
    position: { positionId: "btc-long-1", account: "account-a", side: "LONG", notionalUnits: "10000", collateralUnits: "1000", equityUnits: "300", maintenanceMarginUnits: "500", markPrice: 60_000, indexPrice: 60_050 },
    quotes: [
      { keeperId: "keeper-a", closeNotionalUnits: "5000", executionPrice: 59_900, keeperFeeBps: 25, bondUnits: "2000", submittedAt: new Date(NOW - 5_000).toISOString() },
      { keeperId: "keeper-b", closeNotionalUnits: "5000", executionPrice: 59_950, keeperFeeBps: 20, bondUnits: "2000", submittedAt: new Date(NOW - 4_000).toISOString() }
    ],
    policy: liquidationPolicy, insuranceAvailableUnits: "8000", badDebtUnits: "2000", nowMs: NOW
  });
  assert.equal(result.winner.keeperId, "keeper-b");
  assert.equal(result.insuranceDrawUnits, "2000");
  assert.equal(result.residualBadDebtUnits, "0");
});

test("milestone 64 rejects unbonded liquidation execution", () => {
  assert.throws(() => buildCriticalLiquidationPlan({
    position: { positionId: "btc-short-1", account: "account-b", side: "SHORT", notionalUnits: "10000", collateralUnits: "1000", equityUnits: "200", maintenanceMarginUnits: "500", markPrice: 60_000, indexPrice: 60_050 },
    quotes: [{ keeperId: "keeper-a", closeNotionalUnits: "5000", executionPrice: 60_100, keeperFeeBps: 25, bondUnits: "100", submittedAt: new Date(NOW).toISOString() }],
    policy: liquidationPolicy, insuranceAvailableUnits: "8000", badDebtUnits: "0", nowMs: NOW
  }), /eligible liquidation quotes/);
});

test("milestone 65 operator governance enforces role separation and overlap", () => {
  const previous = operators(1), next = operators(2);
  next.members = next.members.map((m) => ({ ...m, activeFromSlot: 2_000 }));
  const change = { id: "operator-change-1", previousRoot: operatorSetRoot(previous), next, retiredCredentials: [], emergency: false, governorApprovals: ["gov-a", "gov-b"], guardianApprovals: [], activateAtSlot: 2_000 };
  const result = authorizeOperatorSetChange(previous, change, { governorQuorum: 2, guardianQuorum: 1, minimumOverlapSlots: 100, minimumOracleMembers: 2, minimumKeeperMembers: 2, minimumSolverMembers: 2 }, 1_500);
  assert.equal(result.epoch, 2);
  const invalid = operators(1); invalid.members[0].roles.push("GUARDIAN");
  assert.throws(() => operatorSetRoot(invalid), /separated/);
});

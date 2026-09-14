import { createHash } from "node:crypto";

export type MainnetLaunchPhase = "CANDIDATE" | "CANARY_1" | "CANARY_10" | "CANARY_50" | "LIVE" | "PAUSED" | "ROLLED_BACK";

export type MainnetLaunchEvidence = {
  sourcePreprodDigest: string;
  migrationDigest: string;
  registryDigest: string;
  riskRoot: string;
  operatorRoot: string;
  settlementRoot: string;
  finalityDigest?: string;
  canaryMetricsDigest?: string;
  incidentDrillDigest?: string;
  manualApprovalDigest?: string;
};

export type MainnetLaunchState = {
  launchId: string;
  phase: MainnetLaunchPhase;
  deploymentEpoch: number;
  generation: number;
  exposureBps: number;
  maxNotionalUnits: string;
  enteredAt: string;
  evidence: MainnetLaunchEvidence;
  previousStateDigest?: string;
};

export type MainnetLaunchPolicy = {
  maxCandidateNotionalUnits: string;
  maxCanary1NotionalUnits: string;
  maxCanary10NotionalUnits: string;
  maxCanary50NotionalUnits: string;
  minimumLiveDelayMs: number;
};

const NEXT: Partial<Record<MainnetLaunchPhase, MainnetLaunchPhase>> = {
  CANDIDATE: "CANARY_1",
  CANARY_1: "CANARY_10",
  CANARY_10: "CANARY_50",
  CANARY_50: "LIVE"
};

const EXPOSURE_CAP: Record<Exclude<MainnetLaunchPhase, "PAUSED" | "ROLLED_BACK">, number> = {
  CANDIDATE: 0,
  CANARY_1: 100,
  CANARY_10: 1_000,
  CANARY_50: 5_000,
  LIVE: 10_000
};

function digest64(value: string | undefined, label: string) {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function units(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string`);
  return BigInt(value);
}

function canonical(state: MainnetLaunchState) {
  return [
    state.launchId,
    state.phase,
    state.deploymentEpoch,
    state.generation,
    state.exposureBps,
    state.maxNotionalUnits,
    state.previousStateDigest?.toLowerCase() ?? "GENESIS",
    state.evidence.sourcePreprodDigest.toLowerCase(),
    state.evidence.migrationDigest.toLowerCase(),
    state.evidence.registryDigest.toLowerCase(),
    state.evidence.riskRoot.toLowerCase(),
    state.evidence.operatorRoot.toLowerCase(),
    state.evidence.settlementRoot.toLowerCase(),
    state.evidence.finalityDigest?.toLowerCase() ?? "",
    state.evidence.canaryMetricsDigest?.toLowerCase() ?? "",
    state.evidence.incidentDrillDigest?.toLowerCase() ?? "",
    state.evidence.manualApprovalDigest?.toLowerCase() ?? "",
    state.enteredAt
  ].join("|");
}

export function mainnetLaunchDigest(state: MainnetLaunchState) {
  return createHash("sha256").update(canonical(state)).digest("hex");
}

function validateEvidence(state: MainnetLaunchState) {
  digest64(state.evidence.sourcePreprodDigest, "Source Preprod digest");
  digest64(state.evidence.migrationDigest, "Migration digest");
  digest64(state.evidence.registryDigest, "Registry digest");
  digest64(state.evidence.riskRoot, "Risk root");
  digest64(state.evidence.operatorRoot, "Operator root");
  digest64(state.evidence.settlementRoot, "Settlement root");
  if (["CANARY_1", "CANARY_10", "CANARY_50", "LIVE"].includes(state.phase)) {
    digest64(state.evidence.finalityDigest, "Mainnet finality digest");
    digest64(state.evidence.canaryMetricsDigest, "Canary metrics digest");
  }
  if (state.phase === "LIVE") {
    digest64(state.evidence.incidentDrillDigest, "Incident drill digest");
    digest64(state.evidence.manualApprovalDigest, "Manual approval digest");
  }
}

function phaseNotionalLimit(phase: MainnetLaunchPhase, policy: MainnetLaunchPolicy) {
  if (phase === "CANDIDATE") return units(policy.maxCandidateNotionalUnits, "Candidate notional cap");
  if (phase === "CANARY_1") return units(policy.maxCanary1NotionalUnits, "Canary 1 notional cap");
  if (phase === "CANARY_10") return units(policy.maxCanary10NotionalUnits, "Canary 10 notional cap");
  if (phase === "CANARY_50") return units(policy.maxCanary50NotionalUnits, "Canary 50 notional cap");
  return null;
}

export function validateMainnetLaunchTransition(input: {
  previous?: MainnetLaunchState;
  next: MainnetLaunchState;
  policy: MainnetLaunchPolicy;
  emergency?: boolean;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const next = input.next;
  if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(next.launchId)) throw new Error("Invalid mainnet launch id");
  if (!Number.isInteger(next.deploymentEpoch) || next.deploymentEpoch < 1) throw new Error("Invalid mainnet deployment epoch");
  if (!Number.isInteger(next.generation) || next.generation < 1) throw new Error("Invalid mainnet launch generation");
  if (!Number.isInteger(next.exposureBps) || next.exposureBps < 0 || next.exposureBps > 10_000) throw new Error("Invalid mainnet exposure cap");
  const enteredAt = new Date(next.enteredAt).getTime();
  if (!Number.isFinite(enteredAt) || enteredAt > nowMs + 60_000) throw new Error("Invalid mainnet launch entry time");
  const nextNotional = units(next.maxNotionalUnits, "Mainnet launch notional cap");
  validateEvidence(next);

  if (!["PAUSED", "ROLLED_BACK"].includes(next.phase)) {
    const cap = EXPOSURE_CAP[next.phase];
    if (next.exposureBps > cap) throw new Error(`${next.phase} exposure exceeds ${cap} bps`);
    const notionalLimit = phaseNotionalLimit(next.phase, input.policy);
    if (notionalLimit != null && nextNotional > notionalLimit) throw new Error(`${next.phase} notional exceeds launch policy`);
  }

  if (!input.previous) {
    if (next.phase !== "CANDIDATE") throw new Error("Mainnet lifecycle must start in CANDIDATE");
    if (next.generation !== 1) throw new Error("Mainnet candidate generation must start at one");
    if (next.previousStateDigest) throw new Error("Mainnet candidate cannot reference a predecessor");
  } else {
    const previous = input.previous;
    if (previous.launchId !== next.launchId) throw new Error("Mainnet launch id changed");
    if (previous.deploymentEpoch !== next.deploymentEpoch) throw new Error("Mainnet promotion cannot change deployment epoch");
    if (next.generation !== previous.generation + 1) throw new Error("Mainnet generation must increase exactly once");
    if (!next.previousStateDigest || next.previousStateDigest.toLowerCase() !== mainnetLaunchDigest(previous)) {
      throw new Error("Mainnet launch predecessor digest mismatch");
    }
    if (enteredAt <= new Date(previous.enteredAt).getTime()) throw new Error("Mainnet launch time must advance");

    for (const key of ["sourcePreprodDigest", "migrationDigest", "riskRoot", "operatorRoot", "settlementRoot"] as const) {
      if (previous.evidence[key].toLowerCase() !== next.evidence[key].toLowerCase()) throw new Error(`Mainnet ${key} changed during promotion`);
    }

    if (input.emergency) {
      if (!["PAUSED", "ROLLED_BACK"].includes(next.phase)) throw new Error("Emergency mainnet transition must pause or roll back");
    } else {
      const expected = NEXT[previous.phase];
      if (!expected || next.phase !== expected) throw new Error(`Invalid mainnet launch transition ${previous.phase} -> ${next.phase}`);
      if (next.exposureBps < previous.exposureBps) throw new Error("Normal mainnet promotion cannot reduce declared exposure cap");
      if (nextNotional < units(previous.maxNotionalUnits, "Previous mainnet notional cap")) throw new Error("Normal mainnet promotion cannot reduce declared notional cap");
      if (next.phase === "LIVE" && enteredAt - new Date(previous.enteredAt).getTime() < input.policy.minimumLiveDelayMs) {
        throw new Error("Mainnet LIVE promotion has not satisfied the minimum observation delay");
      }
    }
  }

  return { verified: true, phase: next.phase, digest: mainnetLaunchDigest(next), generation: next.generation };
}

import { createHash } from "node:crypto";
import type { CardanoNetwork } from "./cardano-execution";

export type DeploymentEpochState = {
  network: CardanoNetwork;
  epoch: number;
  epochId: string;
  previousEpochDigest?: string;
  parameterSchemaSha256: string;
  parameterizedDeploymentSha256: string;
  referenceScriptBundleSha256: string;
  releaseAttestationSha256: string;
  governorSetSha256: string;
  activatedAt: string;
};

function digest64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function canonicalEpoch(state: DeploymentEpochState) {
  return [
    state.network,
    state.epoch,
    state.epochId,
    state.previousEpochDigest?.toLowerCase() ?? "GENESIS",
    state.parameterSchemaSha256.toLowerCase(),
    state.parameterizedDeploymentSha256.toLowerCase(),
    state.referenceScriptBundleSha256.toLowerCase(),
    state.releaseAttestationSha256.toLowerCase(),
    state.governorSetSha256.toLowerCase(),
    state.activatedAt
  ].join("|");
}

export function deploymentEpochDigest(state: DeploymentEpochState) {
  return createHash("sha256").update(canonicalEpoch(state)).digest("hex");
}

export function validateDeploymentEpoch(input: {
  current: DeploymentEpochState;
  previous?: DeploymentEpochState;
  expectedNetwork: CardanoNetwork;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const current = input.current;
  if (current.network !== input.expectedNetwork) throw new Error("Deployment epoch network mismatch");
  if (!Number.isInteger(current.epoch) || current.epoch < 1) throw new Error("Invalid deployment epoch number");
  if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(current.epochId)) throw new Error("Invalid deployment epoch id");
  for (const [value, label] of [
    [current.parameterSchemaSha256, "parameter schema"],
    [current.parameterizedDeploymentSha256, "parameterized deployment"],
    [current.referenceScriptBundleSha256, "reference script bundle"],
    [current.releaseAttestationSha256, "release attestation"],
    [current.governorSetSha256, "governor set"]
  ] as const) digest64(value, label);

  const activatedAt = new Date(current.activatedAt).getTime();
  if (!Number.isFinite(activatedAt)) throw new Error("Invalid deployment epoch activation time");
  if (activatedAt > nowMs + 60_000) throw new Error("Deployment epoch is future-dated");

  if (!input.previous) {
    if (current.epoch !== 1) throw new Error("Genesis deployment epoch must be epoch 1");
    if (current.previousEpochDigest) throw new Error("Genesis deployment epoch cannot reference a predecessor");
  } else {
    const previous = input.previous;
    if (previous.network !== current.network) throw new Error("Deployment epoch chain changed network");
    if (current.epoch !== previous.epoch + 1) throw new Error("Deployment epoch must increase exactly once");
    if (!current.previousEpochDigest) throw new Error("Deployment epoch predecessor digest is required");
    digest64(current.previousEpochDigest, "previous deployment epoch");
    const expectedPrevious = deploymentEpochDigest(previous);
    if (current.previousEpochDigest.toLowerCase() !== expectedPrevious) throw new Error("Deployment epoch predecessor digest mismatch");
    if (activatedAt <= new Date(previous.activatedAt).getTime()) throw new Error("Deployment epoch activation must be monotonic");
    if (current.epochId === previous.epochId) throw new Error("Deployment epoch id cannot be reused");
    if (current.releaseAttestationSha256.toLowerCase() === previous.releaseAttestationSha256.toLowerCase()) throw new Error("Release attestation cannot be replayed across deployment epochs");
  }

  const digest = deploymentEpochDigest(current);
  return { verified: true, digest, epoch: current.epoch, epochId: current.epochId };
}

export class DeploymentEpochRegistry {
  private latest?: DeploymentEpochState;
  private readonly seenDigests = new Set<string>();
  private readonly seenAttestations = new Set<string>();

  append(state: DeploymentEpochState, expectedNetwork: CardanoNetwork, nowMs = Date.now()) {
    if (this.seenAttestations.has(state.releaseAttestationSha256.toLowerCase())) throw new Error("Release attestation has already been consumed by an epoch");
    const verified = validateDeploymentEpoch({ current: state, previous: this.latest, expectedNetwork, nowMs });
    if (this.seenDigests.has(verified.digest)) throw new Error("Deployment epoch digest already exists");
    this.latest = state;
    this.seenDigests.add(verified.digest);
    this.seenAttestations.add(state.releaseAttestationSha256.toLowerCase());
    return verified;
  }

  current() {
    return this.latest;
  }
}

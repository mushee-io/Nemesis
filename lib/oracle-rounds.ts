export type OracleRound = {
  market: string;
  roundId: number;
  price: number;
  timestamp: string;
  sources: string[];
  quorum: number;
  digest: string;
};

export type OracleRoundPolicy = {
  minimumSources: number;
  maximumAgeMs: number;
  maximumFutureSkewMs: number;
  maximumJumpBps: number;
};

const DEFAULT_POLICY: OracleRoundPolicy = {
  minimumSources: 2,
  maximumAgeMs: 30_000,
  maximumFutureSkewMs: 5_000,
  maximumJumpBps: 1_000
};

function normalizeMarket(value: string) {
  const market = value.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{3,32}$/.test(market)) throw new Error("Invalid oracle market");
  return market;
}

export function validateOracleRound(round: OracleRound, nowMs = Date.now(), policy: OracleRoundPolicy = DEFAULT_POLICY) {
  normalizeMarket(round.market);
  if (!Number.isInteger(round.roundId) || round.roundId <= 0) throw new Error("Oracle round id must be positive");
  if (!Number.isFinite(round.price) || round.price <= 0) throw new Error("Oracle round price must be positive");
  if (!/^[0-9a-f]{64}$/i.test(round.digest)) throw new Error("Oracle round digest must be SHA-256 hex");
  const timestampMs = new Date(round.timestamp).getTime();
  if (!Number.isFinite(timestampMs)) throw new Error("Invalid oracle round timestamp");
  if (timestampMs > nowMs + policy.maximumFutureSkewMs) throw new Error("Oracle round is future-dated");
  if (nowMs - timestampMs > policy.maximumAgeMs) throw new Error("Oracle round is stale");
  const sources = round.sources.map((source) => source.trim().toLowerCase()).filter(Boolean);
  if (new Set(sources).size !== sources.length) throw new Error("Oracle round contains duplicate sources");
  if (!Number.isInteger(round.quorum) || round.quorum < policy.minimumSources || round.quorum > sources.length) throw new Error("Oracle round quorum is invalid");
  if (sources.length < policy.minimumSources) throw new Error("Oracle round has insufficient independent sources");
  return { ...round, market: normalizeMarket(round.market), sources, timestampMs };
}

export class OracleRoundRegistry {
  private readonly latest = new Map<string, OracleRound>();

  accept(round: OracleRound, nowMs = Date.now(), policy: OracleRoundPolicy = DEFAULT_POLICY) {
    const validated = validateOracleRound(round, nowMs, policy);
    const previous = this.latest.get(validated.market);
    if (previous) {
      if (validated.roundId <= previous.roundId) throw new Error("Oracle round replay or rollback detected");
      const jumpBps = Math.abs(validated.price - previous.price) / previous.price * 10_000;
      if (jumpBps > policy.maximumJumpBps) throw new Error("Oracle round jump exceeds policy");
      if (new Date(validated.timestamp).getTime() <= new Date(previous.timestamp).getTime()) throw new Error("Oracle round timestamp must increase");
    }
    this.latest.set(validated.market, round);
    return { accepted: true, market: validated.market, roundId: validated.roundId };
  }

  get(market: string) {
    return this.latest.get(normalizeMarket(market));
  }
}

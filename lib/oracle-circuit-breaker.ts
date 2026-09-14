import { aggregateOracleQuorum, type NamedOracleSample, type OracleQuorumConfig } from "./oracle-quorum";

export type OracleObservation = {
  price: number;
  timestampMs: number;
  sources: string[];
};

export type OracleCircuitBreakerConfig = {
  quorum?: OracleQuorumConfig;
  maxJumpBps: number;
  jumpWindowMs: number;
  minSourceOverlap: number;
  twapWindowMs: number;
  maxTwapDeviationBps: number;
};

export const DEFAULT_ORACLE_CIRCUIT_BREAKER: OracleCircuitBreakerConfig = {
  maxJumpBps: 500,
  jumpWindowMs: 60_000,
  minSourceOverlap: 1,
  twapWindowMs: 5 * 60_000,
  maxTwapDeviationBps: 350
};

function bpsDeviation(a: number, b: number) {
  return Math.abs(a - b) / b * 10_000;
}

export function calculateTwap(observations: OracleObservation[], nowMs: number, windowMs: number) {
  const eligible = observations
    .filter((item) => item.timestampMs <= nowMs && nowMs - item.timestampMs <= windowMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  if (eligible.length === 0) throw new Error("Oracle TWAP history unavailable");
  if (eligible.length === 1) return eligible[0].price;

  let weighted = 0;
  let total = 0;
  for (let i = 0; i < eligible.length; i += 1) {
    const start = Math.max(nowMs - windowMs, eligible[i].timestampMs);
    const end = i + 1 < eligible.length ? eligible[i + 1].timestampMs : nowMs;
    const duration = Math.max(1, end - start);
    weighted += eligible[i].price * duration;
    total += duration;
  }
  return weighted / total;
}

export function validateOracleCircuitBreaker(input: {
  samples: NamedOracleSample[];
  history: OracleObservation[];
  nowMs?: number;
  config?: OracleCircuitBreakerConfig;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const config = input.config ?? DEFAULT_ORACLE_CIRCUIT_BREAKER;
  const quorum = aggregateOracleQuorum({ samples: input.samples, config: config.quorum, nowMs });
  const previous = [...input.history].filter((item) => item.timestampMs <= nowMs).sort((a, b) => b.timestampMs - a.timestampMs)[0];

  if (previous && nowMs - previous.timestampMs <= config.jumpWindowMs) {
    const jump = bpsDeviation(quorum.price, previous.price);
    if (jump > config.maxJumpBps) throw new Error("Oracle circuit breaker rejected abrupt price jump");
    const overlap = quorum.sources.filter((source) => previous.sources.includes(source)).length;
    if (overlap < config.minSourceOverlap) throw new Error("Oracle circuit breaker rejected source-set discontinuity");
  }

  if (input.history.length > 0) {
    const twap = calculateTwap(input.history, nowMs, config.twapWindowMs);
    if (bpsDeviation(quorum.price, twap) > config.maxTwapDeviationBps) {
      throw new Error("Oracle circuit breaker rejected excessive TWAP deviation");
    }
  }

  return {
    ...quorum,
    observation: { price: quorum.price, timestampMs: nowMs, sources: quorum.sources } satisfies OracleObservation
  };
}

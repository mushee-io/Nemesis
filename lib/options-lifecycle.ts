import { settleEuropeanOption, type OptionSeries } from "./options";
import { aggregateOracleQuorum, type NamedOracleSample, type OracleQuorumConfig } from "./oracle-quorum";

export type OptionLifecycleState = "ACTIVE" | "EXPIRED_UNSETTLED" | "SETTLED";

export type OptionSettlementRecord = {
  settlementId: string;
  seriesId: string;
  holder: string;
  contracts: number;
  settlementPrice: number;
  payout: number;
  oracleSources: string[];
  settledAt: string;
};

export function optionSeriesId(series: OptionSeries) {
  return [series.underlying.toUpperCase(), series.kind, series.strike, series.expiry, series.contractSize, series.settlementAsset.toUpperCase()].join(":");
}

export function getOptionLifecycleState(input: {
  series: OptionSeries;
  settled?: boolean;
  nowMs?: number;
}): OptionLifecycleState {
  if (input.settled) return "SETTLED";
  const expiryMs = new Date(input.series.expiry).getTime();
  if (!Number.isFinite(expiryMs)) throw new Error("Invalid option expiry");
  return (input.nowMs ?? Date.now()) >= expiryMs ? "EXPIRED_UNSETTLED" : "ACTIVE";
}

export class OptionSettlementRegistry {
  private readonly ids = new Set<string>();

  has(settlementId: string) {
    return this.ids.has(settlementId);
  }

  consume(settlementId: string) {
    if (this.ids.has(settlementId)) throw new Error("Option settlement already consumed");
    this.ids.add(settlementId);
  }
}

export function authorizeOptionSettlement(input: {
  series: OptionSeries;
  holder: string;
  contracts: number;
  oracleSamples: NamedOracleSample[];
  oracleConfig?: OracleQuorumConfig;
  registry?: OptionSettlementRegistry;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  if (!input.holder.trim()) throw new Error("Option holder is required");
  if (!Number.isFinite(input.contracts) || input.contracts <= 0) throw new Error("Invalid option contract count");
  if (getOptionLifecycleState({ series: input.series, nowMs }) !== "EXPIRED_UNSETTLED") throw new Error("Option series is not ready for settlement");

  const seriesId = optionSeriesId(input.series);
  const settlementId = `${seriesId}:${input.holder.toLowerCase()}`;
  if (input.registry?.has(settlementId)) throw new Error("Option settlement already consumed");

  const oracle = aggregateOracleQuorum({ samples: input.oracleSamples, config: input.oracleConfig, nowMs });
  const result = settleEuropeanOption({
    series: input.series,
    contracts: input.contracts,
    settlementPrice: oracle.price,
    now: new Date(nowMs).toISOString()
  });

  return {
    settlementId,
    seriesId,
    holder: input.holder,
    contracts: input.contracts,
    settlementPrice: oracle.price,
    payout: result.payout,
    oracleSources: oracle.sources,
    settledAt: new Date(nowMs).toISOString()
  } satisfies OptionSettlementRecord;
}

export function commitOptionSettlement(registry: OptionSettlementRegistry, record: OptionSettlementRecord) {
  registry.consume(record.settlementId);
  return record;
}

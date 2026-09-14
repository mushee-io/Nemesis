export type ChainTxState = "SUBMITTED" | "CONFIRMED" | "FAILED";

export type IndexedTx = {
  txHash: string;
  state: ChainTxState;
  slot?: number;
  blockHeight?: number;
  updatedAt: string;
};

export type ProtocolEvent = {
  id: string;
  txHash: string;
  market: string;
  type: "COLLATERAL_DEPOSIT" | "COLLATERAL_WITHDRAWAL" | "PERP_OPEN" | "PERP_CLOSE" | "LIQUIDATION" | "OPTION_OPEN" | "OPTION_SETTLE" | "NOTIONAL_SETTLE";
  account: string;
  quantity?: number;
  valueUsd?: number;
  timestamp: string;
};

export type IndexerSnapshot = {
  lastSlot: number;
  transactions: Record<string, IndexedTx>;
  events: ProtocolEvent[];
};

export function emptyIndexerSnapshot(): IndexerSnapshot {
  return { lastSlot: 0, transactions: {}, events: [] };
}

export function reduceIndexerSnapshot(snapshot: IndexerSnapshot, update: {
  transaction?: IndexedTx;
  events?: ProtocolEvent[];
  slot?: number;
}): IndexerSnapshot {
  const transactions = { ...snapshot.transactions };
  if (update.transaction) {
    const tx = update.transaction;
    if (!/^[0-9a-f]{64}$/i.test(tx.txHash)) throw new Error("Invalid indexed transaction hash");
    transactions[tx.txHash.toLowerCase()] = { ...tx, txHash: tx.txHash.toLowerCase() };
  }

  const existingIds = new Set(snapshot.events.map((event) => event.id));
  const newEvents = (update.events ?? []).filter((event) => {
    if (!event.id.trim()) throw new Error("Indexer event id is required");
    if (!event.market.trim()) throw new Error("Indexer event market is required");
    if (!event.account.trim()) throw new Error("Indexer event account is required");
    if (existingIds.has(event.id)) return false;
    existingIds.add(event.id);
    return true;
  });

  const nextSlot = update.slot ?? update.transaction?.slot ?? snapshot.lastSlot;
  if (!Number.isFinite(nextSlot) || nextSlot < snapshot.lastSlot) throw new Error("Indexer slot cannot move backwards");

  return {
    lastSlot: nextSlot,
    transactions,
    events: [...snapshot.events, ...newEvents]
  };
}

export interface ChainReadProvider {
  getTransaction(txHash: string): Promise<IndexedTx | null>;
  getTip(): Promise<{ slot: number; blockHeight: number }>;
}

export async function confirmSubmittedTransaction(input: {
  provider: ChainReadProvider;
  txHash: string;
  minSlot?: number;
}) {
  const tx = await input.provider.getTransaction(input.txHash);
  if (!tx) return { confirmed: false, transaction: null } as const;
  if (tx.state !== "CONFIRMED") return { confirmed: false, transaction: tx } as const;
  if (input.minSlot !== undefined && (tx.slot ?? -1) < input.minSlot) return { confirmed: false, transaction: tx } as const;
  return { confirmed: true, transaction: tx } as const;
}

export type CardanoNetwork = "preview" | "preprod" | "mainnet";

export type Cip30WalletApi = {
  getNetworkId(): Promise<number>;
  getChangeAddress(): Promise<string>;
  getUtxos(amount?: string, paginate?: { page: number; limit: number }): Promise<string[] | null>;
  getBalance(): Promise<string>;
  signTx(txCborHex: string, partialSign?: boolean): Promise<string>;
  submitTx(txCborHex: string): Promise<string>;
};

export type PreparedCardanoTransaction = {
  requestId: string;
  network: CardanoNetwork;
  unsignedTxCborHex: string;
  createdAt: string;
  expiresAt: string;
  intentHash: string;
};

export type SignedTransactionAssembler = (input: {
  unsignedTxCborHex: string;
  witnessSetCborHex: string;
  requestId: string;
}) => Promise<string>;

export type CardanoExecutionReceipt = {
  requestId: string;
  txHash: string;
  network: CardanoNetwork;
  submittedAt: string;
};

function isHex(value: string) {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

export function expectedCip30NetworkId(network: CardanoNetwork) {
  return network === "mainnet" ? 1 : 0;
}

export function validatePreparedTransaction(tx: PreparedCardanoTransaction, nowMs = Date.now()) {
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(tx.requestId)) throw new Error("Invalid transaction request id");
  if (!isHex(tx.unsignedTxCborHex)) throw new Error("Unsigned transaction must be CBOR hex");
  if (!/^[0-9a-f]{64}$/i.test(tx.intentHash)) throw new Error("Intent hash must be a 32-byte hex digest");
  const createdAt = new Date(tx.createdAt).getTime();
  const expiresAt = new Date(tx.expiresAt).getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) throw new Error("Invalid transaction timestamps");
  if (expiresAt <= createdAt) throw new Error("Transaction expiry must be after creation");
  if (nowMs >= expiresAt) throw new Error("Prepared transaction has expired");
  if (createdAt > nowMs + 30_000) throw new Error("Prepared transaction creation time is in the future");
  return tx;
}

export class TransactionRequestRegistry {
  private readonly consumed = new Set<string>();

  has(requestId: string) {
    return this.consumed.has(requestId);
  }

  consume(requestId: string) {
    if (this.consumed.has(requestId)) throw new Error("Transaction request already consumed");
    this.consumed.add(requestId);
  }
}

export async function assertWalletNetwork(api: Cip30WalletApi, network: CardanoNetwork) {
  const actual = await api.getNetworkId();
  const expected = expectedCip30NetworkId(network);
  if (actual !== expected) throw new Error(`Wallet network mismatch: expected CIP-30 network ${expected}, received ${actual}`);
  return actual;
}

export async function executePreparedTransaction(input: {
  api: Cip30WalletApi;
  prepared: PreparedCardanoTransaction;
  assembleSignedTransaction: SignedTransactionAssembler;
  registry?: TransactionRequestRegistry;
  nowMs?: number;
}): Promise<CardanoExecutionReceipt> {
  const nowMs = input.nowMs ?? Date.now();
  const prepared = validatePreparedTransaction(input.prepared, nowMs);
  if (input.registry?.has(prepared.requestId)) throw new Error("Transaction request already consumed");

  await assertWalletNetwork(input.api, prepared.network);
  const witnessSetCborHex = await input.api.signTx(prepared.unsignedTxCborHex, true);
  if (!isHex(witnessSetCborHex)) throw new Error("Wallet returned an invalid witness set");

  const signedTxCborHex = await input.assembleSignedTransaction({
    unsignedTxCborHex: prepared.unsignedTxCborHex,
    witnessSetCborHex,
    requestId: prepared.requestId
  });
  if (!isHex(signedTxCborHex)) throw new Error("Assembler returned an invalid signed transaction");

  const txHash = await input.api.submitTx(signedTxCborHex);
  if (!/^[0-9a-f]{64}$/i.test(txHash)) throw new Error("Wallet returned an invalid transaction hash");
  input.registry?.consume(prepared.requestId);

  return {
    requestId: prepared.requestId,
    txHash: txHash.toLowerCase(),
    network: prepared.network,
    submittedAt: new Date(nowMs).toISOString()
  };
}

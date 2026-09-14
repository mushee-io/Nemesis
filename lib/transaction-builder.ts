import { validatePreparedTransaction, type CardanoNetwork, type PreparedCardanoTransaction } from "./cardano-execution";

export type BuilderAction = "DEPOSIT_COLLATERAL" | "WITHDRAW_COLLATERAL" | "OPEN_PERP" | "CLOSE_PERP" | "SETTLE_OPTION" | "LIQUIDATE" | "SETTLE_NOTIONAL";

export type BuilderRequest = {
  action: BuilderAction;
  network: CardanoNetwork;
  account: string;
  payload: unknown;
  intentHash: string;
};

export class TransactionBuilderClient {
  constructor(private readonly endpoint: string, private readonly bearerToken?: string) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("Transaction builder endpoint must use HTTPS");
    }
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.bearerToken ? { authorization: `Bearer ${this.bearerToken}` } : {})
    };
  }

  async prepare(request: BuilderRequest, nowMs = Date.now()) {
    if (!request.account.trim()) throw new Error("Builder account is required");
    if (!/^[0-9a-f]{64}$/i.test(request.intentHash)) throw new Error("Invalid builder intent hash");
    const response = await fetch(`${this.endpoint.replace(/\/$/, "")}/prepare`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Transaction builder prepare failed with ${response.status}`);
    const prepared = await response.json() as PreparedCardanoTransaction;
    if (prepared.network !== request.network) throw new Error("Builder returned the wrong Cardano network");
    if (prepared.intentHash.toLowerCase() !== request.intentHash.toLowerCase()) throw new Error("Builder returned a mismatched intent hash");
    return validatePreparedTransaction(prepared, nowMs);
  }

  async assemble(input: { requestId: string; unsignedTxCborHex: string; witnessSetCborHex: string }) {
    const response = await fetch(`${this.endpoint.replace(/\/$/, "")}/assemble`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Transaction builder assemble failed with ${response.status}`);
    const body = await response.json() as { signedTxCborHex?: string };
    if (!body.signedTxCborHex || body.signedTxCborHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(body.signedTxCborHex)) {
      throw new Error("Builder returned invalid signed transaction CBOR");
    }
    return body.signedTxCborHex;
  }
}

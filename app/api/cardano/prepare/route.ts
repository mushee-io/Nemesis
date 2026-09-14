import { NextResponse } from "next/server";
import { TransactionBuilderClient, type BuilderAction } from "@/lib/transaction-builder";
import type { CardanoNetwork } from "@/lib/cardano-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actions = new Set<BuilderAction>([
  "DEPOSIT_COLLATERAL",
  "WITHDRAW_COLLATERAL",
  "OPEN_PERP",
  "CLOSE_PERP",
  "SETTLE_OPTION",
  "LIQUIDATE",
  "SETTLE_NOTIONAL"
]);
const networks = new Set<CardanoNetwork>(["preview", "preprod", "mainnet"]);

export async function POST(request: Request) {
  try {
    const endpoint = process.env.SYMBIOTIC_TX_BUILDER_ENDPOINT;
    if (!endpoint) return NextResponse.json({ error: "Transaction builder is not configured" }, { status: 503 });

    const body = await request.json() as Record<string, unknown>;
    const action = body.action as BuilderAction;
    const network = body.network as CardanoNetwork;
    const account = typeof body.account === "string" ? body.account : "";
    const intentHash = typeof body.intentHash === "string" ? body.intentHash : "";
    if (!actions.has(action)) return NextResponse.json({ error: "Unsupported builder action" }, { status: 400 });
    if (!networks.has(network)) return NextResponse.json({ error: "Unsupported Cardano network" }, { status: 400 });

    const configuredNetwork = process.env.SYMBIOTIC_CARDANO_NETWORK;
    if (configuredNetwork && configuredNetwork !== network) {
      return NextResponse.json({ error: "Requested network does not match deployment network" }, { status: 409 });
    }

    const client = new TransactionBuilderClient(endpoint, process.env.SYMBIOTIC_TX_BUILDER_TOKEN);
    const prepared = await client.prepare({
      action,
      network,
      account,
      payload: body.payload,
      intentHash
    });
    return NextResponse.json(prepared, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to prepare transaction" }, { status: 400 });
  }
}

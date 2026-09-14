import { NextResponse } from "next/server";
import { TransactionBuilderClient } from "@/lib/transaction-builder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isHex(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

export async function POST(request: Request) {
  try {
    const endpoint = process.env.SYMBIOTIC_TX_BUILDER_ENDPOINT;
    if (!endpoint) return NextResponse.json({ error: "Transaction builder is not configured" }, { status: 503 });
    const body = await request.json() as Record<string, unknown>;
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(requestId)) return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
    if (!isHex(body.unsignedTxCborHex) || !isHex(body.witnessSetCborHex)) {
      return NextResponse.json({ error: "Transaction and witness set must be CBOR hex" }, { status: 400 });
    }

    const client = new TransactionBuilderClient(endpoint, process.env.SYMBIOTIC_TX_BUILDER_TOKEN);
    const signedTxCborHex = await client.assemble({
      requestId,
      unsignedTxCborHex: body.unsignedTxCborHex as string,
      witnessSetCborHex: body.witnessSetCborHex as string
    });
    return NextResponse.json({ signedTxCborHex });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to assemble signed transaction" }, { status: 400 });
  }
}

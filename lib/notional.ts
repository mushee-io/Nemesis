export type HiddenIntent = {
  market: string;
  side: "BUY" | "SELL";
  size: string;
  limitPrice: string;
  expiry: string;
  nonce: string;
  chainId: string;
  maxSlippageBps: number;
};

export type NotionalReveal = {
  intent: HiddenIntent;
  salt: string;
  commitment: string;
};

export function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function decimalString(name: string, value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed.toString();
}

export function validateHiddenIntent(intent: HiddenIntent, nowMs = Date.now()) {
  if (!intent.market.trim()) throw new Error("Market is required");
  if (!intent.chainId.trim()) throw new Error("Chain id is required");
  if (!intent.nonce.trim() || intent.nonce.length < 16) throw new Error("Nonce is missing or too short");
  decimalString("Size", intent.size);
  decimalString("Limit price", intent.limitPrice);
  if (!Number.isInteger(intent.maxSlippageBps) || intent.maxSlippageBps < 0 || intent.maxSlippageBps > 2_000) {
    throw new Error("Slippage must be an integer between 0 and 2000 bps");
  }
  const expiryMs = new Date(intent.expiry).getTime();
  if (!Number.isFinite(expiryMs)) throw new Error("Invalid expiry");
  if (expiryMs <= nowMs) throw new Error("Intent has expired");
  return true;
}

function canonical(intent: HiddenIntent) {
  validateHiddenIntent(intent);
  return JSON.stringify({
    chainId: intent.chainId.trim().toLowerCase(),
    expiry: new Date(intent.expiry).toISOString(),
    limitPrice: decimalString("Limit price", intent.limitPrice),
    market: intent.market.trim().toUpperCase(),
    maxSlippageBps: intent.maxSlippageBps,
    nonce: intent.nonce.trim().toLowerCase(),
    side: intent.side,
    size: decimalString("Size", intent.size),
    version: 1
  });
}

function revealPreimage(intent: HiddenIntent, salt: string) {
  if (!/^[0-9a-f]{64}$/i.test(salt)) throw new Error("Salt must be 32 random bytes encoded as hex");
  return `${canonical(intent)}:${salt.toLowerCase()}`;
}

async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createIntentRevealPreimage(intent: HiddenIntent, salt: string) {
  const encoded = new TextEncoder().encode(revealPreimage(intent, salt));
  return Array.from(encoded, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createIntentCommitment(intent: HiddenIntent, salt: string) {
  return sha256(revealPreimage(intent, salt));
}

export async function verifyIntentReveal(reveal: NotionalReveal) {
  const expected = await createIntentCommitment(reveal.intent, reveal.salt);
  return expected === reveal.commitment.toLowerCase();
}

export function calculateBoundedExecution(input: {
  side: HiddenIntent["side"];
  limitPrice: number;
  maxSlippageBps: number;
}) {
  if (!Number.isFinite(input.limitPrice) || input.limitPrice <= 0) throw new Error("Invalid limit price");
  if (!Number.isInteger(input.maxSlippageBps) || input.maxSlippageBps < 0 || input.maxSlippageBps > 2_000) {
    throw new Error("Invalid slippage tolerance");
  }
  const tolerance = input.maxSlippageBps / 10_000;
  return input.side === "BUY"
    ? { minPrice: 0, maxPrice: input.limitPrice * (1 + tolerance) }
    : { minPrice: input.limitPrice * (1 - tolerance), maxPrice: Number.POSITIVE_INFINITY };
}

export async function validateNotionalFill(input: {
  reveal: NotionalReveal;
  executionPrice: number;
  nowMs?: number;
}) {
  validateHiddenIntent(input.reveal.intent, input.nowMs ?? Date.now());
  if (!(await verifyIntentReveal(input.reveal))) throw new Error("Notional reveal does not match commitment");
  if (!Number.isFinite(input.executionPrice) || input.executionPrice <= 0) throw new Error("Invalid Notional execution price");
  const bounds = calculateBoundedExecution({
    side: input.reveal.intent.side,
    limitPrice: Number(input.reveal.intent.limitPrice),
    maxSlippageBps: input.reveal.intent.maxSlippageBps
  });
  if (input.executionPrice < bounds.minPrice || input.executionPrice > bounds.maxPrice) {
    throw new Error("Notional execution price violates committed bounds");
  }
  return true;
}

export class NonceRegistry {
  private readonly used = new Set<string>();

  consume(nonce: string) {
    const normalized = nonce.trim().toLowerCase();
    if (!normalized) throw new Error("Nonce is required");
    if (this.used.has(normalized)) throw new Error("Intent nonce already consumed");
    this.used.add(normalized);
  }

  has(nonce: string) {
    return this.used.has(nonce.trim().toLowerCase());
  }
}

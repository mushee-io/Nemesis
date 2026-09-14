export type HiddenIntent = {
  market: string;
  side: "BUY" | "SELL";
  size: string;
  limitPrice: string;
  expiry: string;
};

export function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function canonical(intent: HiddenIntent) {
  return JSON.stringify({
    expiry: intent.expiry.trim(),
    limitPrice: intent.limitPrice.trim(),
    market: intent.market.trim().toUpperCase(),
    side: intent.side,
    size: intent.size.trim()
  });
}

export async function createIntentCommitment(intent: HiddenIntent, salt: string) {
  if (!intent.market || !intent.size || !intent.limitPrice || !intent.expiry) throw new Error("Complete every intent field");
  const encoded = new TextEncoder().encode(`${canonical(intent)}:${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

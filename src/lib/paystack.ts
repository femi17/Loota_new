import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paystack, from the server only (the secret key never reaches the browser): start a transaction, check one, and
 * tell a genuine webhook from a forged one.
 */
const API = "https://api.paystack.co";

function secret() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return key;
}

/** Start a payment: what the player pays (kobo), and where Paystack sends them back. */
export async function initializeTransaction(o: { email: string; amountKobo: number; reference: string; callbackUrl: string; metadata: Record<string, unknown> }) {
  const res = await fetch(`${API}/transaction/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: o.email,
      amount: o.amountKobo,
      currency: "NGN",
      reference: o.reference,
      callback_url: o.callbackUrl,
      metadata: o.metadata,
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: { authorization_url: string; access_code: string } } | null;
  if (!res.ok || !body?.status || !body.data) throw new Error(body?.message ?? `Paystack: HTTP ${res.status}`);
  return { url: body.data.authorization_url, accessCode: body.data.access_code };
}

/** What Paystack says about a payment: "success", "failed", "abandoned", "ongoing"…, with the amount (kobo). */
export async function verifyTransaction(reference: string) {
  const res = await fetch(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret()}` },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; data?: { status: string; amount: number; currency: string; reference: string } } | null;
  if (!body?.status || !body.data) return null;
  return body.data;
}

/** A webhook is Paystack's only if its signature (HMAC-SHA512 of the raw body with the secret key) matches. */
export function genuineWebhook(rawBody: string, signature: string | null) {
  if (!signature) return false;
  const expected = createHmac("sha512", secret()).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

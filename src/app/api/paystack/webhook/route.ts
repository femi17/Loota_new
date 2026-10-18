import { createAdminClient } from "@/lib/supabase/admin";
import { genuineWebhook } from "@/lib/paystack";

/**
 * POST /api/paystack/webhook: Paystack tells us a charge succeeded, even if the player's phone lost its connection
 * after paying. Only signed calls are believed (the HMAC of the raw body with the secret key); the coins are added
 * once, for the amount the purchase was started at. Set this URL in the Paystack dashboard (Settings > API Keys &
 * Webhooks) once the game is online: https://<your domain>/api/paystack/webhook
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!genuineWebhook(raw, request.headers.get("x-paystack-signature"))) {
    return new Response("Bad signature", { status: 401 });
  }
  const event = JSON.parse(raw) as { event?: string; data?: { reference?: string; amount?: number; currency?: string; status?: string } };
  const ref = event.data?.reference;
  if (event.event === "charge.success" && ref?.startsWith("loota_") && event.data?.currency === "NGN") {
    await createAdminClient().rpc("credit_coin_purchase", { p_reference: ref, p_amount_kobo: event.data.amount ?? 0 });
  }
  // Always acknowledge a genuine call, or Paystack keeps retrying.
  return new Response("OK");
}

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTransaction } from "@/lib/paystack";

/**
 * POST /api/coins/verify { reference }: after paying (the payment window closed, or Paystack sent the player back),
 * ask Paystack itself whether it was paid; if so, the coins (once: credit_coin_purchase). Only the player's own
 * purchases. Replies { ok, coins, balance }, { pending }, or { failed }.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { reference?: string } | null;
  const reference = body?.reference;
  if (!reference || !/^loota_[0-9a-f-]{36}$/.test(reference)) return Response.json({ error: "No such purchase" }, { status: 400 });

  const admin = createAdminClient();
  const { data: purchase } = await admin.from("coin_purchases").select("user_id, status").eq("reference", reference).maybeSingle();
  if (!purchase || purchase.user_id !== userId) return Response.json({ error: "No such purchase" }, { status: 404 });

  const paid = await verifyTransaction(reference);
  if (!paid) return Response.json({ pending: true });
  if (paid.status === "success" && paid.currency === "NGN") {
    const { data, error } = await admin.rpc("credit_coin_purchase", { p_reference: reference, p_amount_kobo: paid.amount });
    if (error) return Response.json({ error: "Couldn't add the coins. Try again." }, { status: 500 });
    const r = data as { ok: boolean; reason?: string; coins?: number; balance?: number };
    if (!r.ok) return Response.json({ failed: true, reason: r.reason });
    return Response.json({ ok: true, coins: r.coins, balance: r.balance });
  }
  // ("abandoned" is also what Paystack says of a payment started but not yet finished: not final.)
  if (paid.status === "failed" || paid.status === "reversed") {
    await admin.from("coin_purchases").update({ status: "failed" }).eq("reference", reference).eq("status", "pending");
    return Response.json({ failed: true, reason: paid.status });
  }
  return Response.json({ pending: true });
}

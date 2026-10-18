import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { initializeTransaction } from "@/lib/paystack";
import { packById } from "@/game/coinPacks";

/**
 * POST /api/coins/checkout { pack }: start buying a coin pack. The price and the coins come from the pack list here
 * on the server; the purchase is recorded as pending, and Paystack's checkout is started for the signed-in player.
 * Replies with what the payment window needs (the access code), or the page to go to.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = auth?.claims?.email as string | undefined;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!email) return Response.json({ error: "Your account has no email address for the receipt" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { pack?: string } | null;
  const pack = body?.pack ? packById(body.pack) : null;
  if (!pack) return Response.json({ error: "No such coin pack" }, { status: 400 });

  const reference = `loota_${randomUUID()}`;
  const amountKobo = pack.naira * 100;
  const admin = createAdminClient();
  const { error } = await admin.from("coin_purchases").insert({ reference, user_id: userId, pack: pack.id, coins: pack.coins, amount_kobo: amountKobo });
  if (error) return Response.json({ error: "Couldn't start the purchase" }, { status: 500 });

  try {
    const origin = new URL(request.url).origin;
    const started = await initializeTransaction({
      email,
      amountKobo,
      reference,
      callbackUrl: `${origin}/play?paid=${encodeURIComponent(reference)}`,
      metadata: { user_id: userId, pack: pack.id, coins: pack.coins },
    });
    return Response.json({ reference, accessCode: started.accessCode, url: started.url });
  } catch {
    await admin.from("coin_purchases").update({ status: "failed" }).eq("reference", reference);
    return Response.json({ error: "Paystack couldn't start the payment. Try again in a moment." }, { status: 502 });
  }
}

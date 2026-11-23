import { createClient } from "@/lib/supabase/server";
import { sendFinishEmail } from "@/lib/prize";

/**
 * POST /api/hunt/finish-email { hunt }: the signed-in hunter has collected every key; email them (once), with a prize
 * code when they're a winner (src/lib/prize.ts). The game calls it when the hunt panel shows them finished, whatever
 * brought the last key (a Key Trial, a showdown, a Wonder). Replies with the email's status and where it went (masked).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { hunt?: string } | null;
  const hunt = body?.hunt ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(hunt)) return Response.json({ error: "Unknown hunt" }, { status: 400 });
  const r = await sendFinishEmail(hunt, userId, new URL(request.url).origin);
  return Response.json(r, { status: r.status === "not-finished" ? 409 : 200 });
}

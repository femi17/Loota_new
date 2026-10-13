import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stockCell } from "@/lib/world-spawn";

type Nearby = { items: unknown[]; leads: unknown[]; decoysFound: number; staleCells: string[] };

/**
 * POST /api/world/nearby: the items and intel leads around the signed-in
 * player's saved position. Replies straight away; empty or old squares nearby
 * are stocked after the reply (closest first, one per call), so new finds show
 * up on the player's next refresh instead of holding this one up.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase.rpc("world_nearby");
  if (error) return Response.json({ error: "Couldn't load nearby items" }, { status: 500 });
  const nearby = data as Nearby;

  const next = nearby.staleCells[0];
  if (next) {
    after(async () => {
      await stockCell(createAdminClient(), next);
    });
  }

  return Response.json({ items: nearby.items, leads: nearby.leads, decoysFound: nearby.decoysFound });
}

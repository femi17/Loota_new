import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stockCell } from "@/lib/world-spawn";
import { fillPlaceStreets } from "@/lib/place-streets";
import { stockCruise } from "@/lib/cruise-drops";
import { fillArea } from "@/lib/fill-area";

type Nearby = { items: unknown[]; leads: unknown[]; decoysFound: number; staleCells: string[] };

/**
 * POST /api/world/nearby: the items and intel leads around the signed-in
 * player's saved position. Replies straight away; empty or old squares nearby
 * are stocked after the reply (closest first, one per call), so new finds show
 * up on the player's next refresh instead of holding this one up. Places around
 * get their street spots (for Detours) the same way, a few per call, and the
 * square around the player its cruise tokens. Outside Nigeria, a square the
 * player comes to gets its petrol stations, places to eat and rest, tyre shops,
 * mechanics, hospitals and bus stops from OpenStreetMap, once (fillArea).
 */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase.rpc("world_nearby");
  if (error) return Response.json({ error: "Couldn't load nearby items" }, { status: 500 });
  const nearby = data as Nearby;

  const next = nearby.staleCells[0];
  const user = auth.claims.sub;
  after(async () => {
    const admin = createAdminClient();
    if (next) await stockCell(admin, next);
    const { data: pos } = await admin.from("player_positions").select("lng, lat").eq("user_id", user).maybeSingle();
    if (pos) {
      await fillArea(admin, pos.lng, pos.lat); // outside Nigeria: the places and bus stops of a new square, once
      await stockCruise(admin, pos.lng, pos.lat); // cruise tokens in the streets around
      await fillPlaceStreets(admin, pos.lng, pos.lat);
    }
  });

  return Response.json({ items: nearby.items, leads: nearby.leads, decoysFound: nearby.decoysFound });
}

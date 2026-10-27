import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fillArea, fillTrainLinesAround, isFilled } from "@/lib/fill-area";

/**
 * POST /api/world/fill { lng, lat }: a place a signed-in player wants to travel to, outside Nigeria. Its square gets its
 * places and bus stops before the reply (from the map's tiles: a few seconds), so the trip is planned straight away
 * (owner, 27 Oct 2026, Calgary to Red Deer: "it is telling me Looking up the bus stations around Red Deer: try again in
 * a minute"); the squares around it and its train lines come after the reply. Says whether its square is in.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { lng?: unknown; lat?: unknown } | null;
  const lng = Number(body?.lng);
  const lat = Number(body?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    return Response.json({ error: "Where?" }, { status: 400 });
  }
  const admin = createAdminClient();
  let filled = await isFilled(admin, lng, lat);
  if (!filled) {
    await fillArea(admin, lng, lat, { lines: false }); // the place's own square first (the nearest not yet in)
    filled = await isFilled(admin, lng, lat);
  }
  after(async () => {
    for (let i = 0; i < 8; i++) if (!(await fillArea(admin, lng, lat, { lines: false }))) break; // the squares around
    await fillTrainLinesAround(admin, lng, lat);
  });
  return Response.json({ filled });
}

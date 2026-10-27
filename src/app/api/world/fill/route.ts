import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fillArea, isFilled } from "@/lib/fill-area";

/**
 * POST /api/world/fill { lng, lat }: a place a signed-in player wants to travel to, outside Nigeria. Says whether its
 * square has its places, bus stops and train lines yet; if not, they're brought in after the reply (fillArea), so a
 * trip there can be planned a minute later (owner, 27 Oct 2026: "the bus, train should work according to the country").
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
  const filled = await isFilled(admin, lng, lat);
  if (!filled) after(() => fillArea(admin, lng, lat).then(() => undefined));
  return Response.json({ filled });
}

import type { NextRequest } from "next/server";
import { photonAsk } from "@/lib/story/engine";
import { mapPassOk } from "@/lib/story/map-pass";

/** A lookup waits about a second (Photon's fair use) and retries a busy answer up to four times. */
export const maxDuration = 60;

/**
 * GET /api/admin/map-check?q=…: one story place looked up on the map search, from the live server the players' own
 * searches go through (owner, 31 Oct 2026). For `npm run story:import`, with the day's pass (Authorization: Bearer).
 * { spot } with a place, or null when the map search finds nothing; 503 when it never answered.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  const pass = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !mapPassOk(secret, pass)) return Response.json({ error: "Not allowed" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 200) return Response.json({ error: "Which place?" }, { status: 400 });
  const spot = await photonAsk(q);
  if (spot === undefined) return Response.json({ error: "The map search didn't answer" }, { status: 503 });
  return Response.json({ spot });
}

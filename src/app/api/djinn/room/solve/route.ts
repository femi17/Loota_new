import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPuzzle, rightCount, type AnyPuzzle, type PuzzleKind } from "@/game/puzzles";

/**
 * POST /api/djinn/room/solve { room, answer }: the player's answer to a lock or box in the Djinn's world, checked here by
 * the puzzle's rules. Right: it opens (djinn_world_room_open: on to the next lock, sand, a trap, or behind the last lock
 * the Wonder at the real place, an empty vault at a false one). Wrong: try again (how many are right, for questions).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { room?: number; answer?: unknown } | null;
  const room = Number(body?.room);
  if (!Number.isInteger(room)) return Response.json({ ok: false, reason: "no_room" }, { status: 400 });

  const admin = createAdminClient();
  const { data: got } = await admin.rpc("djinn_world_room_get", { p_user: uid, p_room: room });
  const p = got as { ok: boolean; reason?: string; kind?: string; puzzle?: unknown; solution?: unknown; open?: boolean; late?: boolean } | null;
  if (!p?.ok) return Response.json({ ok: false, reason: p?.reason ?? "no_puzzle" });
  if (p.late) return Response.json({ ok: false, reason: "late" });
  if (!p.open && !(body?.answer != null && checkPuzzle(p.kind as PuzzleKind, p.puzzle as AnyPuzzle, body.answer, p.solution))) {
    return Response.json({ ok: true, right: false, rightOf: rightCount(p.kind as PuzzleKind, body?.answer, p.solution) });
  }
  const { data, error } = await admin.rpc("djinn_world_room_open", { p_user: uid, p_room: room });
  if (error) return Response.json({ error: "Couldn't open the lock" }, { status: 500 });
  return Response.json({ right: true, ...(data as object) });
}

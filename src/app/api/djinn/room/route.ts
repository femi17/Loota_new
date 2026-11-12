import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makePuzzle, puzzleSeconds } from "@/game/puzzles";
import { roomKind, roomLevel, roomSeed } from "@/lib/house-rooms";

/** The Djinn's puzzles are as hard as a hunt's last keys. */
const DJINN_LEVEL_KEY = 3;

/**
 * POST /api/djinn/room { room }: the signed-in player's puzzle for a lock or box in the Djinn's world (they must be within
 * 300 m of the place they chose from the seals, with the Wager open). As /api/house/room: made the first time and kept
 * with its answer in the database (never sent); out of time, the lock jams for 30 s, then a new puzzle. The chain's three
 * locks (rooms 1, 6, 7) each of another kind.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { room?: number } | null;
  const room = Number(body?.room);
  if (!Number.isInteger(room) || room < 1 || room > 7) return Response.json({ ok: false, reason: "no_room" }, { status: 400 });

  const admin = createAdminClient();
  const { data: at } = await admin.rpc("djinn_world_room_try", { p_user: uid, p_room: room });
  const step = at as { ok: boolean; reason?: string; try?: number; open?: boolean; wager?: string } | null;
  if (!step?.ok || step.open || !step.wager) return Response.json(step ?? { ok: false, reason: "error" });
  const kind = roomKind(uid, step.wager, DJINN_LEVEL_KEY, room);
  const level = roomLevel(DJINN_LEVEL_KEY);
  const made = makePuzzle(kind, level, roomSeed(uid, step.wager, DJINN_LEVEL_KEY, room, step.try ?? 0));
  const { data, error } = await admin.rpc("djinn_world_room_ready", {
    p_user: uid,
    p_room: room,
    p_kind: kind,
    p_puzzle: made.puzzle,
    p_solution: made.answer,
    p_try: step.try ?? 0,
    p_seconds: puzzleSeconds(kind, level),
  });
  if (error) return Response.json({ error: "Couldn't open the lock" }, { status: 500 });
  return Response.json(data);
}

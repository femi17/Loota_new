import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makePuzzle } from "@/game/puzzles";
import { ROOM_KINDS, roomSeed } from "@/lib/house-rooms";

/**
 * POST /api/house/room { hunt, room }: the signed-in hunter's puzzle for a room of the treasure building (they must be
 * at the key's place, inside the building they found). Made the first time and kept with its answer in the database;
 * the answer is never sent. 60 seconds to solve it (owner, 3 Nov 2026); out of time, the lock jams for 30 s, then a
 * new puzzle. A room already opened says what it held.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { hunt?: string; room?: number } | null;
  const room = Number(body?.room);
  if (!body?.hunt || !Number.isInteger(room) || room < 1 || room > 5) return Response.json({ ok: false, reason: "no_room" }, { status: 400 });

  const kind = ROOM_KINDS[room - 1];
  const admin = createAdminClient();
  const { data: at } = await admin.rpc("house_room_try", { p_user: uid, p_hunt: body.hunt, p_room: room });
  const step = at as { ok: boolean; reason?: string; try?: number; open?: boolean; outcome?: string; seconds?: number } | null;
  if (!step?.ok || step.open) return Response.json(step ?? { ok: false, reason: "error" });
  const made = makePuzzle(kind, 1, roomSeed(uid, body.hunt, room, step.try ?? 0));
  const { data, error } = await admin.rpc("house_room_ready", {
    p_user: uid,
    p_hunt: body.hunt,
    p_room: room,
    p_kind: kind,
    p_puzzle: made.puzzle,
    p_solution: made.answer,
    p_try: step.try ?? 0,
  });
  if (error) return Response.json({ error: "Couldn't open the room" }, { status: 500 });
  return Response.json(data);
}

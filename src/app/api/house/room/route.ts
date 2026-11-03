import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makePuzzle } from "@/game/puzzles";
import { ROOM_KINDS, roomSeed } from "@/lib/house-rooms";

/**
 * POST /api/house/room { hunt, room }: the signed-in hunter's puzzle for a room of the treasure building (they must be
 * at the key's place, inside the building they found). Made the first time and kept with its answer in the database;
 * the answer is never sent. A room already opened says what it held.
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
  const made = makePuzzle(kind, 1, roomSeed(uid, body.hunt, room));
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("house_room_ready", {
    p_user: uid,
    p_hunt: body.hunt,
    p_room: room,
    p_kind: kind,
    p_puzzle: made.puzzle,
    p_solution: made.answer,
  });
  if (error) return Response.json({ error: "Couldn't open the room" }, { status: 500 });
  return Response.json(data);
}

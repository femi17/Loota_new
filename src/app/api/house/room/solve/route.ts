import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPuzzle, type AnyPuzzle, type PuzzleKind } from "@/game/puzzles";

/**
 * POST /api/house/room/solve { hunt, room, answer }: the hunter's answer to a room's puzzle, checked here by the
 * puzzle's rules. Right: the room opens and what's in it happens (house_room_open: coins, the next chapter, the key,
 * a decoy or a trap). Wrong: try again.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { hunt?: string; room?: number; answer?: unknown } | null;
  const room = Number(body?.room);
  if (!body?.hunt || !Number.isInteger(room)) return Response.json({ ok: false, reason: "no_room" }, { status: 400 });

  const admin = createAdminClient();
  const { data: got } = await admin.rpc("house_room_get", { p_user: uid, p_hunt: body.hunt, p_room: room });
  const p = got as { ok: boolean; reason?: string; kind?: string; puzzle?: unknown; solution?: unknown; open?: boolean; late?: boolean } | null;
  if (!p?.ok) return Response.json({ ok: false, reason: p?.reason ?? "no_puzzle" });
  if (p.late) return Response.json({ ok: false, reason: "late" }); // past its time: the lock has jammed
  if (!p.open && !(body.answer != null && checkPuzzle(p.kind as PuzzleKind, p.puzzle as AnyPuzzle, body.answer, p.solution))) {
    return Response.json({ ok: true, right: false });
  }
  const { data, error } = await admin.rpc("house_room_open", { p_user: uid, p_hunt: body.hunt, p_room: room });
  if (error) return Response.json({ error: "Couldn't open the room" }, { status: 500 });
  return Response.json({ right: true, ...(data as object) });
}

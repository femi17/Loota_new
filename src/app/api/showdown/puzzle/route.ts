import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makePuzzle, type PuzzleKind } from "@/game/puzzles";

/**
 * POST /api/showdown/puzzle { id }: the showdown's puzzle (owner, 14 Nov 2026: the thief and the target race on the same
 * puzzle). Made once from the showdown's seed (a Key Trial's quick puzzle, the kind the target picked) and kept with
 * its answer; both hunters get the same one. The answer is never sent.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { id?: number } | null;
  if (!body?.id) return Response.json({ error: "No showdown" }, { status: 400 });

  const admin = createAdminClient();
  const { data: s } = await admin.from("showdowns").select("id, thief, target, status, kind, seed, puzzle, starts_at, ends_at").eq("id", body.id).maybeSingle();
  if (!s || (s.thief !== uid && s.target !== uid) || s.status !== "fight" || !s.kind) return Response.json({ error: "No showdown puzzle" }, { status: 404 });
  let puzzle = s.puzzle;
  if (!puzzle) {
    const made = makePuzzle(s.kind as PuzzleKind, 1, Number(s.seed));
    // (the first to ask makes it; the same seed makes the same puzzle, so a race between the two is harmless)
    await admin.from("showdowns").update({ puzzle: made.puzzle, solution: made.answer }).eq("id", s.id).is("puzzle", null);
    puzzle = made.puzzle;
  }
  return Response.json({ id: s.id, kind: s.kind, puzzle, startsAt: s.starts_at, endsAt: s.ends_at, now: new Date().toISOString() });
}

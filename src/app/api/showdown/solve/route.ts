import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPuzzle, makePuzzle, rightCount, type AnyPuzzle, type PuzzleKind } from "@/game/puzzles";

/**
 * POST /api/showdown/solve { id, answer }: a hunter's answer to the showdown's puzzle, checked here by the puzzle's
 * rules; showdown_answer then gives the win to the first right answer (two tries each).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { id?: number; answer?: unknown } | null;
  if (!body?.id) return Response.json({ error: "No showdown" }, { status: 400 });

  const admin = createAdminClient();
  const { data: s } = await admin.from("showdowns").select("id, thief, target, status, kind, seed, puzzle, solution").eq("id", body.id).maybeSingle();
  if (!s || (s.thief !== uid && s.target !== uid) || s.status !== "fight" || !s.kind) return Response.json({ ok: false, reason: "gone" });
  let { puzzle, solution } = s as { puzzle: unknown; solution: unknown };
  if (!puzzle) ({ puzzle, answer: solution } = makePuzzle(s.kind as PuzzleKind, 1, Number(s.seed)));
  const right = body.answer != null && checkPuzzle(s.kind as PuzzleKind, puzzle as AnyPuzzle, body.answer, solution);
  const { data, error } = await admin.rpc("showdown_answer", { p_id: s.id, p_user: uid, p_right: right });
  if (error) return Response.json({ error: "Couldn't check the answer" }, { status: 500 });
  const r = data as { result?: string } | null;
  if (r?.result === "wrong") return Response.json({ ...r, rightOf: rightCount(s.kind as PuzzleKind, body.answer, solution) });
  return Response.json(data);
}

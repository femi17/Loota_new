import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makePuzzle, type PuzzleKind } from "@/game/puzzles";

/**
 * POST /api/trial/puzzle: the signed-in player's Key Trial puzzle (owner, 24 Oct 2026: tasks, not only questions).
 * Made the first time it's asked for, from the attempt's seed and level, and kept with its answer in the database
 * (puzzle_ready starts the clock then); later calls (a reload) get the same puzzle and the time left. The answer is
 * never sent.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return Response.json({ error: "Not signed in" }, { status: 401 });

  const admin = createAdminClient();
  const { data: t } = await admin
    .from("trial_attempts")
    .select("id, kind, level, seed, puzzle")
    .eq("user_id", uid)
    .eq("status", "active")
    .neq("kind", "quiz")
    .maybeSingle();
  if (!t) return Response.json({ error: "No puzzle trial" }, { status: 404 });

  let puzzle = t.puzzle;
  let solution: unknown = null;
  if (!puzzle) {
    const made = makePuzzle(t.kind as PuzzleKind, t.level ?? 1, Number(t.seed ?? 1));
    puzzle = made.puzzle;
    solution = made.answer;
  }
  const { data: view, error } = await admin.rpc("puzzle_ready", { p_attempt: t.id, p_puzzle: puzzle, p_solution: solution });
  if (error) return Response.json({ error: "Couldn't start the puzzle" }, { status: 500 });
  return Response.json(view);
}

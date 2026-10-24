import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPuzzle, type AnyPuzzle, type PuzzleKind } from "@/game/puzzles";

/**
 * POST /api/trial/solve { attempt, answer }: the player's answer to their Key Trial puzzle, checked here by the
 * puzzle's rules (puzzle_result then gives the key, takes a life, or fails the trial, late answers included).
 * `answer: null` means the clock ran out on the phone.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { attempt?: string; answer?: unknown } | null;
  if (!body?.attempt) return Response.json({ error: "No attempt" }, { status: 400 });

  const admin = createAdminClient();
  const { data: t } = await admin
    .from("trial_attempts")
    .select("id, kind, puzzle")
    .eq("id", body.attempt)
    .eq("user_id", uid)
    .eq("status", "active")
    .maybeSingle();
  if (!t || t.kind === "quiz" || !t.puzzle) return Response.json({ ok: false, reason: "no_trial" });

  const right = body.answer != null && checkPuzzle(t.kind as PuzzleKind, t.puzzle as AnyPuzzle, body.answer);
  const { data, error } = await admin.rpc("puzzle_result", { p_attempt: t.id, p_right: right });
  if (error) return Response.json({ error: "Couldn't check the answer" }, { status: 500 });
  // The map hears of a key won or a trial failed through the hunt's own updates (as with a quiz).
  return Response.json(data);
}

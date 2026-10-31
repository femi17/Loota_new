import type { NextRequest } from "next/server";
import { getPlayer } from "@/lib/player";
import { createAdminClient } from "@/lib/supabase/admin";
import { newWork, nextStep, progress, type Work } from "@/lib/story/engine";
import { finishStoryHunt, storyRegistry } from "@/lib/story/finish";

/** One step of the story engine can take a few minutes (a chapter, the AI attack). */
export const maxDuration = 300;

type HuntStory = { id: string; story: Work | null; story_status: string | null; keys_wanted: number | null };

function report(h: { story_status: string | null }, work: Work | null, did?: string, notes: string[] = []) {
  return Response.json({
    status: h.story_status,
    did: did ?? null,
    progress: work ? progress(work) : { done: 0, total: 1 },
    log: work?.log.slice(-6) ?? [],
    error: work?.error ?? null,
    title: work?.skeleton?.title ?? null,
    notes,
  });
}

async function load(hunt: string) {
  const { data } = await createAdminClient().from("hunts").select("id, story, story_status, keys_wanted").eq("id", hunt).maybeSingle();
  return data as HuntStory | null;
}

/** GET /api/admin/story-step?hunt=…: where the hunt's story has got to. Owner only. */
export async function GET(request: NextRequest) {
  const player = await getPlayer();
  if (!player?.isAdmin) return Response.json({ error: "Owner only" }, { status: 403 });
  const h = await load(request.nextUrl.searchParams.get("hunt") ?? "");
  if (!h) return Response.json({ error: "No such hunt" }, { status: 404 });
  return report(h, h.story);
}

/**
 * POST /api/admin/story-step { hunt }: writes the next step of the hunt's story (the admin page calls it again and
 * again until the story is done), then, at the end, turns the story into the hunt's keys and picture slots. Owner only.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayer();
  if (!player?.isAdmin) return Response.json({ error: "Owner only" }, { status: 403 });
  const { hunt } = (await request.json().catch(() => ({}))) as { hunt?: string };
  const h = await load(hunt ?? "");
  if (!h) return Response.json({ error: "No such hunt" }, { status: 404 });
  if (h.story_status !== "writing") return report(h, h.story);

  const db = createAdminClient();
  const work = h.story ?? newWork(h.keys_wanted ?? 5);
  delete work.error;
  let did: string;
  try {
    did = await nextStep(work, await storyRegistry());
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    work.error = /credit balance is too low/i.test(message)
      ? "The Anthropic API account is out of credit: top it up at console.anthropic.com → Plans & Billing, then press Carry on."
      : message.slice(0, 300);
    await db.from("hunts").update({ story: work, story_status: "failed" }).eq("id", h.id);
    return report({ story_status: "failed" }, work);
  }
  if (!work.done) {
    await db.from("hunts").update({ story: work }).eq("id", h.id);
    return report(h, work, did);
  }
  const notes = await finishStoryHunt(h.id, work);
  return report({ story_status: "ready" }, work, "The story is ready", notes);
}

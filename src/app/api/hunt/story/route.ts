import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Work } from "@/lib/story/engine";
import type { HuntStoryView } from "@/game/hunt";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/hunt/story?hunt=…: a story hunt's story for the scroll on the map (owner, 31 Oct 2026: "a scroll that user
 * can always open and close"). Only what a reader sees: the title, the logline, each chapter's title, setting and text;
 * never the answers, decoys or live pieces kept with it. The chapters open one by one through the hunt (owner, 31 Oct
 * 2026: a chapter at a time, so nobody can hand the whole story to an AI at 9 a.m.): the first two at the start, then
 * one every 45 minutes (closer together when there are many, all open within 9 hours). Text only: the pictures are
 * the trailer's. 404 for a hunt that isn't a published story hunt.
 */
export async function GET(request: NextRequest) {
  const { data: auth } = await (await createClient()).auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Not signed in" }, { status: 401 });
  const hunt = request.nextUrl.searchParams.get("hunt") ?? "";
  if (!UUID.test(hunt)) return Response.json({ error: "Unknown hunt" }, { status: 404 });

  const { data: h } = await createAdminClient().from("hunts").select("story, story_status, published, starts_at").eq("id", hunt).maybeSingle();
  const work = h?.story as Work | null | undefined;
  if (!h?.published || h.story_status !== "ready" || !work?.skeleton) return Response.json({ error: "No story" }, { status: 404 });

  const start = Date.parse(h.starts_at);
  const now = Date.now();
  const sorted = [...work.skeleton.chapters].sort((a, b) => a.n - b.n);
  const every = Math.min(45, Math.floor(540 / Math.max(1, sorted.length - 2))) * 60_000;
  const view: HuntStoryView = {
    title: work.skeleton.title,
    logline: work.skeleton.logline,
    opensAt: h.starts_at,
    chapters:
      start > now
        ? []
        : sorted.map((c, i) => {
            const at = start + Math.max(0, i - 1) * every;
            const open = at <= now;
            return {
              n: c.n,
              title: c.title,
              setting: open ? c.setting : "",
              opensAt: new Date(at).toISOString(),
              paragraphs: open ? (work.chapters?.[c.n]?.text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [],
            };
          }),
    pictures: [],
  };
  return Response.json(view);
}

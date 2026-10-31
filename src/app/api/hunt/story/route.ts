import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Work } from "@/lib/story/engine";
import type { HuntStoryView } from "@/game/hunt";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/hunt/story?hunt=…: a story hunt's story for the scroll on the map (owner, 31 Oct 2026: "a scroll that user
 * can always open and close"). Only what a reader sees: the title, the logline, each chapter's title, setting and text,
 * and the uploaded pictures; never the answers, decoys or live pieces kept with it. The chapters open with the hunt.
 * 404 for a hunt that isn't a published story hunt.
 */
export async function GET(request: NextRequest) {
  const { data: auth } = await (await createClient()).auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Not signed in" }, { status: 401 });
  const hunt = request.nextUrl.searchParams.get("hunt") ?? "";
  if (!UUID.test(hunt)) return Response.json({ error: "Unknown hunt" }, { status: 404 });

  const db = createAdminClient();
  const { data: h } = await db.from("hunts").select("story, story_status, published, starts_at, story_pictures(n, chapter, path)").eq("id", hunt).maybeSingle();
  const work = h?.story as Work | null | undefined;
  if (!h?.published || h.story_status !== "ready" || !work?.skeleton) return Response.json({ error: "No story" }, { status: 404 });

  const open = Date.parse(h.starts_at) <= Date.now();
  const view: HuntStoryView = {
    title: work.skeleton.title,
    logline: work.skeleton.logline,
    opensAt: h.starts_at,
    chapters: open
      ? [...work.skeleton.chapters]
          .sort((a, b) => a.n - b.n)
          .map((c) => ({
            n: c.n,
            title: c.title,
            setting: c.setting,
            paragraphs: (work.chapters?.[c.n]?.text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
          }))
      : [],
    pictures: open
      ? [...(h.story_pictures ?? [])]
          .filter((p) => p.path)
          .sort((a, b) => a.n - b.n)
          .map((p) => ({ chapter: p.chapter, url: db.storage.from("story-pictures").getPublicUrl(p.path!).data.publicUrl }))
      : [],
  };
  return Response.json(view);
}

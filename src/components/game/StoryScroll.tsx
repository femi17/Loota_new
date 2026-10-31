"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HuntStoryView } from "@/game/hunt";

/** The scroll remembers the chapter each hunter was reading, per hunt (a convenience: fine if storage is off). */
const chapterKey = (hunt: string) => `loota_story_chapter_${hunt}`;
const seenKey = (hunt: string) => `loota_story_seen_${hunt}`;
const recall = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage off (a private window): the scroll just starts at the beginning.
  }
};

/** The hunt's story from the game's server; null: not a story hunt; undefined: offline for a moment (try again later). */
async function storyOf(hunt: string): Promise<HuntStoryView | null | undefined> {
  try {
    const res = await fetch(`/api/hunt/story?hunt=${hunt}`);
    return res.ok ? ((await res.json()) as HuntStoryView) : null;
  } catch {
    return undefined;
  }
}

/**
 * A story hunt's story (owner, 31 Oct 2026), for the scroll: null while it's loading or when the hunt has no story.
 * Asked again when the chapters should have opened (the hunt starts at 9 am) and the scroll is opened.
 */
export function useHuntStory(huntId: string | null) {
  const [loaded, setLoaded] = useState<{ hunt: string; story: HuntStoryView | null } | null>(null);
  const load = useCallback(() => {
    if (huntId) void storyOf(huntId).then((story) => story !== undefined && setLoaded({ hunt: huntId, story }));
  }, [huntId]);
  useEffect(() => {
    if (!huntId) return;
    let live = true;
    void storyOf(huntId).then((story) => live && story !== undefined && setLoaded({ hunt: huntId, story }));
    return () => {
      live = false;
    };
  }, [huntId]);
  const story = huntId && loaded?.hunt === huntId ? loaded.story : null;
  // Not read yet on this phone: the button glows until the scroll is first opened.
  const [seenNow, setSeenNow] = useState(false);
  const unseen = !!huntId && !!story?.chapters.length && !seenNow && recall(seenKey(huntId)) !== "1";
  const seen = useCallback(() => {
    if (huntId) remember(seenKey(huntId), "1");
    setSeenNow(true);
  }, [huntId]);
  return { story, reload: load, unseen, seen };
}

export function ScrollIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4h11a2 2 0 0 1 2 2v12" />
      <path d="M6 4a2 2 0 0 0-2 2v1h4V6a2 2 0 0 0-2-2Z" />
      <path d="M8 7v11a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1H12v1a2 2 0 0 1-4 0" />
      <path d="M11 9h5M11 12h5" />
    </svg>
  );
}

const chapterName = (c: { n: number }, all: { n: number }[]) =>
  c.n === 0 ? "Prologue" : all.length > 2 && c.n === all[all.length - 1].n ? "Epilogue" : `Chapter ${c.n}`;

const opensWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-NG", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

/**
 * The story, on a scroll the hunter can open and close at any time (owner, 31 Oct 2026: "a scroll that user can always
 * open and close"): read like a comprehension, chapter by chapter, with the story's pictures in place. Nothing in it is
 * an answer; the answers are dug out of it.
 */
export function StoryScroll({ huntId, story, onClose, reload }: { huntId: string; story: HuntStoryView; onClose: () => void; reload: () => void }) {
  const chapters = story.chapters;
  const [at, setAt] = useState(() => {
    const saved = Number(recall(chapterKey(huntId)));
    return Number.isInteger(saved) && saved >= 0 && saved < chapters.length ? saved : 0;
  });
  const page = useRef<HTMLDivElement>(null);
  const opened = chapters.length > 0;

  // The chapters open with the hunt: ask again if they should be open by now.
  useEffect(() => {
    if (!opened && Date.parse(story.opensAt) <= Date.now()) reload();
  }, [opened, story.opensAt, reload]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (i: number) => {
    setAt(i);
    remember(chapterKey(huntId), String(i));
    page.current?.scrollTo({ top: 0 });
  };

  const c = chapters[Math.min(at, chapters.length - 1)];
  const pictures = c ? story.pictures.filter((p) => p.chapter === c.n) : [];
  // The chapter's pictures spread through its text: the first under the title, the rest between paragraphs.
  const pictureBefore = new Map(pictures.map((p, j) => [Math.round((j * (c?.paragraphs.length ?? 0)) / pictures.length), p]));

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 pt-[env(safe-area-inset-top)] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="The story">
      <div className="relative flex h-full w-full max-w-2xl flex-col sm:h-[88dvh]">
        {/* The scroll's top rod */}
        <div className="relative z-10 mx-auto h-4 w-full shrink-0 sm:w-[104%] rounded-full bg-[linear-gradient(#8A5A2B,#5A3615)] shadow-[0_3px_6px_rgba(0,0,0,0.45)]" aria-hidden="true" />
        <div className="-my-2 flex min-h-0 flex-1 flex-col bg-[radial-gradient(ellipse_at_50%_20%,#F7EBCF_0%,#EBD6A8_70%,#DDC290_100%)] text-[#3B2A16] shadow-[inset_0_0_40px_rgba(120,80,30,0.35)]">
          <div className="flex items-start gap-3 border-b border-[#3B2A16]/15 px-5 pb-3 pt-5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#7A4E1F]">The story</p>
              <h2 className="font-display text-2xl font-extrabold leading-tight">{story.title}</h2>
            </div>
            <button
              type="button"
              aria-label="Close the scroll"
              onClick={onClose}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#3B2A16] text-lg font-bold text-[#F7EBCF]"
            >
              ✕
            </button>
          </div>

          {opened && (
            <label className="flex items-center gap-2 border-b border-[#3B2A16]/15 px-5 py-2 text-sm">
              <span className="sr-only">Chapter</span>
              <select
                value={at}
                onChange={(e) => go(Number(e.target.value))}
                className="h-10 min-w-0 flex-1 rounded-lg border border-[#3B2A16]/30 bg-[#F7EBCF] px-2 font-bold text-[#3B2A16]"
              >
                {chapters.map((x, i) => (
                  <option key={x.n} value={i}>
                    {chapterName(x, chapters)} · {x.title}
                  </option>
                ))}
              </select>
              <span className="shrink-0 text-xs text-[#7A4E1F]">
                {at + 1} of {chapters.length}
              </span>
            </label>
          )}

          <div ref={page} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 font-serif text-[1.05rem] leading-relaxed sm:px-8">
            {!opened || !c ? (
              <div className="flex flex-col gap-3">
                <p className="italic">{story.logline}</p>
                <p className="rounded-xl bg-[#3B2A16]/10 p-3 text-sm not-italic">
                  The story opens with the hunt, at {opensWhen(story.opensAt)} (Lagos time). Every answer is hidden in it.
                </p>
              </div>
            ) : (
              <article className="flex flex-col gap-4" data-chapter={c.n}>
                <header>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#7A4E1F]">{chapterName(c, chapters)}</p>
                  <h3 className="font-display text-xl font-extrabold leading-snug">{c.title}</h3>
                  {c.setting && <p className="mt-1 text-sm italic text-[#5C4426]">{c.setting}</p>}
                </header>
                {c.paragraphs.map((text, i) => (
                  <div key={i} className="contents">
                    {pictureBefore.has(i) && (
                      // eslint-disable-next-line @next/next/no-img-element -- the owner's uploaded picture, from Storage
                      <img src={pictureBefore.get(i)!.url} alt="" className="aspect-video w-full rounded-lg object-cover shadow-[0_4px_14px_rgba(59,42,22,0.35)] ring-1 ring-[#3B2A16]/20" />
                    )}
                    <p>{text}</p>
                  </div>
                ))}
              </article>
            )}
          </div>

          {opened && (
            <div className="flex gap-2 border-t border-[#3B2A16]/15 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                disabled={at === 0}
                onClick={() => go(at - 1)}
                className="h-11 flex-1 rounded-xl border-[1.5px] border-[#3B2A16]/40 font-bold disabled:opacity-40"
              >
                ‹ Previous
              </button>
              <button
                type="button"
                disabled={at >= chapters.length - 1}
                onClick={() => go(at + 1)}
                className="h-11 flex-1 rounded-xl bg-[#3B2A16] font-bold text-[#F7EBCF] disabled:opacity-40"
              >
                Next ›
              </button>
            </div>
          )}
        </div>
        {/* The scroll's bottom rod */}
        <div className="relative z-10 mx-auto h-4 w-full shrink-0 sm:w-[104%] rounded-full bg-[linear-gradient(#8A5A2B,#5A3615)] shadow-[0_-3px_6px_rgba(0,0,0,0.35)]" aria-hidden="true" />
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { draftStory, saveStory } from "./actions";

const LABEL = (beat: string) =>
  beat === "start" ? "The start" : beat === "finish" ? "The finish" : beat.startsWith("relay:") ? `A relay chest (on the way to Key ${beat.slice(6)})` : `After Key ${beat.slice(4)}`;

/**
 * A hunt's story in /admin (owner, 24 Oct 2026: the Masquerade, light and playful): a box per beat, one line each
 * ("Masquerade: …", "Keeper: …", "Narrator: …"); Claude can draft them all. An empty box tells the default.
 */
export function StoryEditor({ hunt, beats, initial }: { hunt: string; beats: string[]; initial: Record<string, string> }) {
  const [text, setText] = useState<Record<string, string>>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();
  const field = "w-full rounded-xl border-[1.5px] border-line bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-gold";

  return (
    <details className="rounded-2xl bg-ink-2 p-4">
      <summary className="cursor-pointer font-bold">🎭 The story ({Object.values(text).filter((t) => t.trim()).length} of {beats.length} beats written)</summary>
      <form action={saveStory} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="hunt" value={hunt} />
        <p className="text-xs text-muted">
          One line each: <b>Masquerade:</b> …, <b>Keeper:</b> … or <b>Narrator:</b> …. Leave a box empty for the default. Never name the places: hunters
          see each beat only when they reach it, but it would still give the game away.
        </p>
        <button
          type="button"
          disabled={drafting}
          onClick={() =>
            startDrafting(async () => {
              setMessage(null);
              const r = await draftStory(hunt, beats);
              if (r.ok) setText((t) => ({ ...t, ...r.beats }));
              else setMessage(r.message);
            })
          }
          className="h-11 self-start rounded-xl bg-[#9B5DE5] px-4 text-sm font-bold text-paper disabled:opacity-60"
        >
          {drafting ? "Drafting…" : "✨ Draft the story with Claude"}
        </button>
        {message && <p className="text-sm text-danger">{message}</p>}
        {beats.map((beat) => (
          <label key={beat} className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{LABEL(beat)}</span>
            <textarea
              name={`beat:${beat}`}
              rows={4}
              value={text[beat] ?? ""}
              onChange={(e) => setText((t) => ({ ...t, [beat]: e.target.value }))}
              placeholder={"Masquerade: Hehehe! …\nKeeper: …"}
              className={field}
            />
          </label>
        ))}
        <button type="submit" className="h-11 rounded-xl bg-gold font-bold text-ink">
          Save the story
        </button>
      </form>
    </details>
  );
}

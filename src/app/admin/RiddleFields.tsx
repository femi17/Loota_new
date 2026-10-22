"use client";

import { useState, useTransition } from "react";
import { draftRiddles } from "./actions";

type Draft = { riddle: string; clue: string; why: string };
const field = "h-11 rounded-xl border-[1.5px] border-line bg-ink px-3 text-paper outline-none focus:border-gold";

/**
 * A key's riddle and Final Approach clue, typed or drafted by Claude (owner, 22 Oct 2026): name the place, pick a
 * draft, edit it if you like. The fields post with the "Add key" form as before.
 */
export function RiddleFields() {
  const [riddle, setRiddle] = useState("");
  const [clue, setClue] = useState("");
  const [place, setPlace] = useState("");
  const [level, setLevel] = useState<"easy" | "medium" | "hard">("medium");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();

  const draft = () =>
    startDrafting(async () => {
      setMessage(null);
      const result = await draftRiddles(place, level);
      if (result.ok) setDrafts(result.drafts);
      else setMessage(result.message);
    });

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Riddle</span>
          <textarea
            name="riddle"
            required
            minLength={5}
            maxLength={500}
            rows={2}
            value={riddle}
            onChange={(e) => setRiddle(e.target.value)}
            className={`${field} h-auto w-full py-2`}
          />
          <span className="text-xs text-muted">Points to an area (a landmark, district or city).</span>
        </label>
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-ink p-2" aria-label="Draft a riddle with Claude">
          <input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // not the Add key form
                draft();
              }
            }}
            placeholder="The place, e.g. National Theatre, Iganmu, Lagos"
            aria-label="The place the riddle points to"
            className={`${field} min-w-0 flex-1 basis-56`}
          />
          <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label="How hard" className={field}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <button
            type="button"
            onClick={draft}
            disabled={drafting}
            className="h-11 rounded-xl bg-[#9B5DE5] px-4 text-sm font-bold text-paper disabled:opacity-60"
          >
            {drafting ? "Drafting…" : "✨ Draft with Claude"}
          </button>
        </div>
        {message && (
          <p role="status" className="text-sm text-danger">
            {message}
          </p>
        )}
        {drafts.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Riddle drafts">
            {drafts.map((d) => (
              <li key={d.riddle}>
                <button
                  type="button"
                  onClick={() => {
                    setRiddle(d.riddle);
                    setClue(d.clue);
                  }}
                  className={`w-full rounded-xl p-3 text-left text-sm ring-1 ${riddle === d.riddle ? "bg-[#3B2F0A] ring-gold" : "bg-ink ring-line"}`}
                >
                  <span className="block font-bold">&ldquo;{d.riddle}&rdquo;</span>
                  <span className="block text-xs text-muted">Final approach: {d.clue}</span>
                  <span className="block text-xs text-muted">Why: {d.why}</span>
                </button>
              </li>
            ))}
            <li className="text-xs text-muted">Tap one to use it, then edit it if you like. Check the facts before publishing.</li>
          </ul>
        )}
      </div>
      <div className="min-w-0 sm:col-span-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Final Approach clue (optional)</span>
          <input name="clue" maxLength={300} value={clue} onChange={(e) => setClue(e.target.value)} className={field} />
          <span className="text-xs text-muted">Shown only to hunters who reach the area.</span>
        </label>
      </div>
    </>
  );
}

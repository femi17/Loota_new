"use client";

import { useState } from "react";

type Props = { p: { theme: string; words: { shown: string; clue: string; letters: number }[] }; disabled: boolean; onDone: (a: unknown) => void; onProgress: (share: number) => void };

/** Lost Vowels (owner, 1 Nov 2026): type each word whole; "Check" sends them once every word has its letters. */
export function VowelsPlay({ p, disabled, onDone, onProgress }: Props) {
  const [words, setWords] = useState<string[]>(() => p.words.map(() => ""));
  const letters = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");
  const ready = p.words.map((w, i) => letters(words[i]).length === w.letters);
  const all = ready.every(Boolean);
  // Only the letters the skeleton allows where it shows a letter (the vowels are the player's to find).
  const fits = (i: number) => {
    const typed = letters(words[i]);
    const shown = p.words[i].shown.replace(/ /g, "");
    return [...typed].every((ch, j) => shown[j] === undefined || shown[j] === "_" || shown[j] === ch);
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-xl bg-[#F5ECD8] px-3 py-2 text-center font-display text-lg font-extrabold text-[#3A2410]">{p.theme}</p>
      {p.words.map((w, i) => (
        <label key={i} className="flex flex-col gap-1 rounded-xl bg-ink p-2.5 ring-1 ring-line">
          <span className="font-mono text-lg font-extrabold tracking-[0.25em] text-gold" aria-label={`Word ${i + 1}: ${w.shown.replace(/_/g, " blank ")}`}>
            {w.shown}
          </span>
          <span className="text-xs text-muted">{w.clue}</span>
          <input
            value={words[i]}
            disabled={disabled}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label={`Word ${i + 1}`}
            onChange={(e) => {
              const next = words.map((v, k) => (k === i ? e.target.value.toUpperCase() : v));
              setWords(next);
              onProgress(next.filter((v, k) => letters(v).length === p.words[k].letters).length / p.words.length);
            }}
            className={`h-11 rounded-lg border-[1.5px] bg-ink-2 px-3 font-mono text-base font-bold uppercase tracking-widest text-paper outline-none ${
              !fits(i) ? "border-danger" : ready[i] ? "border-[#1E9E62]" : "border-line focus:border-gold"
            }`}
          />
          {!fits(i) && <span className="text-xs text-danger-text">The consonants don&apos;t match: only add vowels.</span>}
        </label>
      ))}
      <button
        type="button"
        disabled={disabled || !all}
        onClick={() => onDone(words.map(letters))}
        className="h-12 rounded-xl bg-gold font-display text-base font-extrabold text-ink disabled:opacity-35"
      >
        {all ? "Check the words ✓" : "Fill in every word, then check"}
      </button>
    </div>
  );
}

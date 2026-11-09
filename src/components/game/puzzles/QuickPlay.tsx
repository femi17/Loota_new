"use client";

import { useEffect } from "react";
import { countryFor } from "@/game/puzzles/countries";
import { useAnswer } from "./mirror";

type Done = { disabled: boolean; onDone: (a: unknown) => void; onProgress: (share: number) => void };

/**
 * A few questions, each with a choice of answers (owner, 4 Nov 2026: grammar, guess the flag, guess the logo): tap
 * one answer for each; "Check" sends them once every question has one. A question is a sentence with a gap, or a
 * picture (a flag, a logo).
 */
export function ChoicePlay({ items, disabled, onDone, onProgress }: Done & { items: { sentence?: string; image?: string; clue?: string; options: string[] }[] }) {
  const [picks, setPicks] = useAnswer<(number | null)[]>("picks", () => items.map(() => null));
  const done = picks.filter((p) => p !== null).length;
  useEffect(() => onProgress(done / items.length), [done, items.length, onProgress]);
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl bg-ink p-2.5 ring-1 ring-line" data-question={i}>
          {item.image && (
            // A flag or a logo, drawn from its own file (its name doesn't say whose it is)
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt={`Picture ${i + 1}`} className="mx-auto h-20 w-auto rounded-md shadow ring-1 ring-black/20" draggable={false} />
          )}
          {item.sentence && (
            <p className="text-base font-bold">
              {item.sentence.split("___").map((part, k, all) => (
                <span key={k}>
                  {part}
                  {k < all.length - 1 && <span className="mx-1 inline-block min-w-12 border-b-2 border-gold text-center text-gold">{picks[i] !== null ? item.options[picks[i]!] : " "}</span>}
                </span>
              ))}
            </p>
          )}
          {item.clue && <p className="text-sm font-bold">{item.clue}</p>}
          <div className="grid grid-cols-2 gap-1.5">
            {item.options.map((o, j) => (
              <button
                key={j}
                type="button"
                disabled={disabled}
                onClick={() => setPicks((ps) => ps.map((p, k) => (k === i ? j : p)))}
                className={`min-h-10 rounded-lg px-2 text-sm font-bold ring-1 ${picks[i] === j ? "bg-gold text-ink ring-gold" : "bg-ink-2 text-paper ring-line"}`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled || done < items.length}
        onClick={() => onDone(picks)}
        className="h-12 rounded-xl bg-gold font-display text-base font-extrabold text-ink disabled:opacity-35"
      >
        {done < items.length ? "Answer every one, then check" : "Check ✓"}
      </button>
    </div>
  );
}

/** Algebra (owner, 4 Nov 2026: "simple algebra"): type x for each equation; "Check" sends them. */
export function AlgebraPlay({ items, disabled, onDone, onProgress }: Done & { items: { equation: string }[] }) {
  const [xs, setXs] = useAnswer<string[]>("xs", () => items.map(() => ""));
  const done = xs.filter((x) => /^-?\d+$/.test(x.trim())).length;
  useEffect(() => onProgress(done / items.length), [done, items.length, onProgress]);
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <label key={i} className="flex items-center gap-3 rounded-xl bg-ink p-2.5 ring-1 ring-line">
          <span className="min-w-0 flex-1 font-mono text-lg font-extrabold text-gold">{item.equation}</span>
          <span className="font-mono font-bold">x =</span>
          <input
            value={xs[i]}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="off"
            aria-label={`x in ${item.equation}`}
            onChange={(e) => setXs((v) => v.map((x, k) => (k === i ? e.target.value.replace(/[^\d-]/g, "").slice(0, 4) : x)))}
            className="h-11 w-20 rounded-lg border-[1.5px] border-line bg-ink-2 px-2 text-center font-mono text-lg font-bold text-paper outline-none focus:border-gold"
          />
        </label>
      ))}
      <button
        type="button"
        disabled={disabled || done < items.length}
        onClick={() => onDone(xs.map((x) => Number(x)))}
        className="h-12 rounded-xl bg-gold font-display text-base font-extrabold text-ink disabled:opacity-35"
      >
        {done < items.length ? "Find every x, then check" : "Check ✓"}
      </button>
    </div>
  );
}

/** Name the countries (owner, 4 Nov 2026: "type 5 coutries starting with L"): each one ticks as it's recognised. */
export function CountriesPlay({ p, disabled, onDone, onProgress }: Done & { p: { letter: string; count: number } }) {
  const [names, setNames] = useAnswer<string[]>("names", () => Array.from({ length: p.count }, () => ""));
  const found = names.map((n) => {
    const c = n.trim() ? countryFor(n, p.letter) : null;
    return c ? c.code : null;
  });
  const twice = (i: number) => found[i] !== null && found.indexOf(found[i]) !== i;
  const good = found.filter((c, i) => c !== null && !twice(i)).length;
  useEffect(() => onProgress(good / p.count), [good, p.count, onProgress]);
  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-xl bg-[#F5ECD8] px-3 py-2 text-center font-display text-lg font-extrabold text-[#3A2410]">
        {p.count} countries starting with {p.letter}
      </p>
      {names.map((n, i) => (
        <input
          key={i}
          value={n}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Country ${i + 1}`}
          placeholder={`${p.letter}…`}
          onChange={(e) => setNames((v) => v.map((x, k) => (k === i ? e.target.value : x)))}
          className={`h-11 rounded-lg border-[1.5px] bg-ink-2 px-3 text-base font-bold text-paper outline-none ${
            twice(i) ? "border-danger" : found[i] ? "border-[#1E9E62]" : "border-line focus:border-gold"
          }`}
        />
      ))}
      <button
        type="button"
        disabled={disabled || good < p.count}
        onClick={() => onDone(names)}
        className="h-12 rounded-xl bg-gold font-display text-base font-extrabold text-ink disabled:opacity-35"
      >
        {good < p.count ? `${good} of ${p.count} named` : "Check ✓"}
      </button>
    </div>
  );
}

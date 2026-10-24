"use client";

import { useMemo } from "react";

type Sign = { cell: number; dir: "r" | "d"; same: boolean };

/** An indigo square with the resist-dyed circles of adire eleko; a white one with a faint dot. */
function Dye({ indigo }: { indigo: boolean }) {
  return indigo ? (
    <svg viewBox="0 0 20 20" className="size-full" aria-hidden="true">
      <rect width="20" height="20" fill="#1F3B73" />
      <circle cx="10" cy="10" r="5.2" fill="none" stroke="#9DB7E8" strokeWidth="1.1" />
      <circle cx="10" cy="10" r="2" fill="#9DB7E8" />
      <circle cx="3" cy="3" r="1" fill="#6F8FCB" />
      <circle cx="17" cy="17" r="1" fill="#6F8FCB" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className="size-full" aria-hidden="true">
      <rect width="20" height="20" fill="#FBF6EA" />
      <circle cx="10" cy="10" r="1.6" fill="#D9CBA8" />
    </svg>
  );
}

/**
 * Adire (after Tango): tap a square to dye it indigo, again for white, again to clear. The dyed squares given at the
 * start can't be changed. With `warn`, squares breaking a rule are outlined in red (early keys only).
 */
export function AdireBoard({
  n,
  given,
  signs,
  cloth,
  warn,
  disabled,
  onTap,
}: {
  n: number;
  given: Record<number, 0 | 1>;
  signs: Sign[];
  /** Per square: −1 not dyed, 0 white, 1 indigo. */
  cloth: number[];
  warn: boolean;
  disabled: boolean;
  onTap: (cell: number) => void;
}) {
  const bad = useMemo(() => {
    const out = new Set<number>();
    if (!warn) return out;
    const lines = [
      ...[...Array(n).keys()].map((r) => [...Array(n).keys()].map((c) => r * n + c)),
      ...[...Array(n).keys()].map((c) => [...Array(n).keys()].map((r) => r * n + c)),
    ];
    for (const line of lines) {
      for (let k = 2; k < n; k++) {
        const v = cloth[line[k]];
        if (v >= 0 && v === cloth[line[k - 1]] && v === cloth[line[k - 2]]) [line[k], line[k - 1], line[k - 2]].forEach((i) => out.add(i));
      }
      for (const v of [0, 1]) if (line.filter((i) => cloth[i] === v).length > n / 2) line.filter((i) => cloth[i] === v).forEach((i) => out.add(i));
    }
    for (const s of signs) {
      const other = s.dir === "r" ? s.cell + 1 : s.cell + n;
      if (cloth[s.cell] >= 0 && cloth[other] >= 0 && (cloth[s.cell] === cloth[other]) !== s.same) {
        out.add(s.cell);
        out.add(other);
      }
    }
    return out;
  }, [cloth, n, signs, warn]);

  const size = 100 / n;
  return (
    <div className="relative aspect-square w-full touch-manipulation select-none overflow-hidden rounded-xl bg-[#D9CBA8] ring-2 ring-[#3A2410]" role="grid" aria-label="Adire board">
      <div className="absolute inset-0 grid gap-[2px] p-[2px]" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {cloth.map((v, i) => {
          const fixed = given[i] !== undefined;
          return (
            <button
              key={i}
              type="button"
              data-cell={i}
              disabled={disabled || fixed}
              onClick={() => onTap(i)}
              aria-label={`Row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}: ${v === 1 ? "indigo" : v === 0 ? "white" : "not dyed"}${fixed ? " (given)" : ""}`}
              className={`relative overflow-hidden rounded-[3px] ${v < 0 ? "bg-[#EFE6D2]" : ""} ${bad.has(i) ? "ring-2 ring-inset ring-[#E5484D]" : ""} disabled:cursor-default`}
            >
              {v >= 0 && <Dye indigo={v === 1} />}
              {fixed && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-[#C08A2E]" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {/* The signs between squares */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {signs.map((s) => {
          const r = Math.floor(s.cell / n), c = s.cell % n;
          const x = s.dir === "r" ? (c + 1) * size : (c + 0.5) * size;
          const y = s.dir === "d" ? (r + 1) * size : (r + 0.5) * size;
          return (
            <span
              key={`${s.cell}${s.dir}`}
              className="absolute flex size-[5.5%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#3A2410] text-[min(3vw,13px)] font-extrabold leading-none text-[#F5ECD8]"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {s.same ? "=" : "×"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

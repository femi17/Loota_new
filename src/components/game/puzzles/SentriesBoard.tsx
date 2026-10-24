"use client";

import { useMemo } from "react";

/** The districts' colours: earth, cloth and market tones (up to 9 districts). */
const DISTRICT = ["#F2B591", "#9CC8E8", "#F6DA7A", "#A9D8A6", "#CDB2E6", "#F4A3A0", "#9FDCD0", "#F7C98B", "#C5CCD3"];

/** A sentry: a shield with a spear behind it. */
function Sentry({ bad }: { bad: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[72%]" aria-hidden="true">
      <path d="M19 3 L8.5 17.5" stroke={bad ? "#B42318" : "#3A2410"} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M19 3 l-0.4 3 -2.2-1.6z" fill={bad ? "#B42318" : "#3A2410"} />
      <path d="M12 5.5c2 1.3 4.2 1.8 6 1.8 0 5.4-2.3 9.4-6 11.2-3.7-1.8-6-5.8-6-11.2 1.8 0 4-0.5 6-1.8z" fill={bad ? "#E5484D" : "#1E3A6E"} stroke={bad ? "#7A1C14" : "#0E1F3D"} strokeWidth="1" />
      <path d="M12 8.2v7.6M9 11.5h6" stroke="#F5ECD8" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Sentries (after Queens): tap a square once for ✕ (ruled out), twice for a sentry, a third time to clear it. With
 * `warn`, sentries that break a rule turn red (early keys only).
 */
export function SentriesBoard({
  n,
  regions,
  marks,
  warn,
  disabled,
  onTap,
}: {
  n: number;
  regions: number[];
  /** Per square: 0 empty, 1 ✕, 2 a sentry. */
  marks: number[];
  warn: boolean;
  disabled: boolean;
  onTap: (cell: number) => void;
}) {
  // Sentries breaking a rule: the same row, column or district as another, or touching one.
  const bad = useMemo(() => {
    const out = new Set<number>();
    if (!warn) return out;
    const placed = marks.flatMap((m, i) => (m === 2 ? [i] : []));
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue;
        const ra = Math.floor(a / n), ca = a % n, rb = Math.floor(b / n), cb = b % n;
        if (ra === rb || ca === cb || regions[a] === regions[b] || (Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1)) {
          out.add(a);
          out.add(b);
        }
      }
    }
    return out;
  }, [marks, n, regions, warn]);

  return (
    <div
      className="grid aspect-square w-full touch-manipulation select-none overflow-hidden rounded-xl ring-2 ring-[#3A2410]"
      style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
      role="grid"
      aria-label="Sentries board"
    >
      {regions.map((g, i) => {
        const r = Math.floor(i / n), c = i % n;
        // Thick lines where districts meet.
        const edge = (other: number | null) => (other === null || regions[other] !== g ? "2.5px solid #3A2410" : "1px solid rgba(58,36,16,0.18)");
        return (
          <button
            key={i}
            type="button"
            data-cell={i}
            disabled={disabled}
            onClick={() => onTap(i)}
            aria-label={`Row ${r + 1}, column ${c + 1}${marks[i] === 2 ? ": sentry" : marks[i] === 1 ? ": ruled out" : ""}`}
            className="relative flex items-center justify-center transition-[filter] active:brightness-90"
            style={{
              background: DISTRICT[g % DISTRICT.length],
              borderTop: r === 0 ? "none" : edge(i - n),
              borderLeft: c === 0 ? "none" : edge(i - 1),
            }}
          >
            {marks[i] === 1 && <span className="text-[min(4vw,18px)] font-bold text-[#3A2410]/55">✕</span>}
            {marks[i] === 2 && <Sentry bad={bad.has(i)} />}
          </button>
        );
      })}
    </div>
  );
}

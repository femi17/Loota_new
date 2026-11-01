"use client";

import { useEffect, useRef, useState } from "react";
import { placedCells, turned, type PatchworkPlacement } from "@/game/puzzles/patchwork";

type Cell = [number, number];
type Props = { p: { n: number; target: number[]; pieces: Cell[][] }; disabled: boolean; onDone: (a: unknown) => void; onProgress: (share: number) => void };

const PATCH = ["#E5484D", "#2F6FEB", "#F4B41A", "#1E9E62", "#9B5DE5", "#F28C28", "#2EC4B6", "#E890C8", "#8A5A3A", "#5A7A9A"];

/**
 * Patchwork (owner, 1 Nov 2026): pick a patch, turn it (↻) if you need to, then tap the square where its marked
 * square goes; tap a placed patch to pick it up again. Sent the moment every patch is placed in the outline.
 */
export function PatchworkPlay({ p, disabled, onDone, onProgress }: Props) {
  const { n, pieces } = p;
  const target = new Set(p.target);
  const [turns, setTurns] = useState<number[]>(() => pieces.map(() => 0));
  const [placed, setPlaced] = useState<(PatchworkPlacement | null)[]>(() => pieces.map(() => null));
  const [picked, setPicked] = useState<number | null>(0);
  const [note, setNote] = useState<string | null>(null);
  const owner = new Map<number, number>();
  placed.forEach((x, k) => x && placedCells(pieces[k], x.turns, x.r, x.c).forEach(([r, c]) => owner.set(r * n + c, k)));
  const count = placed.filter(Boolean).length;
  useEffect(() => onProgress(count / pieces.length), [count, pieces.length, onProgress]);
  const sent = useRef(false);
  useEffect(() => {
    if (count === pieces.length && !sent.current) {
      sent.current = true;
      onDone(placed);
    }
  });

  const tapSquare = (i: number) => {
    if (disabled) return;
    setNote(null);
    const here = owner.get(i);
    if (here !== undefined) {
      setPlaced((x) => x.map((v, k) => (k === here ? null : v)));
      setPicked(here);
      return;
    }
    if (picked === null || placed[picked]) return setNote("Pick a patch from the pile first.");
    const r = Math.floor(i / n), c = i % n;
    const cells = placedCells(pieces[picked], turns[picked], r, c);
    const fits = cells.every(([a, b]) => a >= 0 && b >= 0 && a < n && b < n && target.has(a * n + b) && !owner.has(a * n + b));
    if (!fits) return setNote("It doesn't fit there: put its marked square somewhere else, or turn it.");
    setPlaced((x) => x.map((v, k) => (k === picked ? { piece: picked, turns: turns[picked], r, c } : v)));
    setPicked(placed.findIndex((v, k) => !v && k !== picked) >= 0 ? placed.findIndex((v, k) => !v && k !== picked) : null);
  };

  const mini = (k: number) => {
    const cells = turned(pieces[k], turns[k]);
    const h = Math.max(...cells.map(([r]) => r)) + 1, w = Math.max(...cells.map(([, c]) => c)) + 1;
    return (
      <svg viewBox={`0 0 ${w * 10} ${h * 10}`} className="max-h-12 w-full" aria-hidden="true">
        {cells.map(([r, c], j) => (
          <g key={j}>
            <rect x={c * 10 + 0.5} y={r * 10 + 0.5} width={9} height={9} rx={1.5} fill={PATCH[k % PATCH.length]} stroke="#1B1B1B" strokeWidth={0.6} />
            {j === 0 && <circle cx={c * 10 + 5} cy={r * 10 + 5} r={2} fill="#FFFFFF" />}
          </g>
        ))}
      </svg>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid aspect-square w-full overflow-hidden rounded-xl bg-[#1B2230] ring-2 ring-[#3A2410]" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }} role="grid" aria-label="Patchwork board">
        {[...Array(n * n).keys()].map((i) => {
          const k = owner.get(i);
          const inOutline = target.has(i);
          return (
            <button
              key={i}
              type="button"
              data-cell={i}
              disabled={disabled || !inOutline}
              onClick={() => tapSquare(i)}
              aria-label={inOutline ? (k !== undefined ? "A placed patch: tap to pick it up" : "An empty square in the outline") : "Outside the outline"}
              className="border-[0.5px] border-black/30"
              style={{ background: k !== undefined ? PATCH[k % PATCH.length] : inOutline ? "#F5ECD8" : "transparent" }}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-5 gap-1.5" role="listbox" aria-label="The patches">
        {pieces.map((_, k) =>
          placed[k] ? null : (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={picked === k}
              aria-label={`Patch ${k + 1}`}
              disabled={disabled}
              onClick={() => setPicked(k)}
              className={`flex h-16 items-center justify-center rounded-lg p-1.5 ${picked === k ? "bg-gold/30 ring-2 ring-gold" : "bg-ink ring-1 ring-line"}`}
            >
              {mini(k)}
            </button>
          ),
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{note ?? `${count} of ${pieces.length} patches placed`}</span>
        <span className="flex gap-3">
          <button type="button" disabled={disabled || picked === null || !!placed[picked ?? 0]} onClick={() => picked !== null && setTurns((t) => t.map((v, k) => (k === picked ? (v + 1) % 4 : v)))} className="font-bold text-gold disabled:opacity-40">
            ↻ Turn
          </button>
          <button type="button" disabled={disabled || !count} onClick={() => setPlaced(pieces.map(() => null))} className="font-bold text-gold disabled:opacity-40">
            Clear
          </button>
        </span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { checkPlots, type PlotsAnswer } from "@/game/puzzles/plots";

type Props = { p: { n: number; clues: Record<number, number> }; disabled: boolean; onDone: (a: unknown) => void; onProgress: (share: number) => void };

const SHADES = ["#F2B591", "#9CC8E8", "#F6DA7A", "#A9D8A6", "#CDB2E6", "#F4A3A0", "#9FDCD0", "#F7C98B", "#C5CCD3"];

/**
 * Plots (owner, 1 Nov 2026): drag from one corner to the opposite corner to mark a plot (a plot across others replaces
 * them); tap a plot to clear it. Sent the moment the land is divided by the rules.
 */
export function PlotsPlay({ p, disabled, onDone, onProgress }: Props) {
  const { n, clues } = p;
  const [plots, setPlots] = useState<PlotsAnswer>([]);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragRef = useRef<{ from: number; to: number } | null>(null); // at once: a quick drag ends before the next render
  const dragTo = (d: { from: number; to: number } | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const board = useRef<HTMLDivElement>(null);
  const covered = plots.reduce((s, [t, l, b, r]) => s + (b - t + 1) * (r - l + 1), 0);
  useEffect(() => onProgress(covered / (n * n)), [covered, n, onProgress]);
  const right = covered === n * n && checkPlots(p, plots);
  const sent = useRef(false);
  useEffect(() => {
    if (right && !sent.current) {
      sent.current = true;
      onDone(plots);
    }
  });
  const cellAt = (x: number, y: number) => {
    const box = board.current?.getBoundingClientRect();
    if (!box) return -1;
    const c = Math.floor(((x - box.left) / box.width) * n), r = Math.floor(((y - box.top) / box.height) * n);
    return r < 0 || c < 0 || r >= n || c >= n ? -1 : r * n + c;
  };
  const rectOf = (a: number, b: number): [number, number, number, number] => [
    Math.min(Math.floor(a / n), Math.floor(b / n)),
    Math.min(a % n, b % n),
    Math.max(Math.floor(a / n), Math.floor(b / n)),
    Math.max(a % n, b % n),
  ];
  const inside = ([t, l, b, r]: number[], cell: number) => Math.floor(cell / n) >= t && Math.floor(cell / n) <= b && cell % n >= l && cell % n <= r;
  const overlaps = (x: number[], y: number[]) => !(x[2] < y[0] || y[2] < x[0] || x[3] < y[1] || y[3] < x[1]);
  const finish = (from: number, to: number) =>
    setPlots((now) => {
      if (from === to) {
        const hit = now.findIndex((q) => inside(q, from));
        if (hit >= 0) return now.filter((_, k) => k !== hit);
      }
      const rect = rectOf(from, to);
      return [...now.filter((q) => !overlaps(q, rect)), rect];
    });
  // A plot's state: right size with one number (a calm colour), or not yet.
  const fine = ([t, l, b, r]: number[]) => {
    const nums = Object.keys(clues).map(Number).filter((c) => inside([t, l, b, r], c));
    return nums.length === 1 && clues[nums[0]] === (b - t + 1) * (r - l + 1);
  };
  const size = 100 / n;
  const preview = drag ? rectOf(drag.from, drag.to) : null;
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={board}
        className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-xl bg-[#F5ECD8] ring-2 ring-[#3A2410]"
        role="grid"
        aria-label="Plots board"
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const c = cellAt(e.clientX, e.clientY);
          if (c >= 0) dragTo({ from: c, to: c });
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d || disabled) return;
          const c = cellAt(e.clientX, e.clientY);
          if (c >= 0 && c !== d.to) dragTo({ ...d, to: c });
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          const c = cellAt(e.clientX, e.clientY);
          if (d) finish(d.from, c >= 0 ? c : d.to);
          dragTo(null);
        }}
        onPointerCancel={() => dragTo(null)}
      >
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {[...Array(n * n).keys()].map((i) => (
            <div key={i} data-cell={i} className="border-[0.5px] border-[#3A2410]/20" />
          ))}
        </div>
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          {plots.map((q, k) => {
            const [t, l, b, r] = q;
            return (
              <rect key={k} x={l * size + 0.8} y={t * size + 0.8} width={(r - l + 1) * size - 1.6} height={(b - t + 1) * size - 1.6} rx={2}
                fill={fine(q) ? SHADES[k % SHADES.length] : "#E8D2C2"} stroke={fine(q) ? "#3A2410" : "#B42318"} strokeWidth={0.8} opacity={0.92} />
            );
          })}
          {preview && (
            <rect x={preview[1] * size + 0.5} y={preview[0] * size + 0.5} width={(preview[3] - preview[1] + 1) * size - 1} height={(preview[2] - preview[0] + 1) * size - 1} rx={2}
              fill="rgba(244,180,26,0.35)" stroke="#E8960C" strokeWidth={1} strokeDasharray="2 1.5" />
          )}
          {Object.entries(clues).map(([cell, v]) => {
            const i = Number(cell);
            const x = ((i % n) + 0.5) * size, y = (Math.floor(i / n) + 0.5) * size;
            return (
              <g key={cell}>
                <circle cx={x} cy={y} r={size * 0.3} fill="#3A2410" />
                <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.36} fontWeight="800" fill="#F5ECD8">
                  {v}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{covered === n * n && !right ? "All the land is used, but a plot breaks the rules (the red ones)." : `${covered} of ${n * n} squares in plots`}</span>
        <button type="button" disabled={disabled || !plots.length} onClick={() => setPlots([])} className="font-bold text-gold disabled:opacity-40">
          Clear
        </button>
      </div>
    </div>
  );
}

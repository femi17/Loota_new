"use client";

import { useEffect, useRef } from "react";
import { checkThreads } from "@/game/puzzles/threads";
import { useAnswer } from "./mirror";

type Props = { p: { n: number; ends: [number, number][] }; disabled: boolean; onDone: (a: unknown) => void; onProgress: (share: number) => void };

/** Bead colours: bright and easy to tell apart. */
const COLOURS = ["#E5484D", "#2F6FEB", "#F4B41A", "#1E9E62", "#9B5DE5", "#F28C28", "#2EC4B6", "#E890C8"];

/**
 * Threads (owner, 1 Nov 2026): drag from a bead to draw its thread; back over it to take it back; a thread run into
 * another cuts that one. Sent the moment every pair is joined and every square used.
 */
export function ThreadsPlay({ p, disabled, onDone, onProgress }: Props) {
  const { n, ends } = p;
  const [threads, setThreads] = useAnswer<number[][]>("threads", () => ends.map(() => []));
  const board = useRef<HTMLDivElement>(null);
  const drawing = useRef<number | null>(null); // the colour being drawn
  const now = useRef(threads);
  useEffect(() => {
    now.current = threads;
  });
  const beadAt = (cell: number) => ends.findIndex(([a, b]) => a === cell || b === cell);
  const joined = (t: number[], k: number) => t.length > 1 && ends[k].includes(t[0]) && ends[k].includes(t[t.length - 1]) && t[0] !== t[t.length - 1];
  const used = new Set(threads.flat()).size;
  const done = threads.every((t, k) => joined(t, k)) && checkThreads(p, threads);
  useEffect(() => onProgress(used / (n * n)), [used, n, onProgress]);
  const sent = useRef(false);
  useEffect(() => {
    if (done && !sent.current) {
      sent.current = true;
      onDone(threads);
    }
  });

  const cellAt = (x: number, y: number) => {
    const box = board.current?.getBoundingClientRect();
    if (!box) return -1;
    const c = Math.floor(((x - box.left) / box.width) * n), r = Math.floor(((y - box.top) / box.height) * n);
    return r < 0 || c < 0 || r >= n || c >= n ? -1 : r * n + c;
  };
  const set = (next: number[][]) => {
    now.current = next;
    setThreads(next);
  };
  const start = (cell: number) => {
    const bead = beadAt(cell);
    if (bead >= 0) {
      drawing.current = bead;
      set(now.current.map((t, k) => (k === bead ? [cell] : t)));
      return;
    }
    const k = now.current.findIndex((t) => t.includes(cell));
    if (k >= 0) {
      drawing.current = k;
      set(now.current.map((t, j) => (j === k ? t.slice(0, t.indexOf(cell) + 1) : t)));
    }
  };
  const step = (cell: number) => {
    const k = drawing.current;
    if (k === null || cell < 0) return;
    const t = now.current[k];
    const head = t[t.length - 1];
    if (cell === head) return;
    const back = t.indexOf(cell);
    if (back >= 0) return set(now.current.map((x, j) => (j === k ? x.slice(0, back + 1) : x)));
    if (joined(t, k)) return; // finished: only going back changes it
    const r1 = Math.floor(head / n), c1 = head % n, r2 = Math.floor(cell / n), c2 = cell % n;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;
    const bead = beadAt(cell);
    if (bead >= 0 && bead !== k) return; // another colour's bead: no way through
    // Through another thread: it's cut there.
    const next = now.current.map((x, j) => {
      if (j === k) return [...x, cell];
      const at = x.indexOf(cell);
      return at >= 0 ? x.slice(0, at) : x;
    });
    set(next);
  };

  const size = 100 / n;
  const centre = (i: number) => [((i % n) + 0.5) * size, (Math.floor(i / n) + 0.5) * size];
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={board}
        className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-xl bg-[#1B2230] ring-2 ring-[#3A2410]"
        role="grid"
        aria-label="Threads board"
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          start(cellAt(e.clientX, e.clientY));
        }}
        onPointerMove={(e) => {
          if (!disabled && drawing.current !== null) step(cellAt(e.clientX, e.clientY));
        }}
        onPointerUp={() => (drawing.current = null)}
        onPointerCancel={() => (drawing.current = null)}
      >
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {[...Array(n * n).keys()].map((i) => {
            const k = threads.findIndex((t) => t.includes(i));
            return <div key={i} data-cell={i} className="border-[0.5px] border-white/10" style={{ background: k >= 0 ? `${COLOURS[k % COLOURS.length]}33` : undefined }} />;
          })}
        </div>
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          {threads.map((t, k) =>
            t.length > 1 ? (
              <polyline key={k} points={t.map((i) => centre(i).join(",")).join(" ")} fill="none" stroke={COLOURS[k % COLOURS.length]} strokeWidth={size * 0.32} strokeLinecap="round" strokeLinejoin="round" />
            ) : null,
          )}
          {ends.map(([a, b], k) =>
            [a, b].map((cell) => {
              const [x, y] = centre(cell);
              return <circle key={`${k}-${cell}`} cx={x} cy={y} r={size * 0.33} fill={COLOURS[k % COLOURS.length]} stroke="#FFFFFF" strokeWidth={size * 0.05} />;
            }),
          )}
        </svg>
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {threads.filter((t, k) => joined(t, k)).length} of {ends.length} joined · {used} of {n * n} squares
        </span>
        <button type="button" disabled={disabled} onClick={() => set(ends.map(() => []))} className="font-bold text-gold disabled:opacity-40">
          Clear
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

/**
 * Route (after Zip): drag from 1 through the squares (or tap the next square); going back over the route takes it
 * back to there. Numbers must come in order; walls can't be crossed.
 */
export function RouteBoard({
  n,
  numbers,
  walls,
  path,
  disabled,
  onPath,
}: {
  n: number;
  numbers: Record<number, number>;
  walls: [number, number][];
  path: number[];
  disabled: boolean;
  onPath: (path: number[]) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const blocked = new Set(walls.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)));
  const start = Number(Object.entries(numbers).find(([, v]) => v === 1)?.[0] ?? -1);
  const pathRef = useRef(path); // the latest route, for a drag's many moves between renders
  useEffect(() => {
    pathRef.current = path;
  });

  const cellAt = (x: number, y: number) => {
    const box = board.current?.getBoundingClientRect();
    if (!box) return -1;
    const c = Math.floor(((x - box.left) / box.width) * n), r = Math.floor(((y - box.top) / box.height) * n);
    return r < 0 || c < 0 || r >= n || c >= n ? -1 : r * n + c;
  };
  const touches = (a: number, b: number) => {
    const ra = Math.floor(a / n), ca = a % n, rb = Math.floor(b / n), cb = b % n;
    return Math.abs(ra - rb) + Math.abs(ca - cb) === 1 && !blocked.has(a < b ? `${a}-${b}` : `${b}-${a}`);
  };
  /** The route after reaching `cell`: extended to it, cut back to it, or started from 1. */
  const step = (cell: number) => {
    const now = pathRef.current;
    const go = (next: number[]) => {
      pathRef.current = next; // at once: a fast drag crosses several squares before the next render
      onPath(next);
    };
    if (cell < 0) return;
    const at = now.indexOf(cell);
    if (at >= 0) {
      if (at !== now.length - 1) go(now.slice(0, at + 1));
      return;
    }
    if (now.length === 0) {
      if (cell === start) go([cell]);
      return;
    }
    const head = now[now.length - 1];
    if (!touches(head, cell)) return;
    // The numbers in order: the next number only once every number before it is on the route.
    const num = numbers[cell];
    if (num !== undefined) {
      const reached = now.reduce((m, i) => Math.max(m, numbers[i] ?? 0), 0);
      if (num !== reached + 1) return;
    }
    go([...now, cell]);
  };

  const size = 100 / n;
  const centre = (i: number) => [((i % n) + 0.5) * size, (Math.floor(i / n) + 0.5) * size];
  const points = path.map((i) => centre(i).join(",")).join(" ");

  return (
    <div
      ref={board}
      className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-xl bg-[#F5ECD8] ring-2 ring-[#3A2410]"
      role="grid"
      aria-label="Route board"
      onPointerDown={(e) => {
        if (disabled) return;
        drawing.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        step(cellAt(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => {
        if (drawing.current && !disabled) step(cellAt(e.clientX, e.clientY));
      }}
      onPointerUp={() => (drawing.current = false)}
      onPointerCancel={() => (drawing.current = false)}
    >
      {/* The squares */}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {[...Array(n * n).keys()].map((i) => (
          <div
            key={i}
            data-cell={i}
            className="border-[0.5px] border-[#3A2410]/15"
            style={{ background: path.includes(i) ? "rgba(244,180,26,0.22)" : undefined }}
          />
        ))}
      </div>
      {/* The route, the walls, the numbers */}
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
        {path.length > 1 && (
          <polyline points={points} fill="none" stroke="#E8960C" strokeWidth={size * 0.42} strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
        )}
        {walls.map(([a, b]) => {
          const [ax, ay] = centre(a), [bx, by] = centre(b);
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const across = ay === by; // side by side: the wall stands upright between them
          return across ? (
            <line key={`${a}-${b}`} x1={mx} y1={my - size / 2} x2={mx} y2={my + size / 2} stroke="#3A2410" strokeWidth={size * 0.13} strokeLinecap="round" />
          ) : (
            <line key={`${a}-${b}`} x1={mx - size / 2} y1={my} x2={mx + size / 2} y2={my} stroke="#3A2410" strokeWidth={size * 0.13} strokeLinecap="round" />
          );
        })}
        {Object.entries(numbers).map(([cell, num]) => {
          const [x, y] = centre(Number(cell));
          const on = path.includes(Number(cell));
          return (
            <g key={cell}>
              <circle cx={x} cy={y} r={size * 0.32} fill={on ? "#3A2410" : "#1B1B1B"} stroke="#F5ECD8" strokeWidth={size * 0.04} />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.36} fontWeight="800" fill="#F5ECD8">
                {num}
              </text>
            </g>
          );
        })}
        {path.length > 0 && (() => {
          const [x, y] = centre(path[path.length - 1]);
          return <circle cx={x} cy={y} r={size * 0.12} fill="#FFF7E0" stroke="#3A2410" strokeWidth={size * 0.03} />;
        })()}
      </svg>
    </div>
  );
}

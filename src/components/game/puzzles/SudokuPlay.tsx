"use client";

import { useEffect, useRef, useState } from "react";
import { checkSudoku } from "@/game/puzzles/sudoku";

type Props = { p: { given: number[] }; disabled: boolean; onDone: (a: unknown) => void; onProgress: (share: number) => void };

/**
 * Sudoku, half done (owner, 1 Nov 2026): tap a square, then a number. Numbers that clash with another in the row,
 * column or box turn red. Sent the moment the grid is right.
 */
export function SudokuPlay({ p, disabled, onDone, onProgress }: Props) {
  const [grid, setGrid] = useState<number[]>(() => [...p.given]);
  const [at, setAt] = useState<number | null>(null);
  const open = p.given.filter((d) => !d).length;
  const filled = grid.filter((d, i) => d && !p.given[i]).length;
  useEffect(() => onProgress(filled / Math.max(1, open)), [filled, open, onProgress]);
  const right = filled === open && checkSudoku(p, grid);
  const sent = useRef(false);
  useEffect(() => {
    if (right && !sent.current) {
      sent.current = true;
      onDone(grid);
    }
  });
  const clash = (i: number) => {
    const d = grid[i];
    if (!d) return false;
    const r = Math.floor(i / 9), c = i % 9, b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
    return grid.some((e, j) => j !== i && e === d && (Math.floor(j / 9) === r || j % 9 === c || Math.floor(Math.floor(j / 9) / 3) * 3 + Math.floor((j % 9) / 3) === b));
  };
  const put = (d: number) => {
    if (at === null || p.given[at] || disabled) return;
    setGrid((g) => g.map((v, i) => (i === at ? d : v)));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid aspect-square w-full grid-cols-9 overflow-hidden rounded-xl bg-[#F5ECD8] ring-2 ring-[#3A2410]" role="grid" aria-label="Sudoku board">
        {grid.map((d, i) => {
          const r = Math.floor(i / 9), c = i % 9;
          const given = !!p.given[i];
          const same = at !== null && grid[at] && d === grid[at];
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              data-cell={i}
              onClick={() => setAt(i)}
              aria-label={`Row ${r + 1}, column ${c + 1}${d ? `: ${d}` : ": empty"}`}
              className={`flex items-center justify-center font-display text-[min(5vw,1.4rem)] leading-none ${
                c % 3 === 2 && c < 8 ? "border-r-2 border-r-[#3A2410]" : "border-r border-r-[#3A2410]/20"
              } ${r % 3 === 2 && r < 8 ? "border-b-2 border-b-[#3A2410]" : "border-b border-b-[#3A2410]/20"} ${
                at === i ? "bg-gold/70" : same ? "bg-gold/25" : ""
              } ${given ? "font-extrabold text-[#3A2410]" : clash(i) ? "font-bold text-[#B42318]" : "font-bold text-[#1E3A6E]"}`}
            >
              {d || ""}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-10 gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} type="button" aria-label={`Number ${d}`} disabled={disabled || at === null || !!p.given[at ?? 0]} onClick={() => put(d)} className="h-11 rounded-lg bg-ink font-display text-lg font-extrabold text-paper disabled:opacity-40">
            {d}
          </button>
        ))}
        <button type="button" aria-label="Clear the square" disabled={disabled || at === null || !!p.given[at ?? 0]} onClick={() => put(0)} className="h-11 rounded-lg bg-ink text-lg text-paper disabled:opacity-40">
          ⌫
        </button>
      </div>
      <p className="text-center text-xs text-muted">
        {filled === open && !right ? "Every square is filled, but something clashes: look for the red numbers." : `${filled} of ${open} squares filled`}
      </p>
    </div>
  );
}

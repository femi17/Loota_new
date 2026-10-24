"use client";

import { useId } from "react";
import type { MapDrawing } from "@/game/puzzles/tornmap";

/** The whole map as an old parchment chart: streets in ink, their names, a compass rose, and X where the key is. */
function MapArt({ id, d }: { id: string; d: MapDrawing }) {
  return (
    <defs>
      <radialGradient id={`${id}-paper`} cx="50%" cy="45%" r="75%">
        <stop offset="0%" stopColor="#F4E7C8" />
        <stop offset="70%" stopColor="#E9D6A8" />
        <stop offset="100%" stopColor="#D2B57C" />
      </radialGradient>
      <g id={`${id}-map`}>
        <rect x="0" y="0" width="1" height="1" fill={`url(#${id}-paper)`} />
        {/* Faint blocks of the old survey grid */}
        {[0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map((v) => (
          <g key={v} stroke="#B89A62" strokeWidth="0.0015" opacity="0.45">
            <line x1={v} y1="0" x2={v} y2="1" />
            <line x1="0" y1={v} x2="1" y2={v} />
          </g>
        ))}
        {/* The streets: a dark ink edge, then the road */}
        {d.lines.map((l, i) => (
          <polyline key={`c${i}`} points={l.pts.join(" ")} fill="none" stroke="#4A3018" strokeWidth={0.008 + l.w * 0.007} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {d.lines.map((l, i) => (
          <polyline
            key={`r${i}`}
            points={l.pts.join(" ")}
            fill="none"
            stroke={l.w === 3 ? "#E8B65A" : "#FBF1D9"}
            strokeWidth={0.004 + l.w * 0.0055}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {d.names.map((nm) => (
          <text
            key={nm.text}
            x={nm.x}
            y={nm.y}
            transform={`rotate(${nm.angle} ${nm.x} ${nm.y})`}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="0.028"
            fontStyle="italic"
            fontFamily="Georgia, serif"
            fill="#3A2410"
            stroke="#F4E7C8"
            strokeWidth="0.006"
            paintOrder="stroke"
          >
            {nm.text}
          </text>
        ))}
        {/* The compass rose */}
        <g transform="translate(0.86 0.14)">
          <circle r="0.065" fill="none" stroke="#6B4A2B" strokeWidth="0.003" />
          <path d="M0 -0.06 L0.012 0 L0 0.06 L-0.012 0z" fill="#6B4A2B" />
          <path d="M-0.06 0 L0 -0.012 L0.06 0 L0 0.012z" fill="#A47C48" />
          <path d="M0 -0.06 L0.012 0 L-0.012 0z" fill="#B42318" />
          <text y="-0.072" textAnchor="middle" fontSize="0.026" fontWeight="700" fontFamily="Georgia, serif" fill="#3A2410">
            N
          </text>
        </g>
        {/* X marks the spot */}
        <g transform="translate(0.5 0.5)" stroke="#B42318" strokeWidth="0.012" strokeLinecap="round">
          <line x1="-0.025" y1="-0.025" x2="0.025" y2="0.025" />
          <line x1="-0.025" y1="0.025" x2="0.025" y2="-0.025" />
        </g>
      </g>
    </defs>
  );
}

/**
 * Torn Map: the squares of the board, each showing a piece of the map (turned a quarter at a time). Tap a piece, then
 * another to swap them; with `rotate`, tap the chosen piece again to turn it.
 */
export function TornMapBoard({
  drawing,
  n,
  placed,
  selected,
  disabled,
  whole,
  onTap,
}: {
  drawing: MapDrawing;
  n: number;
  /** For each square, the piece there and its quarter turns. */
  placed: [number, number][];
  selected: number | null;
  disabled: boolean;
  /** The map is whole: the tears fade. */
  whole: boolean;
  onTap: (square: number) => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const size = 1 / n;
  return (
    <div className="relative aspect-square w-full select-none overflow-hidden rounded-xl bg-[#3A2410] ring-2 ring-[#3A2410]" role="grid" aria-label="Torn map">
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <MapArt id={id} d={drawing} />
      </svg>
      <div className={`grid size-full ${whole ? "gap-0" : "gap-[3px] p-[3px]"} transition-all duration-500`} style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {placed.map(([piece, q], square) => {
          const px = (piece % n) * size, py = Math.floor(piece / n) * size;
          return (
            <button
              key={square}
              type="button"
              data-cell={square}
              disabled={disabled}
              onClick={() => onTap(square)}
              aria-label={`Square ${square + 1}${selected === square ? ", chosen" : ""}`}
              className={`relative overflow-hidden ${whole ? "" : "rounded-[3px] shadow-[inset_0_0_6px_rgba(58,36,16,0.55)]"} ${
                selected === square ? "z-10 scale-[1.04] ring-4 ring-[#F4B41A]" : ""
              } transition-transform duration-150`}
            >
              <svg viewBox={`${px} ${py} ${size} ${size}`} className="size-full transition-transform duration-200" style={{ transform: `rotate(${q * 90}deg)` }} aria-hidden="true">
                <use href={`#${id}-map`} />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}

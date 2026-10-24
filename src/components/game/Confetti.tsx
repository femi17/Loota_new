"use client";

import { useState } from "react";

const COLOURS = ["#F4B41A", "#E5484D", "#3DD68C", "#7FD1FF", "#C3A6FF", "#F28C28", "#F5ECD8"];

/**
 * A burst of confetti over a win (owner, 24 Oct 2026: polish, light and playful): pieces fly up from the card and
 * tumble down. Plain CSS (globals.css .loota-confetti); none when the player prefers less motion.
 */
export function Confetti({ big = false }: { big?: boolean }) {
  const [pieces] = useState(() =>
    [...Array(big ? 90 : 50)].map((_, i) => ({
      x: Math.random() * 100,
      drift: (Math.random() - 0.5) * 160,
      rise: 120 + Math.random() * 180,
      spin: (Math.random() - 0.5) * 1080,
      delay: Math.random() * 0.25,
      dur: 1.6 + Math.random() * 1.1,
      size: 6 + Math.random() * 6,
      round: i % 4 === 0,
      colour: COLOURS[i % COLOURS.length],
    })),
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/3 h-0 overflow-visible" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="loota-confetti absolute block"
          style={
            {
              left: `${p.x}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              borderRadius: p.round ? "50%" : 2,
              background: p.colour,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              "--drift": `${p.drift}px`,
              "--rise": `${p.rise}px`,
              "--spin": `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

const COLOURS = ["#F4B41A", "#E5484D", "#3DD68C", "#7FD1FF", "#C3A6FF", "#F28C28", "#F5ECD8"];

/**
 * All the keys (owner, 19 Nov 2026: "When a user collects the last key, there no celebration, there should be
 * confetti, so viewers and users knows the users now has all keys"): confetti raining over the whole screen for a few
 * seconds, and a big banner in the middle. On the player's phone and on the broadcast. It doesn't take taps (the card
 * under it does); `onDone` once it has rained out. Only the banner when the player prefers less motion.
 */
export function Celebration({ title, line, onDone, ms = 6500 }: { title: string; line?: string; onDone?: () => void; ms?: number }) {
  const [pieces] = useState(() =>
    [...Array(170)].map((_, i) => ({
      x: Math.random() * 100,
      sway: (Math.random() - 0.5) * 140,
      spin: (Math.random() - 0.5) * 1440,
      delay: Math.random() * 2.6, // in waves: still falling a few seconds on
      dur: 2.4 + Math.random() * 2,
      size: 7 + Math.random() * 8,
      round: i % 4 === 0,
      colour: COLOURS[i % COLOURS.length],
    })),
  );
  // Once, from when it appears (the parent may re-render every second with a new onDone)
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const t = window.setTimeout(() => done.current?.(), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" role="status" aria-label="All the keys" data-celebration>
      {pieces.map((p, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="loota-confetti-rain absolute block"
          style={
            {
              left: `${p.x}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              borderRadius: p.round ? "50%" : 2,
              background: p.colour,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              "--sway": `${p.sway}px`,
              "--spin": `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
      <div className="absolute inset-x-0 top-[18%] flex justify-center px-4">
        <div className="loota-banner-pop flex max-w-xl flex-col items-center gap-1 rounded-3xl bg-ink/90 px-8 py-5 text-center shadow-2xl ring-4 ring-gold">
          <span className="text-6xl" aria-hidden="true">🏆🗝️</span>
          <p className="font-display text-3xl font-extrabold text-gold sm:text-4xl">{title}</p>
          {line && <p className="text-lg font-bold text-paper">{line}</p>}
        </div>
      </div>
    </div>
  );
}

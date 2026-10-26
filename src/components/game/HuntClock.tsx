"use client";

import { useSyncExternalStore } from "react";
import { timeLeft } from "@/components/Countdown";
import { huntResting, huntResumesAt } from "@/game/hunt";

const two = (n: number) => String(n).padStart(2, "0");
/** A ticking clock under a day: "03:12:45", or "12:45" in the last hour (the days go on the label above). */
function ticking(seconds: number) {
  const s = Math.max(0, seconds) % 86400;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 || seconds >= 86400 ? `${two(h)}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`;
}

const subscribe = (tick: () => void) => {
  const timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
};
const now = () => Math.floor(Date.now() / 1000);

/**
 * The hunt's clock at the top of the map (owner, 25 Oct 2026: "in the center of the screen at the top, there are to be
 * a countdown for each hunt"): how long until it starts, how long it has left, or, in golden minutes, how long they last.
 */
export function HuntClock({ startsAt, endsAt, goldenUntil }: { startsAt: string; endsAt: string; goldenUntil: number | null }) {
  const t = useSyncExternalStore(subscribe, now, () => null);
  if (t === null) return null;
  const start = Math.floor(Date.parse(startsAt) / 1000);
  const end = Math.floor(Date.parse(endsAt) / 1000);
  const golden = goldenUntil !== null && goldenUntil / 1000 > t ? Math.floor(goldenUntil / 1000) : null;
  const [label, left, tone] =
    t < start
      ? ["Starts in", start - t, "text-paper"]
      : t >= end
        ? ["Hunt over", 0, "text-muted"]
        : huntResting(t * 1000)
          ? ["🌙 Back in", Math.floor(huntResumesAt(t * 1000) / 1000) - t, "text-[#C9D6FF]"]
          : golden
          ? ["✨ Golden", golden - t, "text-gold"]
          : end - t >= 86400
            ? [`${Math.floor((end - t) / 86400)} day${end - t >= 2 * 86400 ? "s" : ""} left`, end - t, "text-paper"]
            : ["Ends in", end - t, end - t < 3600 ? "text-danger-text" : "text-paper"];
  return (
    <div
      className={`pointer-events-auto flex h-11 shrink-0 flex-col items-center justify-center rounded-xl px-2 leading-none ${golden ? "bg-[#3B2F0A] ring-1 ring-gold" : "bg-ink"}`}
      role="timer"
      aria-label={`${label} ${timeLeft(left)}`}
      title={golden ? "Golden minutes: the detector reaches twice as far, and keys pay +50" : "The hunt's clock"}
    >
      <span className="whitespace-nowrap text-[9px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
      <span className={`mt-0.5 flex items-center gap-1 whitespace-nowrap font-display text-[15px] font-extrabold tabular-nums ${tone}`}>
        {/* A clock face whose hand sweeps round once a minute */}
        <svg width="13" height="13" viewBox="0 0 24 24" className="hidden min-[420px]:block" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" />
          <line x1="12" y1="12" x2="12" y2="5.5" transform={`rotate(${((left % 60) / 60) * 360} 12 12)`} />
        </svg>
        {left > 0 ? ticking(left) : "–"}
      </span>
    </div>
  );
}

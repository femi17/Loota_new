"use client";

import { useSyncExternalStore } from "react";
import { timeLeft } from "@/components/Countdown";

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
        : golden
          ? ["✨ Golden", golden - t, "text-gold"]
          : ["Ends in", end - t, end - t < 3600 ? "text-danger-text" : "text-paper"];
  return (
    <div
      className={`pointer-events-auto flex h-11 min-w-0 flex-col items-center justify-center rounded-xl px-3 leading-none ${golden ? "bg-[#3B2F0A] ring-1 ring-gold" : "bg-ink"}`}
      role="timer"
      aria-label={`${label} ${timeLeft(left)}`}
      title={golden ? "Golden minutes: the detector reaches twice as far, and keys pay +50" : "The hunt's clock"}
    >
      <span className="whitespace-nowrap text-[9px] font-extrabold uppercase tracking-wider text-muted">{label}</span>
      <span className={`mt-0.5 font-display text-base font-extrabold tabular-nums ${tone}`}>{left > 0 ? timeLeft(left) : "–"}</span>
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";

/** The clock, ticking once a second for every countdown on the page (null on the server: nothing to show yet). */
const subscribe = (tick: () => void) => {
  const timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
};
const now = () => Math.floor(Date.now() / 1000);

/** "2d 4h", "4h 12m", or "12:34" in the last hour. */
export function timeLeft(seconds: number) {
  const s = Math.max(0, seconds);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** How long until `to` (an ISO time), ticking; `fallback` until the page has a clock. */
export function Countdown({ to, fallback = "" }: { to: string; fallback?: string }) {
  const t = useSyncExternalStore(subscribe, now, () => null);
  if (t === null) return <>{fallback}</>;
  return <span className="tabular-nums">{timeLeft(Math.floor(new Date(to).getTime() / 1000) - t)}</span>;
}

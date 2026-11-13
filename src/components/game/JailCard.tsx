"use client";

import { useEffect, useState } from "react";

const NAMES: Record<string, string> = { bicycle: "bicycle", motorbike: "motorbike", car: "car" };
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Locked in a cell (the idling law, owner, 12 Nov 2026: "If a user stays on the major road for 1hr+ either by standing or
 * in any vehicle but not moving. The person should be locked in a cell, and then their vehicle impounded"; chose 30 min
 * or bail). The time left, what was impounded, and bail.
 */
export function JailCard({
  jail,
  coins,
  onBail,
}: {
  /** taking: just arrested, the police finding the station (no clock, no bail yet). */
  jail: { until: number; bail: number; vehicle: string | null; rentalEnded: boolean; minutes: number | null; station: string | null; taking?: boolean; reason?: "idle" | "chase"; stars?: number | null; parked?: string | null };
  coins: number;
  onBail: () => Promise<void> | void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [paying, setPaying] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const left = jail.until - now;
  return (
    <div className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm" role="alertdialog" aria-label="Locked in a cell" data-jail>
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-[#1E232B] p-5 text-paper shadow-2xl ring-2 ring-[#3A4250]">
        {/* The bars */}
        <div className="pointer-events-none absolute inset-0 flex justify-around opacity-25" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="h-full w-1.5 rounded-full bg-gradient-to-b from-[#C9D1DC] via-[#7B8696] to-[#C9D1DC]" />
          ))}
        </div>
        <div className="relative flex flex-col items-center gap-3 text-center">
          <span className="text-5xl" aria-hidden="true">🚔</span>
          <p className="text-xs font-extrabold uppercase tracking-[0.25em] text-danger-text">{jail.taking ? "Arrested" : "Locked up"}{jail.station ? ` · ${jail.station}` : ""}</p>
          {jail.reason === "chase" ? (
            <>
              <h2 className="font-display text-2xl font-extrabold">Caught after a police chase</h2>
              <p className="text-sm text-paper/80">
                You rode through a checkpoint and the police caught you (<span className="text-danger-text">{"★".repeat(jail.stars ?? 1)}</span>): {(jail.stars ?? 1) * 5} min in the cell. Next time, stop at the checkpoint, or lose them out of sight.
              </p>
            </>
          ) : (
            <>
              <h2 className="font-display text-2xl font-extrabold">Idling on a main road</h2>
              <p className="text-sm text-paper/80">
                You stood still on a main road for {jail.minutes && jail.minutes >= 60 ? `${Math.floor(jail.minutes / 60)} h${jail.minutes % 60 ? ` ${jail.minutes % 60} min` : ""}` : "an hour"}. Next time, rest at a chill spot: a park, a mall or a place to eat.
              </p>
            </>
          )}
          {(jail.vehicle || jail.rentalEnded || jail.parked) && (
            <p className="rounded-xl bg-ink/60 px-3 py-2 text-sm" data-jail-parked={jail.parked ?? undefined}>
              {jail.parked
                ? `🅿️ Your ${NAMES[jail.parked] ?? jail.parked} is parked at the roadside where you were caught: walk back to it once you're out, or send a recovery truck.`
                : jail.vehicle
                  ? `🚓 Your ${NAMES[jail.vehicle] ?? jail.vehicle} has been impounded: release it from the pound once you're out (7 days, then it's gone).`
                  : "🚓 Your rental has gone back to its renter."}
            </p>
          )}
          {jail.taking ? (
            <p className="flex items-center gap-2 rounded-xl bg-[#2F6FEB]/25 px-3 py-2 text-sm font-bold" data-arresting>
              <span className="text-xl" aria-hidden="true">🚓</span> The police are taking you to the station…
            </p>
          ) : (
          <>
          <p className="font-mono text-4xl font-extrabold tabular-nums text-gold" aria-label="Time left in the cell" data-jail-left={Math.max(0, Math.ceil(left / 1000))}>
            {clock(left)}
          </p>
          <button
            type="button"
            disabled={paying || coins < jail.bail || left <= 0}
            onClick={async () => {
              setPaying(true);
              try {
                await onBail();
              } finally {
                setPaying(false);
              }
            }}
            className="h-12 w-full rounded-2xl bg-gold font-display text-lg font-extrabold text-ink active:scale-95 disabled:opacity-50"
            data-bail
          >
            {paying ? "…" : `Pay bail · ${jail.bail} coins`}
          </button>
          <p className="text-xs font-bold text-gold/90">⏸ The clock only runs while you&apos;re playing: leave, and it waits for you.</p>
          </>
          )}
          <p className="text-xs text-paper/60" hidden={jail.taking}>{coins < jail.bail ? `You have ${coins} coins: not enough for the bail. Wait out your time.` : "Or wait out your time: you walk free when it's up."}</p>
        </div>
      </div>
    </div>
  );
}

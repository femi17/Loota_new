"use client";

import { useEffect, useState } from "react";
import { HunterFigure } from "@/components/HunterFigure";
import { cue } from "@/game/sound";
import { lookForId, type AvatarLook } from "@/lib/avatar";
import { gateFor } from "@/game/transit";

/**
 * The departure lounge (owner, 26 Oct 2026: "instead of standing at the road waiting for the plane… make the user walk
 * to the lounge to sit. This will create a scene"). After check-in the hunter walks in and sits with the other
 * passengers; the departures board counts down; boarding is called at the gate.
 */
export type LoungeView = {
  /** The trip (for the other passengers' looks and the gate). */
  id: string;
  from: string;
  to: string;
  /** Seconds until the plane leaves. */
  left: number;
};

/** Which of the five seats is the hunter's. */
const YOUR_SEAT = 1;

/** The last seconds before take-off: boarding at the gate. */
const BOARDING_S = 20;

const two = (n: number) => String(n).padStart(2, "0");
const mmss = (s: number) => `${Math.floor(s / 60)}:${two(Math.floor(s % 60))}`;
/** Three letters for a place on the board ("Murtala Muhammed International Airport" → "MUR"). */
const code = (name: string) => (name.match(/\(([A-Z]{3})\)/)?.[1] ?? name.replace(/[^A-Za-z]/g, "").slice(0, 3)).toUpperCase();

export function LoungeScene({ view, you, onHide }: { view: LoungeView; you: AvatarLook; onHide: () => void }) {
  // Walking in, then seated.
  const [seated, setSeated] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSeated(true), 2200);
    return () => window.clearTimeout(timer);
  }, []);
  const boarding = view.left <= BOARDING_S;
  useEffect(() => {
    if (boarding) cue("news");
  }, [boarding]);

  const gate = gateFor(view.to); // as on the boarding pass
  const others = [0, 1, 2, 3].map((i) => lookForId(`${view.id}:${i}`));

  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex items-end justify-center bg-ink/70 p-3 sm:items-center" role="dialog" aria-label="Departure lounge">
      <div className="loota-wonder-banner flex w-full max-w-md flex-col gap-4 rounded-3xl bg-ink p-5 text-paper ring-1 ring-line">
        <div className="flex items-center justify-between">
          <p className="font-display text-xl font-extrabold">Departure lounge</p>
          <button type="button" onClick={onHide} className="rounded-xl bg-ink-2 px-3 py-1.5 text-xs font-bold text-paper">
            Look at the map
          </button>
        </div>

        {/* The lounge: windows on the apron, the board, the seats */}
        <div className="relative h-56 overflow-hidden rounded-2xl bg-[#1B2436]">
          {/* Windows: the sky, a plane at the stand */}
          <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,#7EC8F2_0%,#CDEBFA_100%)]">
            <div className="absolute inset-0 grid grid-cols-4 gap-1.5 p-0">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="border-x-[3px] border-[#2A3550]" />
              ))}
            </div>
            <svg viewBox="0 0 160 40" className="absolute bottom-1 left-[18%] w-[64%]" aria-hidden="true">
              <path d="M8 24 Q4 20 14 19 L118 17 Q150 18 154 23 Q150 28 118 28 L14 28 Q4 28 8 24 Z" fill="#F4F1EA" />
              <path d="M60 22 L92 6 L100 6 L80 22 Z M64 26 L92 38 L100 38 L82 26 Z" fill="#D8DEE8" />
              <path d="M10 19 L4 6 L12 6 L24 19 Z" fill="#2F6FEB" />
              {[30, 40, 50, 60, 70, 80, 90, 100, 110].map((x) => (
                <circle key={x} cx={x} cy="21" r="1.4" fill="#2A3550" />
              ))}
            </svg>
            <div className="absolute inset-x-0 bottom-0 h-3 bg-[#8A939F]" />
          </div>
          {/* The departures board */}
          <div className="absolute right-3 top-3 rounded-md bg-[#0B0F18] px-2.5 py-1.5 font-mono text-[11px] leading-tight text-[#FFB020] ring-1 ring-[#3A2A0A]" aria-label="Departures">
            <p className="tabular-nums">
              {code(view.from)} → {code(view.to)} · GATE {gate}
            </p>
            <p className={`tabular-nums ${boarding ? "loota-pulse text-[#3DD68C]" : ""}`}>{boarding ? "NOW BOARDING" : `BOARDING IN ${mmss(view.left - BOARDING_S)}`}</p>
          </div>
          {/* The floor, and a row of seats: each passenger sits behind a seat back (their head and shoulders show) */}
          <div className="absolute inset-x-0 bottom-0 h-28 bg-[#2A3550]" />
          <div className="absolute inset-x-3 bottom-4 flex justify-between">
            {[0, 1, 2, 3, 4].map((i) => {
              const who = i === YOUR_SEAT ? null : others[i > YOUR_SEAT ? i - 1 : i];
              return (
                <span key={i} className="relative flex h-24 w-[17%] items-end justify-center">
                  {/* Whoever sits here: half hidden by the seat back */}
                  {who && (
                    <span className="absolute bottom-6">
                      <HunterFigure look={who} width={30} />
                    </span>
                  )}
                  {i === YOUR_SEAT && seated && (
                    <span className="absolute bottom-6 flex flex-col items-center">
                      <span className="mb-0.5 rounded bg-[#2F6FEB] px-1.5 text-[9px] font-extrabold text-paper">YOU</span>
                      <HunterFigure look={you} width={30} label="You" />
                    </span>
                  )}
                  <span className="relative z-10 h-10 w-full rounded-t-xl bg-[#2F6FEB] ring-2 ring-[#1E4FB0]" />
                  <span className="absolute -bottom-1 left-1 right-1 z-10 h-2 rounded bg-[#1E4FB0]" />
                </span>
              );
            })}
          </div>
          {/* Walking in: from the door, along the front of the seats */}
          {!seated && (
            <span className="loota-walk-in absolute bottom-1 z-20 flex flex-col items-center">
              <span className="mb-0.5 rounded bg-[#2F6FEB] px-1.5 text-[9px] font-extrabold text-paper">YOU</span>
              <span className="loota-npc-work">
                <HunterFigure look={you} width={34} label="You" />
              </span>
            </span>
          )}
        </div>

        <p className="text-sm text-muted">
          {!seated
            ? "You walk through to the lounge and find a free seat."
            : boarding
              ? `Ding-dong! "Passengers to ${view.to}, please board at Gate ${gate}." Off you go.`
              : `Sit back: your flight to ${view.to} boards at Gate ${gate}. Your plane leaves in ${mmss(view.left)}.`}
        </p>
      </div>
    </div>
  );
}

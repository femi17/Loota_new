"use client";

import { useEffect, useState } from "react";
import { HunterFigure } from "@/components/HunterFigure";
import { cue } from "@/game/sound";
import type { AvatarLook } from "@/lib/avatar";
import { JerryCan } from "./JerryCan";

/** Pouring the jerry can into a vehicle (owner, 26 Oct 2026: "the pour should be a scene, the user gets off the bike"). */
export type PourOffer = {
  kind: "motorbike" | "car";
  /** The tank before, in %. */
  tank: number;
  /** The can before, 0–1 of full. */
  can: number;
  usesLeft: number;
};
export type PourActions = {
  /** Pour it in: the tank after (%), the can after (0–1 of full), its uses left (null: it couldn't be done). */
  pour: () => Promise<{ tank: number; can: number; usesLeft: number; spoilt: boolean } | null>;
};

const POUR_MS = 2500;

/**
 * The hunter gets off, tips the jerry can into the tank, and the can empties as the tank fills (both gauges move);
 * then Ride on.
 */
export function PourScene({ offer, you, actions, onClose }: { offer: PourOffer; you: AvatarLook; actions: PourActions; onClose: () => void }) {
  const [step, setStep] = useState<"ready" | "pouring" | "done" | "failed">("ready");
  const [tank, setTank] = useState(offer.tank);
  const [can, setCan] = useState(offer.can);
  const [after, setAfter] = useState<{ tank: number; can: number; usesLeft: number; spoilt: boolean } | null>(null);
  const name = offer.kind === "car" ? "car" : "motorbike";

  async function pour() {
    setStep("pouring");
    cue("tap");
    const r = await actions.pour();
    if (!r) {
      setStep("failed");
      return;
    }
    setAfter(r);
    setTank(r.tank); // the gauges move (the can's fill, the tank counting up), the fuel still running
    setCan(r.can);
    window.setTimeout(() => {
      cue("coin");
      setStep("done");
    }, POUR_MS + 200); // just after the gauges settle
  }

  // Both gauges move together as it pours: the can counting down, the tank counting up.
  const [shownTank, setShownTank] = useState(offer.tank);
  const [shownCan, setShownCan] = useState(offer.can);
  useEffect(() => {
    if (tank === offer.tank && can === offer.can) return; // not poured yet
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / POUR_MS);
      setShownTank(offer.tank + (tank - offer.tank) * k);
      setShownCan(offer.can + (can - offer.can) * k);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tank, can, offer.tank, offer.can]);

  const pouring = step === "pouring";
  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex items-end justify-center bg-ink/70 p-3 sm:items-center" role="dialog" aria-label="Pouring the jerry can">
      <div className="loota-wonder-banner flex w-full max-w-md flex-col gap-4 rounded-3xl bg-ink p-5 text-paper ring-1 ring-line">
        <p className="font-display text-xl font-extrabold">Topping up your {name}</p>

        {/* The roadside: the vehicle, the hunter off it, the can tipped over the tank */}
        <div className="relative h-40 overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_50%_120%,#3A3F47_0%,#182033_70%)]">
          <div className="absolute inset-x-0 bottom-0 h-8 bg-[#2A2F38]" />
          <div className="absolute inset-x-0 bottom-3.5 h-0.5 bg-[repeating-linear-gradient(90deg,#F4F1EA_0_14px,transparent_14px_28px)] opacity-60" />
          {/* The vehicle */}
          <svg viewBox="0 0 120 60" className="absolute bottom-5 left-[8%] w-[46%]" aria-hidden="true">
            {offer.kind === "car" ? (
              <>
                <rect x="6" y="22" width="108" height="22" rx="7" fill="#2F6FEB" />
                <path d="M28 22 L40 8 H80 L94 22 Z" fill="#2F6FEB" />
                <path d="M42 11 H58 V22 H33 Z M62 11 H78 L88 22 H62 Z" fill="#9FD8FF" />
                <rect x="96" y="27" width="7" height="5" rx="1" fill="#111" />
                <circle cx="30" cy="46" r="9" fill="#1D1D1D" />
                <circle cx="90" cy="46" r="9" fill="#1D1D1D" />
              </>
            ) : (
              <>
                <circle cx="22" cy="44" r="13" fill="none" stroke="#1D1D1D" strokeWidth="5" />
                <circle cx="96" cy="44" r="13" fill="none" stroke="#1D1D1D" strokeWidth="5" />
                <path d="M22 44 L48 28 H78 L96 44" fill="none" stroke="#5B6475" strokeWidth="4" />
                <rect x="44" y="18" width="30" height="12" rx="6" fill="#D93B3B" />
                <rect x="70" y="14" width="22" height="6" rx="3" fill="#111" />
                <path d="M30 20 L40 14" stroke="#111" strokeWidth="3" />
                <circle cx="58" cy="17" r="2.2" fill="#F4F1EA" />
              </>
            )}
          </svg>
          {/* The fuel running into the tank */}
          {pouring && (
            <span
              className="loota-pour absolute w-1 rounded-full bg-[#F4B41A]"
              style={offer.kind === "car" ? { left: "50%", bottom: "64px", height: "34px" } : { left: "33%", bottom: "78px", height: "22px" }}
              aria-hidden="true"
            />
          )}
          {/* The can, tipped while pouring */}
          <div className={`absolute transition-transform duration-500 ${offer.kind === "car" ? "bottom-[96px] left-[46%]" : "bottom-[98px] left-[30%]"}`}>
            <JerryCan size={30} level={shownCan} tilt={pouring ? -110 : step === "done" ? -20 : 0} />
          </div>
          {/* The hunter, off the vehicle, beside it */}
          <div className="absolute bottom-5 left-[56%]">
            <HunterFigure look={you} width={44} label="You" />
          </div>
        </div>

        {/* The gauges: the can's fuel and the tank's */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-3 rounded-2xl bg-ink-2 p-3" aria-label={`Jerry can ${Math.round(shownCan * 100)}%`}>
            <JerryCan size={26} level={shownCan} />
            <span className="flex flex-col leading-tight">
              <span className="text-xs text-muted">Jerry can</span>
              <b className="font-display text-xl tabular-nums">{Math.round(shownCan * 100)}%</b>
            </span>
          </div>
          <div className="flex flex-col justify-center gap-1.5 rounded-2xl bg-ink-2 p-3" aria-label={`Tank ${Math.round(shownTank)}%`}>
            <span className="flex items-baseline justify-between text-xs text-muted">
              ⛽ Tank <b className="font-display text-xl tabular-nums text-paper">{Math.round(shownTank)}%</b>
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-ink">
              <span className={`block h-full rounded-full ${shownTank < 15 ? "bg-danger" : "bg-ok"}`} style={{ width: `${Math.min(100, shownTank)}%` }} />
            </span>
          </div>
        </div>

        <p className="text-sm text-muted">
          {step === "ready"
            ? `You get off your ${name} and unscrew the tank cap. A jerry can takes a tank to 65% at most.`
            : pouring
              ? "Glug, glug, glug…"
              : step === "done" && after
                ? `Your ${name} has ${Math.round(after.tank)}% fuel. ${after.spoilt ? "That was the can's last use: it's worn out." : `The can has ${after.usesLeft} uses left.`} Fill up properly at a petrol station.`
                : "It wouldn't pour. Try again in a moment."}
        </p>

        <div className="flex gap-2">
          {step === "ready" && (
            <>
              <button type="button" onClick={() => void pour()} className="h-12 flex-1 rounded-2xl bg-gold font-bold text-ink">
                🛢 Pour it in
              </button>
              <button type="button" onClick={onClose} className="h-12 rounded-2xl border-[1.5px] border-line px-5 font-bold">
                Not now
              </button>
            </>
          )}
          {(step === "done" || step === "failed") && (
            <button type="button" onClick={onClose} className="h-12 flex-1 rounded-2xl bg-gold font-bold text-ink">
              {step === "done" ? "Ride on" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

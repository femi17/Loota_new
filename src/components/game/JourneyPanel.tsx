"use client";

import { LEG_ICON, duration, journeyLabel, type Journey, type JourneyLeg } from "@/game/journey";
import type { Place } from "@/game/places";

const distance = (m: number) => (m >= 1000 ? `${Math.round(m / 1000).toLocaleString("en-NG")} km` : `${Math.round(m)} m`);
const stopName = (s: { name: string; code: string | null }) => (s.code ? `${s.name} (${s.code})` : s.name);
const MODE_ICON = { fly: "✈️", coach: "🚌", train: "🚆", drive: "🚗" } as const;

/** One step of a journey, in a line. */
export function legText(leg: JourneyLeg) {
  if (leg.kind === "go") {
    const icon = leg.how === "Walk" ? LEG_ICON.walk : LEG_ICON.go;
    return `${icon} ${leg.how} to ${leg.to.name} · ${distance(leg.metres)}`;
  }
  const what = leg.mode === "plane" ? "Fly" : leg.mode === "train" ? "Train" : "Long-distance bus";
  return `${LEG_ICON[leg.mode]} ${what}: ${stopName(leg.from)} → ${stopName(leg.to)} · ${distance(leg.metres)}`;
}

/** How to get somewhere far (design doc 7.8): the ways there, each as steps with time and fare. */
export function JourneyPanel({
  place,
  options,
  message,
  onChoose,
  onRoadOnly,
  onClose,
}: {
  place: Place;
  /** Null while they're being worked out. */
  options: Journey[] | null;
  message: string | null;
  onChoose: (journey: Journey) => void;
  /** Skip the planning: just the road there. */
  onRoadOnly: () => void;
  onClose: () => void;
}) {
  const button = "h-10 rounded-xl px-3 text-sm font-bold";
  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Plan the journey"
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-ink p-5 sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl font-extrabold">🧭 To {place.name}</h2>
            <p className="text-sm text-muted">{place.detail || "A long way from here."} Pick how to get there.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {message && <p className="mb-3 rounded-xl bg-ink-2 p-3 text-sm ring-1 ring-gold">{message}</p>}

        {!options ? (
          <p className="text-sm text-muted">Working out the ways there…</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {options.map((j, i) => (
              <li key={j.mode} className={`flex flex-col gap-2 rounded-2xl bg-ink-2 p-4 ${i === 0 ? "ring-2 ring-gold" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">
                    {MODE_ICON[j.mode]} {journeyLabel[j.mode]}
                    {i === 0 && <span className="ml-2 rounded-md bg-gold/15 px-2 py-0.5 text-xs text-gold">Fastest</span>}
                  </p>
                  <p className="text-sm font-bold">
                    about {duration(j.seconds)}
                    {j.fare !== null && <span className="text-gold"> · {j.fare.toLocaleString("en-NG")} coins</span>}
                  </p>
                </div>
                <ol className="flex flex-col gap-1 text-sm text-paper/85">
                  {j.legs.map((leg, n) => (
                    <li key={n}>
                      <span className="text-muted">{n + 1}.</span> {legText(leg)}
                    </li>
                  ))}
                </ol>
                {j.note && <p className="text-xs text-gold">{j.note}</p>}
                <button type="button" onClick={() => onChoose(j)} className={`${button} self-start bg-gold text-ink`}>
                  Go this way
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" onClick={onRoadOnly} className={`${button} mt-3 border-[1.5px] border-line text-paper`}>
          Just show me the road
        </button>
      </div>
    </div>
  );
}

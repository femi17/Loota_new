"use client";

import { BOARD_RADIUS_M, VEHICLE_KINDS, VEHICLES, type VehicleKind } from "@/game/economy";

export type OwnedVehicle = { kind: VehicleKind; fuel: number; lng: number; lat: number; inUse: boolean; distanceM: number };
export type Riding = { kind: VehicleKind; source: "owned" | "rented" } | null;

/** Choose how to travel: ride your own vehicle, rent one, or buy one. */
export function VehiclePanel({
  owned,
  riding,
  coins,
  busy,
  onRide,
  onWalkTo,
  onGetOff,
  onClose,
}: {
  owned: OwnedVehicle[];
  riding: Riding;
  coins: number;
  busy: boolean;
  onRide: (kind: VehicleKind, how: "own" | "rent" | "buy") => void;
  onWalkTo: (vehicle: OwnedVehicle) => void;
  onGetOff: () => void;
  onClose: () => void;
}) {
  const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
  const button = "h-11 rounded-xl px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Vehicles"
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-ink p-5 sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold">How will you travel?</h2>
            <p className="text-sm text-muted">Walking is always free. You have {coins.toLocaleString("en-NG")} coins.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {riding && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border-[1.5px] border-gold p-3">
            <span className="text-sm">
              You&apos;re on {riding.source === "rented" ? "a rented" : "your"} <b>{VEHICLES[riding.kind].name.toLowerCase()}</b>.
            </span>
            <button type="button" disabled={busy} onClick={onGetOff} className={`${button} bg-gold text-ink`}>
              Get off and walk
            </button>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {VEHICLE_KINDS.map((kind) => {
            const info = VEHICLES[kind];
            const mine = owned.find((v) => v.kind === kind);
            const onIt = riding?.kind === kind;
            const near = mine && (mine.inUse || mine.distanceM <= BOARD_RADIUS_M);
            return (
              <li key={kind} className={`flex flex-col gap-3 rounded-2xl bg-ink-2 p-4 ${onIt ? "ring-2 ring-gold" : ""}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-lg font-bold">{info.name}</span>
                  {mine && (
                    <span className="text-xs text-muted">
                      Yours{kind !== "bicycle" ? ` · fuel ${Math.round(mine.fuel)}%` : ""}
                      {!mine.inUse ? ` · parked ${metres(mine.distanceM)} away` : ""}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted">{info.note}</p>
                {!onIt && (
                  <div className="flex flex-wrap gap-2">
                    {mine ? (
                      near ? (
                        <button type="button" disabled={busy || (kind !== "bicycle" && mine.fuel <= 0)} onClick={() => onRide(kind, "own")} className={`${button} bg-gold text-ink`}>
                          Ride it
                        </button>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => onWalkTo(mine)} className={`${button} border-[1.5px] border-gold text-paper`}>
                          Walk to it
                        </button>
                      )
                    ) : (
                      <button type="button" disabled={busy || coins < info.price} onClick={() => onRide(kind, "buy")} className={`${button} bg-gold text-ink`}>
                        Buy · {info.price.toLocaleString("en-NG")} coins
                      </button>
                    )}
                    <button type="button" disabled={busy || coins < info.ratePerMinute} onClick={() => onRide(kind, "rent")} className={`${button} border-[1.5px] border-line text-paper`}>
                      Rent · {info.ratePerMinute} coins a minute
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Rentals are charged per started minute until you get off. Your own vehicles stay parked where you leave them; motorbikes and
          cars need fuel from a petrol station.
        </p>
      </div>
    </div>
  );
}

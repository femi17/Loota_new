"use client";

import { CALL_OUT_PRICE, REPAIR, VEHICLE_KINDS, VEHICLES, type VehicleKind } from "@/game/economy";

/** A vehicle the player owns: ridden, or in their pocket (it goes everywhere with them). */
export type OwnedVehicle = { kind: VehicleKind; fuel: number; inUse: boolean; state: "ready" | "empty" | "broken" | "repairing" };
export type Riding = { kind: VehicleKind; source: "owned" | "rented" } | null;

/** Choose how to travel: take your own vehicle out of your pocket, rent one, or buy one. */
export function VehiclePanel({
  owned,
  riding,
  coins,
  busy,
  onRide,
  onGetOff,
  onMechanic,
  onRepairShop,
  onTaxi,
  onClose,
}: {
  owned: OwnedVehicle[];
  riding: Riding;
  coins: number;
  busy: boolean;
  onRide: (kind: VehicleKind, how: "own" | "rent" | "buy") => void;
  onGetOff: () => void;
  /** Call out a mechanic to a broken-down vehicle: they come to the player, wherever they are. */
  onMechanic: () => void;
  /** Take a broken-down vehicle to a repair shop nearby (cheaper; the way there is drawn). */
  onRepairShop: (kind: VehicleKind) => void;
  /** Cars aren't rented: a taxi is called instead. */
  onTaxi: () => void;
  onClose: () => void;
}) {
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
            return (
              <li key={kind} className={`flex flex-col gap-3 rounded-2xl bg-ink-2 p-4 ${onIt ? "ring-2 ring-gold" : ""}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-lg font-bold">{info.name}</span>
                  {mine && (
                    <span className="text-xs text-muted">
                      Yours{!mine.inUse ? " · in your pocket" : ""}
                      {kind !== "bicycle" ? ` · fuel ${Math.round(mine.fuel)}%` : ""}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted">{info.note}</p>
                {mine && !onIt && mine.state !== "ready" && (
                  <p className="text-sm text-gold">
                    {mine.state === "empty"
                      ? "Empty tank: any petrol station fills it in your pocket, or pour in a keg."
                      : mine.state === "broken"
                        ? "Broken down. Take it to a repair shop nearby, or call a mechanic to come to you (dearer, but quick)."
                        : "Being repaired. Take it out once it's ready."}
                  </p>
                )}
                {!onIt && (
                  <div className="flex flex-wrap gap-2">
                    {mine ? (
                      mine.state === "broken" ? (
                        <>
                          <button type="button" disabled={busy} onClick={() => onRepairShop(kind)} className={`${button} bg-gold text-ink`}>
                            🔧 Repair shop nearby · {REPAIR[kind].price} coins
                          </button>
                          <button type="button" disabled={busy} onClick={onMechanic} className={`${button} border-[1.5px] border-gold text-paper`}>
                            Call a mechanic to you · {CALL_OUT_PRICE[kind]} coins
                          </button>
                        </>
                      ) : (
                        <button type="button" disabled={busy || mine.state === "empty"} onClick={() => onRide(kind, "own")} className={`${button} bg-gold text-ink`}>
                          {mine.inUse ? "Ride it" : "Take it out"}
                        </button>
                      )
                    ) : (
                      <button type="button" disabled={busy || coins < info.price} onClick={() => onRide(kind, "buy")} className={`${button} bg-gold text-ink`}>
                        Buy · {info.price.toLocaleString("en-NG")} coins
                      </button>
                    )}
                    {kind === "car" ? (
                      <button type="button" disabled={busy} onClick={onTaxi} className={`${button} border-[1.5px] border-line text-paper`}>
                        🚕 Call a taxi
                      </button>
                    ) : (
                      // Yours already: no renting one beside it.
                      !mine && (
                        <button type="button" disabled={busy || coins < info.ratePerMinute} onClick={() => onRide(kind, "rent")} className={`${button} border-[1.5px] border-line text-paper`}>
                          Rent · {info.ratePerMinute} coins a minute
                        </button>
                      )
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-muted">
          To rent a bicycle or motorbike, walk to the renter waiting at a nearby bus stop; the meter starts when you ride off, per
          started minute until you get off. Cars come as taxis: the driver picks you up and takes you there. Your own vehicles go
          everywhere with you, anywhere in the world: off one, it shrinks into your pocket. Motorbikes and cars need fuel from a
          petrol station.
        </p>
      </div>
    </div>
  );
}

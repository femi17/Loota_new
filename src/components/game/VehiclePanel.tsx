"use client";

import { useState } from "react";
import { ADDONS, CALL_OUT_PRICE, KEG_CAPACITY, REPAIR, VEHICLE_KINDS, VEHICLES, type AddonId, type VehicleKind } from "@/game/economy";
import { formatDistance } from "@/game/geo";

/**
 * A vehicle the player owns: ridden, or in their pocket (it goes everywhere with them), or parked at the roadside
 * where it ran out of fuel (`stranded`, `away` metres from the player); its gear and papers.
 */
export type OwnedVehicle = {
  kind: VehicleKind;
  fuel: number;
  inUse: boolean;
  state: "ready" | "empty" | "broken" | "repairing" | "stranded";
  away?: number | null;
  papers: { id: AddonId; name: string; price: number; have: boolean }[];
};
export type Riding = { kind: VehicleKind; source: "owned" | "rented" } | null;

/** A vehicle's gear and papers: what it has (✓), and what's missing to buy (police checkpoints fine what's missing). */
export function PapersRow({
  kind,
  papers,
  coins,
  busy,
  onAddon,
}: {
  kind: VehicleKind;
  papers: OwnedVehicle["papers"];
  coins: number;
  busy: boolean;
  onAddon: (kind: VehicleKind, id: AddonId) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label={`${VEHICLES[kind].name}: gear and papers`}>
      {papers.map((p) =>
        p.have ? (
          <span key={p.id} className="flex h-8 items-center rounded-lg bg-[#1E9E62]/20 px-2 text-xs font-bold text-[#3DD68C]">
            ✓ {p.name}
          </span>
        ) : (
          <button
            key={p.id}
            type="button"
            disabled={busy || coins < p.price}
            onClick={() => onAddon(kind, p.id)}
            className="flex h-8 items-center rounded-lg border-[1.5px] border-gold px-2 text-xs font-bold text-paper disabled:opacity-40"
          >
            + {p.name} · {p.price}
          </button>
        ),
      )}
    </div>
  );
}

/** Choose how to travel: take your own vehicle out of your pocket, rent one, or buy one. */
export function VehiclePanel({
  owned,
  riding,
  coins,
  busy,
  onRide,
  onAddon,
  onGetOff,
  onMechanic,
  onRepairShop,
  onWayTo,
  onTaxi,
  onClose,
}: {
  owned: OwnedVehicle[];
  riding: Riding;
  coins: number;
  busy: boolean;
  /** `addons`: with a new vehicle, its gear and papers to buy too. */
  onRide: (kind: VehicleKind, how: "own" | "rent" | "buy", addons?: AddonId[]) => void;
  /** Buy a missing piece of gear or a licence for a vehicle you own. */
  onAddon: (kind: VehicleKind, id: AddonId) => void;
  onGetOff: () => void;
  /** Call out a mechanic to a broken-down vehicle: they come to the player, wherever they are. */
  onMechanic: () => void;
  /** Take a broken-down vehicle to a repair shop nearby (cheaper; the way there is drawn). */
  onRepairShop: (kind: VehicleKind) => void;
  /** The way (by road) to a vehicle parked at the roadside. */
  onWayTo: (kind: VehicleKind) => void;
  /** Cars aren't rented: a taxi is called instead. */
  onTaxi: () => void;
  onClose: () => void;
}) {
  const button = "h-11 rounded-xl px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";
  // With a new vehicle: its gear and papers, ticked to buy along with it.
  const [extras, setExtras] = useState<Record<string, boolean>>({});
  const ticked = (kind: VehicleKind, id: AddonId) => extras[`${kind}:${id}`] ?? true;

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
                {mine ? (
                  <PapersRow kind={kind} papers={mine.papers} coins={coins} busy={busy} onAddon={onAddon} />
                ) : (
                  <div className="flex flex-col gap-1" aria-label={`${info.name}: gear and papers to buy with it`}>
                    {ADDONS[kind].map((a) => (
                      <label key={a.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={ticked(kind, a.id)}
                          onChange={(e) => setExtras((x) => ({ ...x, [`${kind}:${a.id}`]: e.target.checked }))}
                          className="size-4 accent-[#F4B41A]"
                        />
                        <span>
                          <b>{a.name}</b> · {a.price} coins <span className="text-muted">({a.why})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {mine && !onIt && mine.state !== "ready" && (
                  <p className="text-sm text-gold">
                    {mine.state === "stranded"
                      ? `Out of fuel, parked at the roadside${mine.away != null ? ` ${formatDistance(mine.away)} from you` : ""}. Fill a jerry can at a petrol station, carry it there and pour it in: that takes the tank to ${KEG_CAPACITY}%.`
                      : mine.state === "empty"
                      ? "Empty tank: any petrol station fills it in your pocket, or pour in a jerry can."
                      : mine.state === "broken"
                        ? "Broken down. Take it to a repair shop nearby, or call a mechanic to come to you (dearer, but quick)."
                        : "Being repaired. Take it out once it's ready."}
                  </p>
                )}
                {!onIt && (
                  <div className="flex flex-wrap gap-2">
                    {mine ? (
                      mine.state === "stranded" ? (
                        <button type="button" disabled={busy} onClick={() => onWayTo(kind)} className={`${button} bg-gold text-ink`}>
                          🧭 The way to it
                        </button>
                      ) : mine.state === "broken" ? (
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
                      <button
                        type="button"
                        disabled={busy || coins < info.price}
                        onClick={() => onRide(kind, "buy", ADDONS[kind].filter((a) => ticked(kind, a.id)).map((a) => a.id))}
                        className={`${button} bg-gold text-ink`}
                      >
                        Buy · {(info.price + ADDONS[kind].filter((a) => ticked(kind, a.id)).reduce((s, a) => s + a.price, 0)).toLocaleString("en-NG")} coins
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

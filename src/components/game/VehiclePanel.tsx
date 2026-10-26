"use client";

import { useState } from "react";
import { ADDONS, CALL_OUT_PRICE, FLAT_FIX_PRICE, KEG_CAPACITY, PAPER_ICON, REPAIR, VEHICLE_KINDS, VEHICLES, type AddonId, type VehicleKind } from "@/game/economy";
import { formatDistance } from "@/game/geo";
import { CloseIcon, VehicleIcon } from "./HudIcons";

/**
 * A vehicle the player owns: ridden, or in their pocket (it goes everywhere with them), or parked at the roadside
 * where it ran out of fuel (`stranded`, `away` metres from the player); its gear and papers.
 */
export type OwnedVehicle = {
  kind: VehicleKind;
  fuel: number;
  inUse: boolean;
  /** `flat`: a motorbike or car with a flat tyre, parked at the roadside until it's changed. */
  state: "ready" | "empty" | "broken" | "repairing" | "stranded" | "flat";
  away?: number | null;
  papers: { id: AddonId; name: string; price: number; have: boolean }[];
};
export type Riding = { kind: VehicleKind; source: "owned" | "rented" } | null;

/** A vehicle's gear and papers as tiles: ✓ Got it, or "+ Buy · price" (police checkpoints fine what's missing). */
export function GearTiles({
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
    <div className="grid grid-cols-2 gap-1.5" aria-label={`${VEHICLES[kind].name}: gear and papers`}>
      {papers.map((p) =>
        p.have ? (
          <span key={p.id} className="flex h-12 items-center gap-2 rounded-xl bg-[#1E9E62]/15 px-2.5 text-[#3DD68C]">
            <span className="text-lg" aria-hidden="true">{PAPER_ICON[p.id]}</span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-xs font-bold">{p.name}</span>
              <span className="text-[10px] font-semibold">✓ Got it</span>
            </span>
          </span>
        ) : (
          <button
            key={p.id}
            type="button"
            disabled={busy || coins < p.price}
            onClick={() => onAddon(kind, p.id)}
            className="flex h-12 items-center gap-2 rounded-xl border-[1.5px] border-dashed border-gold/70 px-2.5 text-left text-paper disabled:opacity-40"
          >
            <span className="text-lg grayscale" aria-hidden="true">{PAPER_ICON[p.id]}</span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-xs font-bold">{p.name}</span>
              <span className="text-[10px] font-bold text-gold">+ Buy · {p.price} coins</span>
            </span>
          </button>
        ),
      )}
    </div>
  );
}

const SPEED: Record<VehicleKind, string> = { bicycle: "16 km/h", motorbike: "35 km/h", car: "45 km/h" };

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
  const primary = "h-11 flex-1 whitespace-nowrap rounded-xl bg-gold px-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-40";
  const secondary = "h-11 flex-1 whitespace-nowrap rounded-xl border-[1.5px] border-line px-2 text-sm font-bold text-paper disabled:cursor-not-allowed disabled:opacity-40";
  // With a new vehicle: its gear and papers, ticked to buy along with it.
  const [extras, setExtras] = useState<Record<string, boolean>>({});
  const ticked = (kind: VehicleKind, id: AddonId) => extras[`${kind}:${id}`] ?? true;
  const parked = owned.find((v) => v.state === "stranded" || v.state === "flat") ?? null;

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Vehicles"
        className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-ink sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-gold/15 text-gold" aria-hidden="true">
            <VehicleIcon kind={riding?.kind ?? null} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-extrabold leading-tight">How will you travel?</h2>
            <p className="text-xs text-muted">Walking is always free · {coins.toLocaleString("en-NG")} coins</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-2">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6">
          {riding && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-[#1E9E62]/15 p-3 ring-1 ring-[#1E9E62]/50">
              <span className="flex size-10 items-center justify-center rounded-xl bg-[#1E9E62]/25 text-[#3DD68C]" aria-hidden="true">
                <VehicleIcon kind={riding.kind} />
              </span>
              <span className="min-w-0 flex-1 text-sm">
                On {riding.source === "rented" ? "a rented" : "your"} <b>{VEHICLES[riding.kind].name.toLowerCase()}</b>
              </span>
              <button type="button" disabled={busy} onClick={onGetOff} className="h-10 shrink-0 rounded-xl bg-paper px-3 text-sm font-bold text-ink disabled:opacity-40">
                Get off
              </button>
            </div>
          )}

          {/* Out of fuel at the roadside (first, the way back with a jerry can), or a flat there */}
          {parked && (
            <div className="mb-3 flex flex-col gap-3 rounded-2xl bg-danger/15 p-4 ring-1 ring-danger/50" aria-label="Parked at the roadside">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-danger/25 text-2xl" aria-hidden="true">{parked.state === "flat" ? "🛞" : "⛽"}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-tight">
                    Your {VEHICLES[parked.kind].name.toLowerCase()} {parked.state === "flat" ? "has a flat tyre" : "ran dry"}
                  </p>
                  <p className="text-xs text-paper/75">
                    Parked at the roadside{parked.away != null ? `, ${formatDistance(parked.away)} from you` : ""}
                  </p>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-paper/80">
                {parked.state === "flat"
                  ? `🛞 Go to it and tap Fix flat: change it yourself with a jack (free), or a roadside mechanic does it for ${FLAT_FIX_PRICE} coins.`
                  : `🛢 Fill a jerry can at a petrol station, carry it back and pour it in: it takes the tank to ${KEG_CAPACITY}%.`}
              </p>
              <button type="button" disabled={busy} onClick={() => onWayTo(parked.kind)} className="h-11 rounded-xl bg-gold text-sm font-bold text-ink disabled:opacity-40">
                🧭 The way to it
              </button>
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {VEHICLE_KINDS.map((kind) => {
              const info = VEHICLES[kind];
              const mine = owned.find((v) => v.kind === kind);
              const onIt = riding?.kind === kind;
              const extrasTotal = ADDONS[kind].filter((a) => ticked(kind, a.id)).reduce((s, a) => s + a.price, 0);
              const chip = onIt
                ? { text: "Riding", style: "bg-[#1E9E62]/25 text-[#3DD68C]" }
                : !mine
                  ? { text: `${info.price.toLocaleString("en-NG")} coins`, style: "bg-gold/15 text-gold" }
                  : mine.state === "stranded"
                    ? { text: "Parked · no fuel", style: "bg-danger/20 text-[#FF8A8A]" }
                    : mine.state === "flat"
                      ? { text: "Parked · flat tyre", style: "bg-danger/20 text-[#FF8A8A]" }
                    : mine.state === "broken"
                      ? { text: "Broken down", style: "bg-danger/20 text-[#FF8A8A]" }
                      : mine.state === "repairing"
                        ? { text: "Being repaired", style: "bg-gold/15 text-gold" }
                        : mine.state === "empty"
                          ? { text: "Empty tank", style: "bg-danger/20 text-[#FF8A8A]" }
                          : { text: "Yours · in your pocket", style: "bg-paper/10 text-paper/80" };
              return (
                <li key={kind} className={`flex flex-col gap-3 rounded-2xl bg-ink-2 p-3 ${onIt ? "ring-2 ring-[#1E9E62]/70" : ""}`}>
                  <div className="flex items-center gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold" aria-hidden="true">
                      <VehicleIcon kind={kind} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-bold leading-tight">{info.name}</p>
                      <p className="text-xs text-muted">
                        {SPEED[kind]} · {kind === "bicycle" ? "uses your energy" : "uses fuel"}
                      </p>
                      {mine && kind !== "bicycle" && (
                        <div className="mt-1 flex items-center gap-2" aria-label={`Fuel ${Math.round(mine.fuel)}%`}>
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink">
                            <div className={`h-full rounded-full ${mine.fuel < 20 ? "bg-danger" : "bg-gold"}`} style={{ width: `${Math.max(0, Math.min(100, mine.fuel))}%` }} />
                          </div>
                          <span className="text-[11px] text-muted">⛽ {Math.round(mine.fuel)}%</span>
                        </div>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.style}`}>{chip.text}</span>
                  </div>

                  {mine ? (
                    <GearTiles kind={kind} papers={mine.papers} coins={coins} busy={busy} onAddon={onAddon} />
                  ) : (
                    // To buy with it: tap a tile to leave it out.
                    <div className="grid grid-cols-2 gap-1.5" aria-label={`${info.name}: gear and papers to buy with it`}>
                      {ADDONS[kind].map((a) => {
                        const on = ticked(kind, a.id);
                        return (
                          <button
                            key={a.id}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            title={a.why}
                            onClick={() => setExtras((x) => ({ ...x, [`${kind}:${a.id}`]: !on }))}
                            className={`flex h-12 items-center gap-2 rounded-xl px-2.5 text-left ${on ? "bg-gold/15 ring-[1.5px] ring-gold" : "bg-ink ring-1 ring-line"}`}
                          >
                            <span className={`text-lg ${on ? "" : "grayscale"}`} aria-hidden="true">{PAPER_ICON[a.id]}</span>
                            <span className="flex min-w-0 flex-1 flex-col leading-tight">
                              <span className="truncate text-xs font-bold">{a.name}</span>
                              <span className={`text-[10px] font-bold ${on ? "text-gold" : "text-muted"}`}>
                                {on ? "✓ " : ""}
                                {a.price} coins
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {mine && !onIt && (mine.state === "broken" || mine.state === "repairing" || mine.state === "empty" || mine.state === "flat") && (
                    <p className="text-xs text-gold">
                      {mine.state === "flat"
                        ? `A flat tyre, at the roadside${mine.away ? ` ${mine.away} m away` : ""}. Go to it and tap 🛞 Fix flat: free with a jack, or a roadside mechanic does it for ${FLAT_FIX_PRICE} coins.`
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
                        mine.state === "stranded" || mine.state === "flat" ? (
                          <button type="button" disabled={busy} onClick={() => onWayTo(kind)} className={primary}>
                            🧭 The way to it
                          </button>
                        ) : mine.state === "broken" ? (
                          <>
                            <button type="button" disabled={busy} onClick={() => onRepairShop(kind)} className={primary}>
                              🔧 Repair shop · {REPAIR[kind].price}
                            </button>
                            <button type="button" disabled={busy} onClick={onMechanic} className={secondary}>
                              Mechanic to you · {CALL_OUT_PRICE[kind]}
                            </button>
                          </>
                        ) : (
                          <button type="button" disabled={busy || mine.state === "empty" || mine.state === "repairing"} onClick={() => onRide(kind, "own")} className={primary}>
                            {mine.inUse ? "Ride it" : "Take it out"}
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          disabled={busy || coins < info.price}
                          onClick={() => onRide(kind, "buy", ADDONS[kind].filter((a) => ticked(kind, a.id)).map((a) => a.id))}
                          className={primary}
                        >
                          Buy · {(info.price + extrasTotal).toLocaleString("en-NG")} coins
                        </button>
                      )}
                      {kind === "car" ? (
                        <button type="button" disabled={busy} onClick={onTaxi} className={secondary}>
                          🚕 Call a taxi
                        </button>
                      ) : (
                        // Yours already: no renting one beside it.
                        !mine && (
                          <button type="button" disabled={busy || coins < info.ratePerMinute} onClick={() => onRide(kind, "rent")} className={secondary}>
                            Rent · {info.ratePerMinute}/min
                          </button>
                        )
                      )}
                    </div>
                  )}
                  {/* Why Buy is greyed out (or would leave gear behind): how far short the coins are. */}
                  {!onIt && !mine && coins < info.price + extrasTotal && (
                    <p className="text-xs text-muted">
                      {coins < info.price
                        ? `${(info.price - coins).toLocaleString("en-NG")} coins short to buy one.${kind === "car" ? " A taxi takes you meanwhile." : " Rent one meanwhile."}`
                        : `${(info.price + extrasTotal - coins).toLocaleString("en-NG")} coins short with the gear ticked: untick some to buy it now.`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-4 px-1 text-[11px] leading-relaxed text-muted">
            🛵 Rent a bicycle or motorbike from the renter at a nearby bus stop; the meter runs per started minute until you get off. Cars come as taxis.
            Your own vehicles go everywhere with you, in your pocket, until a tank runs dry: then the vehicle waits at the roadside for a jerry can.
          </p>
        </div>
      </div>
    </div>
  );
}

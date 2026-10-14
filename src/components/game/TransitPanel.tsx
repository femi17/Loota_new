"use client";

import { useEffect, useState } from "react";
import type { LngLat } from "@/game/geo";
import type { Place } from "@/game/places";
import { TRANSIT, clock, type TransitDestination, type TransitMode, type TransitStop } from "@/game/transit";
import { PlaceSearch } from "./PlaceSearch";

/** The stops the player is at, and the nearest of each kind (transit_near). */
export type TransitNear = { here: TransitStop[]; nearest: Partial<Record<TransitMode, TransitStop>> };

/** A priced trip, ready to pay for and board. */
export type TransitQuote = {
  mode: TransitMode;
  from: TransitStop;
  to: { id: number; name: string; code: string | null };
  /** What the trip is called: the place searched for (a bus), or the station or airport. */
  label: string;
  /** A bus: the place itself, reached on foot from the stop it drops you at (directions are mapped on arrival). */
  then?: Place;
  /** A bus: metres from that stop to the place. */
  walkAfter?: number;
  metres: number;
  fare: number;
  /** Wait plus ride, in seconds. */
  seconds: number;
  waitSeconds: number;
  path: [number, number][];
};

export type TransitActions = {
  near: () => Promise<TransitNear | null>;
  destinations: (stop: TransitStop) => Promise<TransitDestination[]>;
  /** A bus from this stop to the stop nearest a place; a message if there's none. */
  quoteBus: (from: TransitStop, place: Place) => Promise<TransitQuote | string>;
  quoteTo: (from: TransitStop, to: TransitDestination) => Promise<TransitQuote | string>;
  /** Pay and board; a message if it didn't work. */
  board: (quote: TransitQuote, fastPass: boolean) => Promise<string | null>;
  directionsTo: (stop: TransitStop) => void;
  /** Where the player's directions lead, if they have any. */
  heading: () => Place | null;
  fastPasses: () => Promise<number>;
  where: () => LngLat;
};

const distance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`);
const stopTitle = (s: TransitStop) =>
  s.kind === "plane" ? `${s.name} (${s.code})` : s.kind === "train" ? `${s.name} station · ${s.line}` : s.name;

/** Take a bus, train or plane: from the stop you're at, or directions to the nearest. */
export function TransitPanel({ actions, coins, onClose }: { actions: TransitActions; coins: number; onClose: () => void }) {
  const [near, setNear] = useState<TransitNear | null | "loading">("loading");
  const [lists, setLists] = useState<Record<number, TransitDestination[] | "loading">>({});
  const [quote, setQuote] = useState<TransitQuote | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [passes, setPasses] = useState(0);
  const [useFastPass, setUseFastPass] = useState(false);

  useEffect(() => {
    let live = true;
    void actions.near().then((n) => live && setNear(n));
    void actions.fastPasses().then((n) => live && setPasses(n));
    return () => {
      live = false;
    };
  }, [actions]);

  const run = async (work: () => Promise<TransitQuote | string>) => {
    setWorking(true);
    setMessage(null);
    const result = await work();
    setWorking(false);
    if (typeof result === "string") setMessage(result);
    else setQuote(result);
  };

  const showDestinations = async (stop: TransitStop) => {
    setLists((l) => ({ ...l, [stop.id]: "loading" }));
    const found = await actions.destinations(stop);
    setLists((l) => ({ ...l, [stop.id]: found }));
  };

  const board = async () => {
    if (!quote) return;
    setWorking(true);
    const problem = await actions.board(quote, useFastPass);
    setWorking(false);
    if (problem) setMessage(problem);
    else onClose();
  };

  const button = "h-11 rounded-xl px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";
  const heading = actions.heading();

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Bus, train or plane"
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-ink p-5 sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold">Bus, train or plane</h2>
            <p className="text-sm text-muted">They take you there while you sit back. You have {coins.toLocaleString("en-NG")} coins.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {message && <p className="mb-3 rounded-xl bg-ink-2 p-3 text-sm ring-1 ring-gold">{message}</p>}

        {quote ? (
          // ---- The trip, priced: pay and board.
          <div className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4">
            <p className="text-lg font-bold">
              {TRANSIT[quote.mode].icon} {TRANSIT[quote.mode].label} {quote.mode === "bus" ? "towards" : "to"} {quote.label}
              {quote.to.code ? ` (${quote.to.code})` : ""}
            </p>
            {quote.mode === "bus" && (
              <p className="text-sm">
                Drops you at {quote.to.name}
                {quote.walkAfter && quote.walkAfter > 30 ? `, about ${distance(quote.walkAfter)} on foot from ${quote.label}` : ""}. It stops
                at other bus stops on the way.
              </p>
            )}
            <p className="text-sm text-muted">
              From {stopTitle(quote.from)} · {distance(quote.metres)} · about {clock(quote.seconds)}, including{" "}
              {quote.mode === "plane" ? "check-in and boarding" : "the wait"} ({clock(quote.waitSeconds)})
            </p>
            {passes > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useFastPass} onChange={(e) => setUseFastPass(e.target.checked)} className="size-5 accent-[#C3A6FF]" />
                Use a Fast Pass ({passes}): {quote.mode === "plane" ? "skip the check-in queue" : "no wait"}
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={working || coins < quote.fare} onClick={board} className={`${button} bg-gold text-ink`}>
                Pay {quote.fare} coins and board
              </button>
              <button type="button" disabled={working} onClick={() => setQuote(null)} className={`${button} border-[1.5px] border-line text-paper`}>
                Back
              </button>
            </div>
            {coins < quote.fare && <p className="text-xs text-danger">You need {quote.fare - coins} more coins.</p>}
          </div>
        ) : near === "loading" ? (
          <p className="text-sm text-muted">Looking for stops near you…</p>
        ) : !near ? (
          <p className="text-sm text-muted">Couldn&apos;t look up stops just now. Try again in a moment.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* ---- Stops the player is at */}
            {near.here.map((stop) => {
              const list = lists[stop.id];
              return (
                <div key={stop.id} className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4 ring-2 ring-gold">
                  <p className="font-bold">
                    {TRANSIT[stop.kind].icon} You&apos;re at {stopTitle(stop)}
                  </p>
                  {stop.kind === "bus" ? (
                    <>
                      <p className="text-sm text-muted">Where to? Buses go up to 40 km and drop you at the stop nearest the place.</p>
                      <PlaceSearch inline near={actions.where} onPick={(place) => void run(() => actions.quoteBus(stop, place))} />
                      {heading && (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => void run(() => actions.quoteBus(stop, heading))}
                          className={`${button} self-start border-[1.5px] border-gold text-paper`}
                        >
                          Towards {heading.name}
                        </button>
                      )}
                    </>
                  ) : list === undefined ? (
                    <button type="button" onClick={() => void showDestinations(stop)} className={`${button} self-start bg-gold text-ink`}>
                      {stop.kind === "plane" ? "See flights" : "See stations on this line"}
                    </button>
                  ) : list === "loading" ? (
                    <p className="text-sm text-muted">Loading…</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {list.map((d) => (
                        <li key={d.id}>
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => void run(() => actions.quoteTo(stop, d))}
                            className="flex w-full items-center justify-between gap-3 rounded-xl bg-ink px-3 py-2.5 text-left text-sm disabled:opacity-50"
                          >
                            <span className="font-bold">
                              {d.name}
                              {d.code ? ` (${d.code})` : ""}
                            </span>
                            <span className="shrink-0 text-muted">
                              {distance(d.metres)} · {clock(d.seconds)} · <span className="font-bold text-gold">{d.fare} coins</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            {/* ---- The nearest of each kind, with directions */}
            {(["bus", "train", "plane"] as const).map((kind) => {
              const stop = near.nearest[kind];
              if (near.here.some((h) => h.kind === kind)) return null;
              return (
                <div key={kind} className="flex items-center justify-between gap-3 rounded-2xl bg-ink-2 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {TRANSIT[kind].icon} Nearest {kind === "bus" ? "bus stop" : kind === "train" ? "train station" : "airport"}
                    </p>
                    <p className="truncate text-sm text-muted">{stop ? `${stopTitle(stop)} · ${distance(stop.metres)}` : "None within reach"}</p>
                  </div>
                  {stop && (
                    <button
                      type="button"
                      onClick={() => {
                        actions.directionsTo(stop);
                        onClose();
                      }}
                      className={`${button} shrink-0 border-[1.5px] border-gold text-paper`}
                    >
                      Directions
                    </button>
                  )}
                </div>
              );
            })}
            {working && <p className="text-sm text-muted">Working out the route…</p>}
          </div>
        )}
      </div>
    </div>
  );
}

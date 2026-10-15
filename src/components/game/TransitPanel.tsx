"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { LngLat } from "@/game/geo";
import type { Place } from "@/game/places";
import { BUS_RANGE_M, TRANSIT, clock, type TransitDestination, type TransitMode, type TransitStop } from "@/game/transit";
import { PlaceSearch } from "./PlaceSearch";

/**
 * The stops the player is at, and the nearest of each kind (transit_near); plus
 * the nearest motor park (long-distance buses) and the nearest station on each
 * train line around.
 */
export type TransitNear = { here: TransitStop[]; nearest: Partial<Record<TransitMode, TransitStop>>; park?: TransitStop | null; lines?: TransitStop[] };

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
  /** Night or rush hour, when it changes the wait, the time or the fare. */
  note?: string;
  path: [number, number][];
};

/** A taxi, priced: where it picks the player up, the driver's way there, and the trip. */
export type TaxiQuote = {
  place: Place;
  pickup: { name: string; lng: number; lat: number; walkM: number };
  driverPath: [number, number][];
  tripPath: [number, number][];
  to: { lng: number; lat: number };
  metres: number;
  fare: number;
  driverSeconds: number;
  rideSeconds: number;
  /** A night fare, or rush-hour traffic. */
  note?: string;
};

export type TransitActions = {
  /** A taxi to a place (within 40 km), picking the player up nearby; a message if there's none. */
  quoteTaxi: (place: Place) => Promise<TaxiQuote | string>;
  /** Call it; a message if that didn't work. */
  callTaxi: (quote: TaxiQuote) => Promise<string | null>;
  near: () => Promise<TransitNear | null>;
  destinations: (stop: TransitStop) => Promise<TransitDestination[]>;
  /** Airports anywhere in the world, by name, city, country or code. */
  searchAirports: (from: TransitStop, query: string) => Promise<TransitDestination[]>;
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

/** One place a train or plane can take you, with distance, time and fare. */
function DestinationRow({ d, disabled, onPick }: { d: TransitDestination; disabled: boolean; onPick: () => void }) {
  const where = [d.city, d.country].filter(Boolean).join(", ");
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        className="flex w-full items-center justify-between gap-3 rounded-xl bg-ink px-3 py-2.5 text-left text-sm disabled:opacity-50"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-bold">
            {d.name}
            {d.code ? ` (${d.code})` : ""}
          </span>
          {where && <span className="truncate text-xs text-muted">{where}</span>}
        </span>
        <span className="shrink-0 text-right text-muted">
          {distance(d.metres)} · {clock(d.seconds)}
          <br />
          <span className="font-bold text-gold">{d.fare.toLocaleString("en-NG")} coins</span>
        </span>
      </button>
    </li>
  );
}

/** Search the world's airports (a city, a country, an airport name or code). */
function AirportSearch({
  from,
  actions,
  disabled,
  onPick,
}: {
  from: TransitStop;
  actions: TransitActions;
  disabled: boolean;
  onPick: (d: TransitDestination) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<TransitDestination[] | "searching" | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      setFound("searching");
      const result = await actions.searchAirports(from, q);
      if (live) setFound(result);
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, from, actions]);
  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length < 2) setFound(null);
        }}
        placeholder="Fly anywhere: a city, country or airport"
        aria-label="Search airports anywhere in the world"
        className="h-11 rounded-xl bg-ink px-3 text-sm text-paper outline-none placeholder:text-muted"
      />
      {found === "searching" && <p className="text-xs text-muted">Searching…</p>}
      {Array.isArray(found) &&
        (found.length ? (
          <ul className="flex flex-col gap-1.5">
            {found.map((d) => (
              <DestinationRow key={d.id} d={d} disabled={disabled} onPick={() => onPick(d)} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No airport with flights matches that.</p>
        ))}
    </div>
  );
}

/** A "nearest …" row with directions to it. */
function NearestRow({
  title,
  stop,
  actions,
  onClose,
  children,
}: {
  title: string;
  stop: TransitStop | null | undefined;
  actions: TransitActions;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-ink-2 p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold">{title}</p>
        <p className="truncate text-sm text-muted">{stop ? `${stopTitle(stop)} · ${distance(stop.metres)}` : "None within reach"}</p>
        {children}
      </div>
      {stop && (
        <button
          type="button"
          onClick={() => {
            actions.directionsTo(stop);
            onClose();
          }}
          className="h-11 shrink-0 rounded-xl border-[1.5px] border-gold px-3 text-sm font-bold text-paper"
        >
          Directions
        </button>
      )}
    </div>
  );
}

/** Take a bus, train or plane: from the stop you're at, or directions to the nearest. */
export function TransitPanel({ actions, coins, onClose }: { actions: TransitActions; coins: number; onClose: () => void }) {
  const [near, setNear] = useState<TransitNear | null | "loading">("loading");
  const [lists, setLists] = useState<Record<number, TransitDestination[] | "loading">>({});
  const [quote, setQuote] = useState<TransitQuote | null>(null);
  const [taxi, setTaxi] = useState<TaxiQuote | null>(null);
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

  const quoteTaxi = async (place: Place) => {
    setWorking(true);
    setMessage(null);
    const result = await actions.quoteTaxi(place);
    setWorking(false);
    if (typeof result === "string") setMessage(result);
    else setTaxi(result);
  };

  const callTaxi = async () => {
    if (!taxi) return;
    setWorking(true);
    const problem = await actions.callTaxi(taxi);
    setWorking(false);
    if (problem) setMessage(problem);
    else onClose();
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
            <h2 className="font-display text-2xl font-extrabold">Taxi, bus, train or plane</h2>
            <p className="text-sm text-muted">They take you there while you sit back. You have {coins.toLocaleString("en-NG")} coins.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {message && <p className="mb-3 rounded-xl bg-ink-2 p-3 text-sm ring-1 ring-gold">{message}</p>}

        {taxi ? (
          // ---- A taxi, priced: call it.
          <div className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4">
            <p className="text-lg font-bold">🚕 Taxi to {taxi.place.name}</p>
            <p className="text-sm text-muted">
              Pickup: {taxi.pickup.name}
              {taxi.pickup.walkM > 15 ? `, ${distance(taxi.pickup.walkM)} from you` : ", where you are"}. The driver gets there in about{" "}
              {clock(taxi.driverSeconds)}.
            </p>
            <p className="text-sm text-muted">
              {distance(taxi.metres)} · about {clock(taxi.rideSeconds)} in the taxi. You pay when you get in.
            </p>
            {taxi.note && <p className="text-xs font-bold text-gold">{taxi.note}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={working || coins < taxi.fare} onClick={callTaxi} className={`${button} bg-gold text-ink`}>
                Call the taxi · {taxi.fare} coins
              </button>
              <button type="button" disabled={working} onClick={() => setTaxi(null)} className={`${button} border-[1.5px] border-line text-paper`}>
                Back
              </button>
            </div>
            {coins < taxi.fare && <p className="text-xs text-danger">You need {taxi.fare - coins} more coins.</p>}
          </div>
        ) : quote ? (
          // ---- The trip, priced: pay and board.
          <div className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4">
            <p className="text-lg font-bold">
              {TRANSIT[quote.mode].icon} {TRANSIT[quote.mode].label} {quote.mode === "bus" ? "towards" : "to"} {quote.label}
              {quote.to.code ? ` (${quote.to.code})` : ""}
            </p>
            {quote.mode === "bus" && (
              <p className="text-sm">
                Drops you at {quote.to.name}
                {quote.walkAfter && quote.walkAfter > 30 ? `, about ${distance(quote.walkAfter)} on foot from ${quote.label}` : ""}.{" "}
                {quote.metres > BUS_RANGE_M ? "A long-distance bus: express, no stops on the way." : "It stops at other bus stops on the way."}
              </p>
            )}
            <p className="text-sm text-muted">
              From {stopTitle(quote.from)} · {distance(quote.metres)} · about {clock(quote.seconds)}, including{" "}
              {quote.mode === "plane" ? "check-in and boarding" : "the wait"} ({clock(quote.waitSeconds)})
            </p>
            {quote.note && <p className="text-xs font-bold text-gold">{quote.note}</p>}
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
                      <p className="text-sm text-muted">
                        {stop.park
                          ? "Where to? Long-distance buses leave this motor park for motor parks all over Nigeria; city buses go up to 40 km."
                          : "Where to? City buses go up to 40 km and drop you at the stop nearest the place. For other cities, take a long-distance bus from a motor park."}
                      </p>
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
                  ) : (
                    <>
                      {stop.kind === "plane" && (
                        <AirportSearch from={stop} actions={actions} disabled={working} onPick={(d) => void run(() => actions.quoteTo(stop, d))} />
                      )}
                      {list === undefined ? (
                        <button
                          type="button"
                          onClick={() => void showDestinations(stop)}
                          className={`${button} self-start ${stop.kind === "plane" ? "border-[1.5px] border-gold text-paper" : "bg-gold text-ink"}`}
                        >
                          {stop.kind === "plane" ? `Flights within ${stop.country ?? "the country"}` : "See stations on this line"}
                        </button>
                      ) : list === "loading" ? (
                        <p className="text-sm text-muted">Loading…</p>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {list.map((d) => (
                            <DestinationRow key={d.id} d={d} disabled={working} onPick={() => void run(() => actions.quoteTo(stop, d))} />
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {/* ---- A taxi, from anywhere */}
            <div className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4">
              <p className="font-bold">🚕 Taxi</p>
              <p className="text-sm text-muted">A driver picks you up nearby and takes you anywhere within 40 km. Where to?</p>
              <PlaceSearch inline near={actions.where} onPick={(place) => void quoteTaxi(place)} />
              {heading && (
                <button type="button" disabled={working} onClick={() => void quoteTaxi(heading)} className={`${button} self-start border-[1.5px] border-gold text-paper`}>
                  Towards {heading.name}
                </button>
              )}
            </div>

            {/* ---- The nearest of each kind, with directions */}
            {(["bus", "train", "plane"] as const).map((kind) =>
              near.here.some((h) => h.kind === kind) ? null : (
                <NearestRow
                  key={kind}
                  title={`${TRANSIT[kind].icon} Nearest ${kind === "bus" ? "bus stop" : kind === "train" ? "train station" : "airport"}`}
                  stop={near.nearest[kind]}
                  actions={actions}
                  onClose={onClose}
                />
              ),
            )}
            {near.park && !near.here.some((h) => h.id === near.park!.id) && (
              <NearestRow title="🚌 Nearest motor park (buses to other cities)" stop={near.park} actions={actions} onClose={onClose} />
            )}
            {(near.lines ?? [])
              .filter((st) => st.line_id !== near.nearest.train?.line_id && !near.here.some((h) => h.line_id === st.line_id))
              .map((st) => (
                <NearestRow key={st.line_id} title={`🚆 ${st.line}`} stop={st} actions={actions} onClose={onClose} />
              ))}
            {working && <p className="text-sm text-muted">Working out the route…</p>}
          </div>
        )}
      </div>
    </div>
  );
}

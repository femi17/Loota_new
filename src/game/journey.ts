/**
 * The journey planner (design doc 7.8): going far isn't just a line on the
 * map. For a place more than a city away, the game works out how to get
 * there (fly, a long-distance bus, a train, or driving) as a few steps, each
 * with its time and fare, and guides the player through them one at a time.
 * Only the current step is drawn on the map.
 */
import { distanceM } from "./geo";
import { MODES, TIME_SCALE } from "./movement";
import { COACH_RANGE_M, transitFare, transitSpeedFor, transitWaitS, type TransitStop } from "./transit";
import type { Place } from "./places";

/** Within this, the player just goes (walking, riding, a taxi or a city bus): no journey needed. */
export const LOCAL_M = 35_000;
/** Flights only make sense beyond this. */
export const FLY_FROM_M = 150_000;
/** Taxis go up to 40 km (bus_range_m in the database). */
const TAXI_RANGE_M = 40_000;

/** Nigeria, roughly: where our own imported places, stops and lines are (elsewhere they come in as hunters do: src/lib/fill-area.ts). */
export function inNigeria(p: { lng: number; lat: number }) {
  return p.lng >= 2.6 && p.lng <= 14.7 && p.lat >= 4 && p.lat <= 14;
}

export type JourneyMode = "fly" | "coach" | "train" | "drive";

/** One step: getting somewhere yourself, or a ride (bus, train or plane) between two stops. */
export type JourneyLeg =
  | { kind: "go"; to: { name: string; lng: number; lat: number }; metres: number; seconds: number; fare: number | null; how: string }
  | { kind: "ride"; mode: "bus" | "train" | "plane"; from: TransitStop; to: TransitStop; metres: number; seconds: number; fare: number };

export type Journey = {
  mode: JourneyMode;
  place: Place;
  legs: JourneyLeg[];
  seconds: number;
  /** Coins for the rides and taxis (null when part of it can't be priced, e.g. a very long drive). */
  fare: number | null;
  /** A word of warning, e.g. the airport being far from the place. */
  note?: string;
};

const WALK_SPEED = (MODES.walk.kmh / 3.6) * TIME_SCALE;
const TAXI_SPEED = (45 / 3.6) * TIME_SCALE;
const ROAD_FACTOR = 1.3; // roads wind: about 30% longer than a straight line

/** Getting somewhere on your own: walk if it's close, a taxi within a city, otherwise a long way by road. */
export function goLeg(from: { lng: number; lat: number }, to: { name: string; lng: number; lat: number }): JourneyLeg & { kind: "go" } {
  const straight = distanceM([from.lng, from.lat], [to.lng, to.lat]);
  const metres = Math.round(straight * ROAD_FACTOR);
  if (metres <= 2500) return { kind: "go", to, metres, seconds: metres / WALK_SPEED, fare: 0, how: "Walk" };
  if (metres <= TAXI_RANGE_M) {
    return { kind: "go", to, metres, seconds: metres / TAXI_SPEED + 60, fare: transitFare("taxi", metres), how: "Taxi, city bus or your own ride" };
  }
  return { kind: "go", to, metres, seconds: metres / TAXI_SPEED, fare: null, how: "A long way by road: a long-distance bus or your own vehicle" };
}

/** A ride between two stops, estimated the way the database prices it (start_trip). */
export function rideLeg(mode: "bus" | "train" | "plane", from: TransitStop, to: TransitStop, alongM?: number): JourneyLeg & { kind: "ride" } {
  const straight = distanceM([from.lng, from.lat], [to.lng, to.lat]);
  const metres = Math.round(mode === "train" && alongM ? alongM : mode === "bus" ? straight * ROAD_FACTOR : straight);
  return { kind: "ride", mode, from, to, metres, seconds: transitWaitS(mode, false) + metres / transitSpeedFor(mode, metres), fare: transitFare(mode, metres) };
}

export function journeyOf(mode: JourneyMode, place: Place, legs: JourneyLeg[], note?: string): Journey {
  const seconds = legs.reduce((s, l) => s + l.seconds, 0);
  const fare = legs.some((l) => l.fare === null) ? null : legs.reduce((s, l) => s + (l.fare ?? 0), 0);
  return { mode, place, legs, seconds, fare, note };
}

/**
 * Can a long-distance bus do it? Within its range, in any country (owner, 27 Oct 2026: "this has to be one size fits
 * all"): whether one runs depends on the bus stations at each end.
 */
export function coachPossible(from: { lng: number; lat: number }, to: { lng: number; lat: number }) {
  return distanceM([from.lng, from.lat], [to.lng, to.lat]) <= COACH_RANGE_M;
}

/** A plane is worth it far away. */
export function flyingMakesSense(from: { lng: number; lat: number }, to: { lng: number; lat: number }) {
  return distanceM([from.lng, from.lat], [to.lng, to.lat]) >= FLY_FROM_M;
}

/** "17 min", "1 h 34 min" */
export function duration(seconds: number) {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

export const LEG_ICON = { walk: "🚶", go: "🚕", bus: "🚌", train: "🚆", plane: "✈️", drive: "🚗" } as const;

export const journeyLabel: Record<JourneyMode, string> = {
  fly: "Fly",
  coach: "Long-distance bus",
  train: "Train",
  drive: "Drive",
};

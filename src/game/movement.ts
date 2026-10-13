/**
 * Active travel engine (design doc section 5): speed, energy, sprinting,
 * fainting and arrival. Pure logic with no rendering, so the same rules can
 * run on the server to check arrivals later.
 */
import { headingOf, pointAt, turnTowards, type LngLat, type Route } from "./geo";

/** Game time runs this many times faster than real time (design doc 5.4). */
export const TIME_SCALE = 12;

export type Mode = "walk" | "bicycle" | "motorbike" | "car";

/** Speeds match max_travel_speed() in the database. `drain` is energy used per second at full pace. */
export const MODES: Record<Mode, { label: string; kmh: number; profile: "foot" | "bike" | "car"; drain: number }> = {
  walk: { label: "Walk", kmh: 5, profile: "foot", drain: 1.0 },
  bicycle: { label: "Bicycle", kmh: 16, profile: "bike", drain: 1.4 },
  motorbike: { label: "Motorbike", kmh: 35, profile: "car", drain: 0.25 },
  car: { label: "Car", kmh: 45, profile: "car", drain: 0.15 },
};

const SPRINT_SPEED = 1.6; // sprint is 60% faster…
const SPRINT_DRAIN = 2.5; // …and uses energy 2.5× as fast
const REST_REGEN = 6; // energy per second while standing still
const TIRED_AT = 20; // below this, you slow down
const TIRED_SPEED = 0.6;
const FAINT_SECONDS = 4;
const RECOVERED_ENERGY = 35;
const CELEBRATE_SECONDS = 3.5;
const ARRIVE_WITHIN_M = 1.5;

export type Phase = "idle" | "fainted" | "celebrate";

export type Traveller = {
  pos: LngLat;
  /** Scene heading in radians (see geo.headingOf). */
  heading: number;
  mode: Mode;
  route: Route | null;
  /** Metres travelled along the current route. */
  s: number;
  /** Current speed in on-screen metres per second. */
  v: number;
  energy: number;
  phase: Phase;
  phaseUntil: number;
  /** Below 1 when held back, e.g. pushing a motorbike that's out of fuel. */
  speedFactor: number;
};

export type Controls = { go: boolean; sprint: boolean };
export type StepEvent = "fainted" | "recovered";

/** Fastest a mode can go on screen (sprinting), in m/s; the server allows a margin on top (save_position). */
export function maxSpeed(mode: Mode): number {
  return baseSpeed(mode) * SPRINT_SPEED;
}

export function createTraveller(pos: LngLat, mode: Mode = "walk"): Traveller {
  return { pos: { ...pos }, heading: Math.PI, mode, route: null, s: 0, v: 0, energy: 100, phase: "idle", phaseUntil: 0, speedFactor: 1 };
}

/** Full-pace speed for a mode, in on-screen metres per second. */
export function baseSpeed(mode: Mode): number {
  return (MODES[mode].kmh / 3.6) * TIME_SCALE;
}

export function setRoute(t: Traveller, route: Route | null) {
  t.route = route;
  t.s = 0;
}

/**
 * Update speed, energy and fainting for `dt` seconds (`now` in seconds).
 * `canMove` says whether there's somewhere to go (a route, or a road in free
 * roam). Returns how far the traveller should move this frame; the caller
 * moves them along a route (advanceRoute) or the roads (roads.advance).
 */
export function step(
  t: Traveller,
  controls: Controls,
  dt: number,
  now: number,
  canMove: boolean,
): { distance: number; events: StepEvent[] } {
  const events: StepEvent[] = [];
  const base = baseSpeed(t.mode);

  if (t.phase !== "idle" && now >= t.phaseUntil) {
    if (t.phase === "fainted") {
      t.energy = RECOVERED_ENERGY;
      events.push("recovered");
    }
    t.phase = "idle";
  }

  let target = 0;
  if (t.phase === "idle" && canMove && (controls.go || controls.sprint)) {
    target = base * (controls.sprint ? SPRINT_SPEED : 1) * t.speedFactor;
    if (t.energy < TIRED_AT) target *= TIRED_SPEED;
  }
  t.v += (target - t.v) * Math.min(1, (target > t.v ? 2.5 : 4) * dt);
  if (target === 0 && t.v < 0.3) t.v = 0;

  if (t.v > 0.5) {
    t.energy -= MODES[t.mode].drain * (controls.sprint ? SPRINT_DRAIN : 1) * (t.v / base) * dt;
    if (t.energy <= 0) {
      t.energy = 0;
      t.v = 0;
      t.phase = "fainted";
      t.phaseUntil = now + FAINT_SECONDS;
      events.push("fainted");
    }
  } else if (t.phase === "idle") {
    t.energy = Math.min(100, t.energy + REST_REGEN * dt);
  }

  return { distance: t.v * dt, events };
}

/** Move `distance` metres along the planned route. Returns true on arrival. */
export function advanceRoute(t: Traveller, distance: number, dt: number, now: number): boolean {
  if (!t.route || distance <= 0) return false;
  t.s = Math.min(t.route.total, t.s + distance);
  const p = pointAt(t.route, t.s);
  t.pos = { lng: p.lng, lat: p.lat };
  t.heading = turnTowards(t.heading, headingOf(p.a, p.b), Math.min(1, 8 * dt));

  if (t.route.total - t.s < ARRIVE_WITHIN_M) {
    t.route = null;
    t.v = 0;
    t.phase = "celebrate";
    t.phaseUntil = now + CELEBRATE_SECONDS;
    return true;
  }
  return false;
}

export function isTired(t: Traveller) {
  return t.energy < TIRED_AT;
}

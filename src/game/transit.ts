/**
 * Public transport (design doc 5.5): buses, trains and planes. The numbers
 * match the database (migration public_transport): transit_speed,
 * transit_wait_s, transit_fare and transit_reach_m.
 */
import { TIME_SCALE } from "./movement";
import { distanceM, type Coord } from "./geo";

export type TransitMode = "bus" | "train" | "plane" | "taxi";

export const TRANSIT: Record<TransitMode, { label: string; icon: string; kmh: number; wait: string; reachM: number }> = {
  bus: { label: "Bus", icon: "🚌", kmh: 25, wait: "Wait for the bus", reachM: 40 },
  train: { label: "Train", icon: "🚆", kmh: 70, wait: "Wait for the train", reachM: 150 },
  plane: { label: "Plane", icon: "✈️", kmh: 750, wait: "Check-in and boarding", reachM: 600 },
  taxi: { label: "Taxi", icon: "🚕", kmh: 45, wait: "Your taxi is on its way", reachM: 35 },
};

/** A taxi driver fetching the player drives at a car's 45 km/h (driver_speed in the database; was 30 until 14 Nov 2026). */
export const DRIVER_SPEED = (45 / 3.6) * TIME_SCALE;

/** City buses run up to 40 km from any stop; long-distance buses go further, between motor parks only. */
export const BUS_RANGE_M = 40_000;
export const COACH_RANGE_M = 1_500_000;

/**
 * A motor park is a compound, its point often set back from the road (owner, 9 Nov 2026, at Mallam Karto Park: 48 m from
 * the nearest road, and nothing happened): it counts you there within this (the server: park_reach_m(), 150).
 */
export const PARK_REACH_M = 140;
/** How close counts as at a stop. */
export const reachOf = (st: { kind: TransitMode; park?: boolean }) => (st.kind === "bus" && st.park ? PARK_REACH_M : TRANSIT[st.kind].reachM);
/** Where there's a desk to buy at: a station's ticket office, an airport's check-in, a motor park's ticket office. */
export const hasOffice = (st: { kind: TransitMode; park?: boolean }) => st.kind === "train" || st.kind === "plane" || (st.kind === "bus" && !!st.park);
/**
 * A trip bought at the desk, not on the spot: a train ticket, a flight's check-in, and a long-distance bus from a motor
 * park (owner, 9 Nov 2026: "I should buy ticket since this is a inter state motor park").
 */
export const ticketed = (q: { mode: TransitMode; from: { park?: boolean }; metres: number }) =>
  q.mode === "train" || q.mode === "plane" || (q.mode === "bus" && !!q.from.park && q.metres > BUS_RANGE_M);

/** On-screen metres per second, like the active modes (movement.baseSpeed). */
export function transitSpeed(mode: TransitMode) {
  return (TRANSIT[mode].kmh / 3.6) * TIME_SCALE;
}

/**
 * A flight's time in the air (owner, 3 Nov 2026: "shorten the international flight time… to wait could be a long time
 * for users"): 2 minutes plus 40 seconds per 1,000 km, at most 12 minutes. Matches flight_s() in the database.
 */
export function flightS(metres: number) {
  return Math.min(720, 120 + (Math.max(0, metres) / 1_000_000) * 40);
}

/**
 * A bus or train journey's time (owner, 5 Nov 2026: "Like you did the plane, reduce the bus and train time too"): a
 * city bus 45 s plus 4 s a km (at most 3½ minutes), a long-distance bus 2 minutes plus a minute per 100 km (at most
 * 10), a train 1½ minutes plus 45 s per 100 km (at most 8). Matches bus_s() and train_s() in the database.
 */
export function busS(metres: number) {
  const m = Math.max(0, metres);
  // (a long-distance bus never quicker than the longest city ride)
  return metres > BUS_RANGE_M ? Math.min(600, Math.max(210, 120 + (m / 100_000) * 60)) : Math.min(210, 45 + (m / 1000) * 4);
}
export function trainS(metres: number) {
  return Math.min(480, 90 + (Math.max(0, metres) / 100_000) * 45);
}

/** The speed for a trip of `metres`: buses, trains and flights take their journey's time; a taxi drives. */
export function transitSpeedFor(mode: TransitMode, metres: number) {
  if (mode === "plane") return Math.max(metres, 1) / flightS(metres);
  if (mode === "bus") return Math.max(metres, 1) / busS(metres);
  if (mode === "train") return Math.max(metres, 1) / trainS(metres);
  return transitSpeed(mode);
}

export function transitWaitS(mode: TransitMode, fastPass: boolean) {
  if (mode === "bus") return fastPass ? 0 : 20; // (5 Nov 2026: was 35)
  if (mode === "train") return fastPass ? 0 : 30; // (was 50)
  if (mode === "taxi") return 0;
  return fastPass ? 60 : 180; // check-in and boarding
}

export function transitFare(mode: TransitMode, metres: number) {
  if (mode === "bus") return metres > BUS_RANGE_M ? 20 + Math.ceil((metres / 1000) * 0.4) : 3 + Math.ceil(metres / 1000);
  if (mode === "train") return 5 + Math.ceil(metres / 2000);
  if (mode === "taxi") return 8 + Math.ceil((metres / 1000) * 2);
  return 80 + Math.ceil((metres / 1000) * 0.15);
}

/** A stop, station or airport, as the server sends it. */
export type TransitStop = {
  id: number;
  kind: TransitMode;
  name: string;
  lng: number;
  lat: number;
  line_id: string | null;
  line: string | null;
  code: string | null;
  park: boolean;
  /** Airports: the city and country they serve. */
  city?: string | null;
  country?: string | null;
  /**
   * A station's ticket office or an airport's check-in desk, where the server insists the trip is bought (from our
   * road data: scripts/compute-desks.mts); none abroad, where the old rule stands (within reach of the stop).
   */
  desk_lng?: number | null;
  desk_lat?: number | null;
  metres: number;
};

/** Somewhere a train or plane can take you from here. */
export type TransitDestination = {
  id: number;
  name: string;
  code: string | null;
  lng: number;
  lat: number;
  city?: string | null;
  country?: string | null;
  metres: number;
  fare: number;
  seconds: number;
};

/** A trip the player has paid for (my_trip / start_trip). Times are ISO strings; `now` is the server's clock. */
export type Trip = {
  id: string;
  mode: TransitMode;
  line: string | null;
  from: string;
  to: string;
  toLng: number;
  toLat: number;
  path: Coord[];
  metres: number;
  fare: number;
  departsAt: string;
  arrivesAt: string;
  now: string;
  /** A crowded city bus (night, rush hour): "pending" until the player has pushed on (bus_rush_start). */
  rush?: "pending" | "boarded" | null;
  rushTries?: number;
  /** A Fast Pass was used on it (at booking, or while waiting). */
  fastPass?: boolean;
};

/** A flight's gate, from where it's going (the same on the boarding pass and in the departure lounge). */
export function gateFor(destination: string) {
  let h = 0;
  for (const ch of destination) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return 1 + (Math.abs(h) % 6);
}

/** "2 min 30 s", "45 s" */
export function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

/** The part of a train line between two points along it (metres from its start), in travel order. */
export function sliceLine(path: Coord[], fromM: number, toM: number): Coord[] {
  const [lo, hi] = fromM < toM ? [fromM, toM] : [toM, fromM];
  const out: Coord[] = [];
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = distanceM(path[i - 1], path[i]);
    const a = run;
    const b = run + seg;
    const at = (m: number): Coord => {
      const f = seg ? (m - a) / seg : 0;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f];
    };
    if (b >= lo && a <= hi) {
      if (!out.length) out.push(at(Math.max(lo, a)));
      out.push(b <= hi ? path[i] : at(hi));
    }
    run = b;
    if (run > hi) break;
  }
  return fromM < toM ? out : out.reverse();
}

/** A plane's way: the great circle between two airports, as points about every 5 km. */
export function flightPath(from: Coord, to: Coord): Coord[] {
  const toRad = Math.PI / 180;
  const [l1, p1] = [from[0] * toRad, from[1] * toRad];
  const [l2, p2] = [to[0] * toRad, to[1] * toRad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return [from, to];
  const steps = Math.max(2, Math.ceil(distanceM(from, to) / 5000));
  const out: Coord[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    let lng = Math.atan2(y, x) / toRad;
    // Across the date line, keep going (190° rather than −170°) so the way stays continuous.
    if (out.length) lng += Math.round((out[out.length - 1][0] - lng) / 360) * 360;
    out.push([lng, Math.atan2(z, Math.hypot(x, y)) / toRad]);
  }
  return out;
}

/** Where along a path a distance lands: the point and which way it faces (scene heading, see geo.headingOf). */
export function alongPath(path: Coord[], cumulative: number[], metres: number): { pos: Coord; segment: number } {
  const total = cumulative[cumulative.length - 1];
  const m = Math.max(0, Math.min(total, metres));
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < m) i++;
  const seg = cumulative[i] - cumulative[i - 1];
  const f = seg ? (m - cumulative[i - 1]) / seg : 0;
  return { pos: [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f], segment: i };
}

export function cumulativeOf(path: Coord[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + distanceM(path[i - 1], path[i]));
  return out;
}

/** Fewer points for sending a long road path (keeps the shape within ~`tolM` metres). */
export function thinPath(points: Coord[], tolM = 4): Coord[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const lat0 = (points[0][1] * Math.PI) / 180;
  const xy = points.map(([lng, lat]) => [lng * 111320 * Math.cos(lat0), lat * 110574]);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = xy[i];
    const [bx, by] = xy[j];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let worstM = tolM;
    for (let k = i + 1; k < j; k++) {
      const m = Math.abs((bx - ax) * (ay - xy[k][1]) - (ax - xy[k][0]) * (by - ay)) / len;
      if (m > worstM) {
        worstM = m;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return points.filter((_, k) => keep[k]).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)] as Coord);
}

/** Carriages in a train on the map. */
export const TRAIN_CARS = 3;

/**
 * A train pulls away and brakes into the station (owner, 8 Nov 2026: "The train movement is wierd. It moves too fast"):
 * the share of the way gone at a share of the time `f`, speeding up over the first 12% of the time and slowing over the
 * last 12%, steady between, and arriving on time. Used by the game and the broadcast alike.
 */
export const TRAIN_EASE = 0.12;
export function trainAlong(f: number) {
  const a = TRAIN_EASE, v = 1 / (1 - a);
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  if (f < a) return (0.5 * v * f * f) / a;
  if (f > 1 - a) return 1 - (0.5 * v * (1 - f) * (1 - f)) / a;
  return v * (f - a / 2);
}

/**
 * How far back the camera must be for something moving at `speed` (m/s) to cross the screen at a steady, easy pace,
 * about 120 pixels a second (as the plane's: owner, 9 Nov 2026: "the km of the plane is running fast but the plane move
 * is not too fast. Same thing should apply to the buses and trains"): no closer than `near`, no further than zoom 11.
 */
export function paceZoom(speed: number, lat: number, near: number) {
  const far = Math.log2((120 * 40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.max(1, speed)));
  return Math.max(11, Math.min(near, far));
}

/**
 * The camera's zoom on a train (owner, 8 Nov 2026; 9 Nov 2026): as far back as its speed at that moment needs, so it
 * keeps a steady pace on the screen all the way, coming in as it brakes into the station (close in, `near`, when it's
 * standing). `totalM`: the trip's length; `seconds`: its time; `along`: how far it has gone.
 */
export function trainZoom(totalM: number, seconds: number, along: number, lat: number, near: number) {
  // The share of the time gone (trainAlong, turned round), and the speed then
  const a = TRAIN_EASE, v = 1 / (1 - a);
  const u = Math.max(0, Math.min(1, along / Math.max(1, totalM)));
  const f = u < 0.5 * v * a ? Math.sqrt((2 * u * a) / v) : u > 1 - 0.5 * v * a ? 1 - Math.sqrt((2 * (1 - u) * a) / v) : u / v + a / 2;
  const rate = f < a ? (v * f) / a : f > 1 - a ? (v * (1 - f)) / a : v; // trainAlong's slope
  return paceZoom((rate * totalM) / Math.max(1, seconds), lat, near);
}

/**
 * The camera's zoom on a bus or taxi (owner, 9 Nov 2026: "the bus was just moving too fast"): as far back as its speed
 * between stops (`cruise`, m/s) needs, held through its stops and red lights (not in and out at each). A bus pulls away
 * at its speed and stops dead, so the camera goes up over the last 4 seconds at the stop before it leaves, and comes
 * down over the 2 seconds after it's in. `elapsedMs`: since it left (negative before); `leftMs`: to its arrival.
 */
export function busZoom(cruise: number, elapsedMs: number, leftMs: number, lat: number, near: number) {
  const z = paceZoom(cruise, lat, near);
  const k = Math.max(0, Math.min(1, (elapsedMs + 4000) / 4000, (leftMs + 2000) / 2000));
  return near - (near - z) * k * k * (3 - 2 * k);
}

/**
 * How a bus or taxi spends its ride. The server fixes the earliest it arrives (traffic already makes rush-hour
 * rides longer); this shares that time out along the road, so the vehicle crawls where the map shows a jam,
 * waits at bus stops and red lights, and makes up time on clear road. It never runs a red light: on a road with
 * more lights than the time allows, the ride runs over a little (`ends`).
 */

import { jamOn, trafficLevel } from "./clock";
import { cellUrban, jamStretch } from "./roads";
import type { RoadCellData } from "./roadData";

/**
 * The jam (0–2) on each piece of a path, as the map draws them: each piece matched to the road it runs along
 * in our road squares (`cells`), at the time the vehicle gets there (`timeAt(metres)`, wall-clock ms).
 */
export function jamsAlongPath(cells: RoadCellData[], path: [number, number][], cum: number[], timeAt: (s: number) => number): number[] {
  const BIN = 0.0004; // ~45 m
  type Piece = { cls: RoadCellData["ways"][number]["cls"]; stretch: number; urban: number; ax: number; ay: number; bx: number; by: number };
  const bins = new Map<string, Piece[]>();
  const lat0 = path[0]?.[1] ?? 0;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  for (const cell of cells) {
    const urban = cellUrban(cell);
    if (urban <= 0) continue;
    const pts = new Map(cell.points.map((p) => [p.id, p]));
    for (const way of cell.ways) {
      for (let i = 1; i < way.points.length; i++) {
        const a = pts.get(way.points[i - 1]);
        const b = pts.get(way.points[i]);
        if (!a || !b) continue;
        const piece: Piece = { cls: way.cls, stretch: jamStretch(way, a), urban, ax: a.lng * kx, ay: a.lat * ky, bx: b.lng * kx, by: b.lat * ky };
        const keys = new Set([`${Math.floor(a.lng / BIN)},${Math.floor(a.lat / BIN)}`, `${Math.floor(b.lng / BIN)},${Math.floor(b.lat / BIN)}`]);
        for (const key of keys) {
          const list = bins.get(key);
          if (list) list.push(piece);
          else bins.set(key, [piece]);
        }
      }
    }
  }
  const jams: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const mid = { lng: (path[i - 1][0] + path[i][0]) / 2, lat: (path[i - 1][1] + path[i][1]) / 2 };
    const px = mid.lng * kx;
    const py = mid.lat * ky;
    let best: { piece: Piece; off: number } | null = null;
    const gx = Math.floor(mid.lng / BIN);
    const gy = Math.floor(mid.lat / BIN);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const p of bins.get(`${gx + dx},${gy + dy}`) ?? []) {
          const ex = p.bx - p.ax;
          const ey = p.by - p.ay;
          const f = Math.max(0, Math.min(1, ((px - p.ax) * ex + (py - p.ay) * ey) / (ex * ex + ey * ey || 1e-9)));
          const off = Math.hypot(p.ax + f * ex - px, p.ay + f * ey - py);
          if (off < 12 && (!best || off < best.off)) best = { piece: p, off };
        }
      }
    }
    if (!best) {
      jams.push(0);
      continue;
    }
    const t = timeAt((cum[i - 1] + cum[i]) / 2);
    jams.push(jamOn(best.piece.cls, best.piece.stretch, best.piece.urban, trafficLevel(t, mid.lng, mid.lat), t));
  }
  return jams;
}

export type Hold = {
  kind: "stop" | "signal";
  /** Metres along the path where it stands. */
  s: number;
  dwell: number;
  /** When it gets there, in ms after leaving. */
  at: number;
  /** The bus stop's index (stop), or the light's id (signal). */
  ref: number;
};

export type RideSchedule = {
  holds: Hold[];
  /** "Cost" (metres × slowness) at each point of the path. */
  costCum: number[];
  /** Cost covered per ms while moving. */
  perMs: number;
  /** How slow each piece of the path is (1: clear road). */
  slowness: number[];
  /** When it reaches the end, in ms after leaving (the ride's time, or a little more through many lights). */
  ends: number;
};

/** Slowness in a jam: a bus or taxi crawls like a car (0.45 of its speed when slow, 0.15 at a standstill). */
export const JAM_SLOWNESS = [1, 1 / 0.45, 1 / 0.15] as const;

/**
 * `jams`: the jam (0–2) on each piece of the path (path.length − 1); `stops`: bus stops (s, dwell);
 * `signals`: lights on the way (s, id); `waitAt(id, wallMs)`: how long a light keeps the vehicle at `wallMs`;
 * `leaves`: the wall-clock ms it leaves; `rideMs`: the whole ride.
 */
export function planRide(
  cum: number[],
  jams: number[],
  stops: { s: number; dwell: number }[],
  signals: { s: number; id: number }[],
  waitAt: (id: number, wallMs: number) => number,
  leaves: number,
  rideMs: number,
): RideSchedule {
  const total = cum[cum.length - 1] || 1;
  const slowness = jams.map((j) => JAM_SLOWNESS[j] ?? 1);
  const costCum = [0];
  for (let i = 1; i < cum.length; i++) costCum.push(costCum[i - 1] + (cum[i] - cum[i - 1]) * (slowness[i - 1] ?? 1));
  const costTotal = costCum[costCum.length - 1] || total;
  // The vehicle stops a few metres before the light.
  const lights = signals.filter((sg) => sg.s > 10 && sg.s < total - 10).map((sg) => ({ ...sg, s: sg.s - 6 }));
  const holds: Hold[] = [
    ...stops.map((st, i) => ({ kind: "stop" as const, s: st.s, dwell: st.dwell, at: 0, ref: i })),
    ...lights.map((sg) => ({ kind: "signal" as const, s: sg.s, dwell: 0, at: 0, ref: sg.id })),
  ].sort((a, b) => a.s - b.s);
  /** The ride at this speed, hold by hold (each light's wait from its colour when the vehicle gets there): when it ends. */
  const drive = (perMs: number) => {
    let waited = 0;
    for (const h of holds) {
      h.at = costAt(cum, costCum, h.s) / perMs + waited;
      if (h.kind === "signal") h.dwell = waitAt(h.ref, leaves + h.at);
      waited += h.dwell;
    }
    return costTotal / perMs + waited;
  };
  // The speed at which it ends on time (or just before: a wait can't be split), moving at most 3 times as fast
  // as it would without stopping; through more lights than that allows, it ends late.
  let slow = costTotal / Math.max(1, rideMs); // without waiting, exactly on time; with any, later
  let fast = (3 * costTotal) / Math.max(1, rideMs);
  if (drive(slow) <= rideMs) fast = slow;
  else if (drive(fast) > rideMs) slow = fast;
  for (let i = 0; i < 40 && fast !== slow; i++) {
    const mid = (slow + fast) / 2;
    if (drive(mid) <= rideMs) fast = mid;
    else slow = mid;
  }
  const ends = drive(fast); // the timings at the speed chosen
  return { holds, costCum, perMs: fast, slowness, ends };
}

/** Cost at `s` metres along. */
function costAt(cum: number[], costCum: number[], s: number) {
  const i = segmentOf(cum, s);
  const len = cum[i + 1] - cum[i] || 1;
  return costCum[i] + ((s - cum[i]) / len) * (costCum[i + 1] - costCum[i]);
}

/** The piece of the path `s` lies on (binary search). */
function segmentOf(cum: number[], s: number) {
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** Where the vehicle is `elapsed` ms after leaving: metres along, the hold it's at (if any), the next stop, the jam. */
export function rideAt(plan: RideSchedule, cum: number[], elapsed: number): { s: number; at: Hold | null; nextStop: Hold | null; jam: number } {
  const total = cum[cum.length - 1];
  let waited = 0;
  let at: Hold | null = null;
  let moving = elapsed;
  for (const h of plan.holds) {
    if (!h.dwell) continue;
    if (elapsed < h.at) break;
    if (elapsed < h.at + h.dwell) {
      at = h;
      break;
    }
    waited += h.dwell;
  }
  const nextStop = plan.holds.find((h) => h.kind === "stop" && h.dwell > 0 && (h === at || h.at > elapsed)) ?? null;
  if (at) return { s: at.s, at, nextStop, jam: jamOf(plan, cum, at.s) };
  moving = elapsed - waited;
  const s = Math.min(total, sAtCost(cum, plan.costCum, moving * plan.perMs));
  return { s, at: null, nextStop, jam: jamOf(plan, cum, s) };
}

function jamOf(plan: RideSchedule, cum: number[], s: number) {
  const k = plan.slowness[segmentOf(cum, s)] ?? 1;
  return k >= JAM_SLOWNESS[2] ? 2 : k > 1 ? 1 : 0;
}

/** Metres along for a cost (binary search). */
function sAtCost(cum: number[], costCum: number[], c: number) {
  if (c <= 0) return 0;
  const last = costCum.length - 1;
  if (c >= costCum[last]) return cum[last];
  let lo = 0;
  let hi = last - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (costCum[mid] <= c) lo = mid;
    else hi = mid - 1;
  }
  const span = costCum[lo + 1] - costCum[lo] || 1;
  return cum[lo] + ((c - costCum[lo]) / span) * (cum[lo + 1] - cum[lo]);
}

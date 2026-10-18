/**
 * Traffic lights: the real ones from OpenStreetMap (public/data/traffic-signals.json, `npm run signals:fetch`).
 * A junction's lights cycle green → amber → red every 20 s (game time: travel runs 12 times faster than real
 * life, so a real minute-long cycle would hold a taxi longer than its whole ride), each junction from its own
 * starting point, so a light shows the same colour to every player at the same moment. Cars, motorbikes and bicycles stop at red (walkers don't);
 * buses and taxis wait at red lights on their way.
 */

/** `group`: the junction's controller: lights within 50 m of each other (one per approach) change together. */
export type Signal = { id: number; lng: number; lat: number; group: number };
export type Light = "green" | "amber" | "red";

export const SIGNAL_CYCLE_MS = 20_000;
const GREEN_MS = 9_000;
const AMBER_MS = 2_000; // then red for the rest of the cycle

/** Where this light's cycle starts (0 to the cycle's length). */
function phase(id: number) {
  let h = Math.imul(id ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return ((h >>> 0) % SIGNAL_CYCLE_MS) | 0;
}

/** The colour of a junction's lights (`group`) at `ms` (wall clock), and how long until it changes. */
export function signalState(id: number, ms: number): { light: Light; changesIn: number } {
  const t = (((ms + phase(id)) % SIGNAL_CYCLE_MS) + SIGNAL_CYCLE_MS) % SIGNAL_CYCLE_MS;
  if (t < GREEN_MS) return { light: "green", changesIn: GREEN_MS - t };
  if (t < GREEN_MS + AMBER_MS) return { light: "amber", changesIn: GREEN_MS + AMBER_MS - t };
  return { light: "red", changesIn: SIGNAL_CYCLE_MS - t };
}

/** How long a vehicle arriving at `ms` waits for green at a junction (`group`; 0 on green). */
export function waitForGreen(id: number, ms: number) {
  const s = signalState(id, ms);
  if (s.light === "green") return 0;
  return s.light === "red" ? s.changesIn : s.changesIn + (SIGNAL_CYCLE_MS - GREEN_MS - AMBER_MS);
}

let loading: Promise<Signal[]> | null = null;
/** Every traffic light (loaded once). */
export function loadSignals(): Promise<Signal[]> {
  loading ??= fetch("/data/traffic-signals.json")
    .then((r) => (r.ok ? r.json() : { signals: [] }))
    .then((d: { signals: [number, number, number][] }) => withGroups(d.signals))
    .catch(() => {
      loading = null; // try again next time
      return [];
    });
  return loading;
}

/** The lights from the data file, each with its junction's controller (the lowest id among lights chained within 50 m). */
export function withGroups(raw: [number, number, number][]): Signal[] {
  const list = raw.map(([id, lng, lat]) => ({ id, lng, lat, group: id }));
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = list.map((_, i) => i).sort((a, b) => list[a].lat - list[b].lat);
  for (let x = 0; x < order.length; x++) {
    for (let y = x + 1; y < order.length && list[order[y]].lat - list[order[x]].lat < 0.0005; y++) {
      const d = offset(list[order[x]], list[order[y]]);
      if (Math.hypot(d.x, d.y) <= 50) parent[find(order[y])] = find(order[x]);
    }
  }
  const lowest = new Map<number, number>();
  list.forEach((s, i) => lowest.set(find(i), Math.min(lowest.get(find(i)) ?? Infinity, s.id)));
  list.forEach((s, i) => (s.group = lowest.get(find(i))!));
  return list;
}

/** Metres east and north of `from`. */
function offset(from: { lng: number; lat: number }, to: { lng: number; lat: number }) {
  return { x: (to.lng - from.lng) * 111320 * Math.cos((from.lat * Math.PI) / 180), y: (to.lat - from.lat) * 110574 };
}

/** The lights within `m` metres. */
export function signalsNear(all: Signal[], at: { lng: number; lat: number }, m: number) {
  return all.filter((s) => {
    const d = offset(at, s);
    return Math.hypot(d.x, d.y) <= m;
  });
}

/**
 * The light just ahead of someone at `at` facing `heading` (as geo.headingOf: east = sin, north = −cos): within
 * `reach` metres in front and a few metres either side of the way they face, with how far ahead it is.
 */
export function signalAhead(all: Signal[], at: { lng: number; lat: number }, heading: number, reach = 22) {
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  let best: { signal: Signal; ahead: number } | null = null;
  for (const s of all) {
    const d = offset(at, s);
    const ahead = d.x * fx + d.y * fy;
    const side = Math.abs(d.x * fy - d.y * fx);
    if (ahead <= 0 || ahead > reach || side > 9) continue;
    if (!best || ahead < best.ahead) best = { signal: s, ahead };
  }
  return best;
}

/** The lights along a path (within 12 m of it), with how far along it each one is, in order. */
export function signalsOnPath(all: Signal[], path: [number, number][], cum: number[]) {
  if (path.length < 2) return [];
  const lngs = path.map((p) => p[0]);
  const lats = path.map((p) => p[1]);
  const pad = 0.0005;
  const box = { w: Math.min(...lngs) - pad, e: Math.max(...lngs) + pad, s: Math.min(...lats) - pad, n: Math.max(...lats) + pad };
  const found: { signal: Signal; s: number }[] = [];
  for (const sg of all) {
    if (sg.lng < box.w || sg.lng > box.e || sg.lat < box.s || sg.lat > box.n) continue;
    let best = { off: Infinity, s: 0 };
    for (let i = 1; i < path.length; i++) {
      const a = { lng: path[i - 1][0], lat: path[i - 1][1] };
      const b = offset(a, { lng: path[i][0], lat: path[i][1] });
      const p = offset(a, sg);
      const len2 = b.x * b.x + b.y * b.y || 1e-9;
      const f = Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / len2));
      const off = Math.hypot(b.x * f - p.x, b.y * f - p.y);
      if (off < best.off) best = { off, s: cum[i - 1] + f * (cum[i] - cum[i - 1]) };
    }
    if (best.off <= 12) found.push({ signal: sg, s: best.s });
  }
  return found.sort((a, b) => a.s - b.s);
}

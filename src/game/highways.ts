/**
 * Nigeria's main roads (motorways, trunk, primary and secondary) as one small
 * network, for long-distance trips: a long-distance bus finds its way from
 * motor park to motor park on it, without any outside routing service.
 * Built by scripts/build-highways.mts from our own road squares.
 */
import { ROAD_DATA_VERSION } from "./roadData";
import { distanceM, type Coord } from "./geo";

/** The file: coordinates in 1e-5 degrees, delta-encoded; each road is [one-way (0, 1 or −1), point indices…]. */
export type HighwayFile = { v: 1; lng: number[]; lat: number[]; roads: number[][] };

type Graph = { pts: Coord[]; out: { to: number; m: number }[][] };

let loading: Promise<Graph | null> | null = null;

/** Load the network once (about a megabyte); null if it isn't available. */
export function loadHighways(baseUrl: string): Promise<Graph | null> {
  loading ??= (async () => {
    try {
      const res = await fetch(`${baseUrl}/roads/${ROAD_DATA_VERSION}/highways.json.gz`);
      if (!res.ok || !res.body) return null;
      const text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
      const file = JSON.parse(text) as HighwayFile;
      const pts: Coord[] = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < file.lng.length; i++) {
        x += file.lng[i];
        y += file.lat[i];
        pts.push([x / 1e5, y / 1e5]);
      }
      const out: Graph["out"] = pts.map(() => []);
      for (const [oneway, ...ids] of file.roads) {
        for (let i = 1; i < ids.length; i++) {
          const m = distanceM(pts[ids[i - 1]], pts[ids[i]]);
          if (oneway !== -1) out[ids[i - 1]].push({ to: ids[i], m });
          if (oneway !== 1) out[ids[i]].push({ to: ids[i - 1], m });
        }
      }
      return { pts, out };
    } catch {
      return null;
    }
  })();
  const pending = loading;
  void pending.then((g) => {
    if (!g && loading === pending) loading = null; // try again next time
  });
  return pending;
}

/** The network point nearest a place (that has roads leaving it). */
function nearest(g: Graph, p: Coord) {
  let best = -1;
  let bestM = Infinity;
  const k = Math.cos((p[1] * Math.PI) / 180);
  for (let i = 0; i < g.pts.length; i++) {
    if (!g.out[i].length) continue;
    const dx = (g.pts[i][0] - p[0]) * k;
    const dy = g.pts[i][1] - p[1];
    const d = dx * dx + dy * dy;
    if (d < bestM) {
      bestM = d;
      best = i;
    }
  }
  return best;
}

/**
 * The shortest way along main roads from one place to another (each joined to
 * its nearest main road), or null if they aren't connected.
 */
export function highwayRoute(g: Graph, from: Coord, to: Coord): Coord[] | null {
  const a = nearest(g, from);
  const b = nearest(g, to);
  if (a < 0 || b < 0) return null;
  const dist = new Float64Array(g.pts.length).fill(Infinity);
  const prev = new Int32Array(g.pts.length).fill(-1);
  const heap: [number, number][] = [[0, a]];
  dist[a] = 0;
  while (heap.length) {
    const [d, n] = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    if (d > dist[n]) continue;
    if (n === b) break;
    for (const e of g.out[n]) {
      const nd = d + e.m;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = n;
        heap.push([nd, e.to]);
        for (let i = heap.length - 1; i > 0; ) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[p], heap[i]] = [heap[i], heap[p]];
          i = p;
        }
      }
    }
  }
  if (!Number.isFinite(dist[b])) return null;
  const path: Coord[] = [];
  for (let n = b; n !== -1; n = prev[n]) path.push(g.pts[n]);
  path.reverse();
  return [from, ...path, to];
}

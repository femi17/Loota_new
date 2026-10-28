import type { SupabaseClient } from "@supabase/supabase-js";
import { inNigeria } from "@/game/journey";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { DEFAULT_NAME, type PlaceKind, type Tags } from "@/lib/osm-places";

/**
 * The world beyond Nigeria (owner, 27 Oct 2026, in the United States: "I cannot pump my tire at the gas station… when I
 * pass bus signs on the map my bus icon is not lit up"; then "this has to be one size fits all… the bus, train should
 * work according to the country"). Petrol stations, places to eat and rest, tyre shops, mechanics, hospitals, bus stops
 * and train lines were imported for Nigeria only (scripts/build-places.mts, build-transit.mts). Each square of AREA_DEG
 * a hunter comes to elsewhere is filled once and kept (filled_areas): the square they're in first, then the ones around
 * it, one at a time. Its places and bus stops come from the map's own tiles (seconds); then each train line through it
 * comes in whole, its way and stations, from OpenStreetMap's query service (slow: the tiles don't say which stations
 * make a line), the first time any square of it is filled.
 */
const AREA_DEG = 0.05; // ~5.5 km: small enough for a busy city's square to come back quickly
/** OpenStreetMap's query service: the main server, then public copies of it. */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const RETRY_AFTER_MS = 3 * 60_000; // a square that failed (the service busy) is tried again after this
const STUCK_AFTER_MS = 10 * 60_000; // one never finished (the server stopped mid-way) is tried again after this
const LINES_PER_SQUARE = 8; // new train lines brought in per square at most (a city centre can have dozens)

type Point = { lat: number; lon: number };
type Member = { type: "node" | "way" | "relation"; ref: number; role: string; lat?: number; lon?: number; geometry?: Point[] };
type Element = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: Point;
  tags?: Tags;
  members?: Member[];
};

const cellOf = (lng: number, lat: number) => ({ ix: Math.floor(lng / AREA_DEG), iy: Math.floor(lat / AREA_DEG) });
const keyOf = (ix: number, iy: number) => `${ix}_${iy}`;
const boxOf = (ix: number, iy: number) => ({ s: iy * AREA_DEG, w: ix * AREA_DEG, n: (iy + 1) * AREA_DEG, e: (ix + 1) * AREA_DEG });
const metres = (a: Point, b: Point) =>
  Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180), (a.lat - b.lat) * 110_574);

/** Whether the square (lng, lat) is in has its places and stops (Nigeria always has). */
export async function isFilled(admin: SupabaseClient, lng: number, lat: number): Promise<boolean> {
  if (inNigeria({ lng, lat })) return true;
  const { ix, iy } = cellOf(lng, lat);
  const { data } = await admin.from("filled_areas").select("filled_at").eq("cell", keyOf(ix, iy)).maybeSingle();
  return !!data?.filled_at;
}

/** Fills the nearest square around (lng, lat) that isn't filled yet, if any (`lines`: its train lines too). Returns its key, or null. */
export async function fillArea(admin: SupabaseClient, lng: number, lat: number, { lines = true } = {}): Promise<string | null> {
  if (inNigeria({ lng, lat })) return null;
  const { ix, iy } = cellOf(lng, lat);
  const around: { key: string; ix: number; iy: number; d: number }[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const cx = (ix + dx + 0.5) * AREA_DEG;
      const cy = (iy + dy + 0.5) * AREA_DEG;
      around.push({ key: keyOf(ix + dx, iy + dy), ix: ix + dx, iy: iy + dy, d: Math.hypot(cx - lng, cy - lat) });
    }
  around.sort((a, b) => a.d - b.d);
  const { data: known } = await admin.from("filled_areas").select("cell, started_at, filled_at, failed_at").in("cell", around.map((a) => a.key));
  const state = new Map((known ?? []).map((k) => [k.cell as string, k]));
  const now = Date.now();
  // One at a time around a hunter (owner, 27 Oct 2026, San Francisco: a dozen at once swamped the service and none
  // finished): one still going is left to finish.
  const going = (k: { started_at: string; filled_at: string | null; failed_at: string | null }) =>
    !k.filled_at && !k.failed_at && now - Date.parse(k.started_at) < STUCK_AFTER_MS;
  if ((known ?? []).some(going)) return null;
  const next = around.find((a) => {
    const k = state.get(a.key);
    if (!k) return true;
    if (k.filled_at) return false;
    // Failed (the service busy): again after a while. Never finished (stopped mid-way): again too.
    return k.failed_at ? now - Date.parse(k.failed_at) > RETRY_AFTER_MS : !going(k);
  });
  if (!next) return null;

  // Claim it, so two hunters arriving together don't fill it twice.
  const was = state.get(next.key);
  const claim = was
    ? await admin.from("filled_areas").update({ started_at: new Date().toISOString(), failed_at: null }).eq("cell", next.key).eq("started_at", was.started_at).select("cell")
    : await admin.from("filled_areas").insert({ cell: next.key }).select("cell");
  if (claim.error || !claim.data?.length) return null;

  let busStops = 0;
  try {
    const { places, stops } = await fetchSquare(next.ix, next.iy);
    busStops = stops.length;
    if (was) {
      // Tried before and stopped part-way: what it put in goes, so nothing is there twice.
      const b = boxOf(next.ix, next.iy);
      await admin.from("places").delete().gte("lng", b.w).lt("lng", b.e).gte("lat", b.s).lt("lat", b.n);
      await admin.from("transit_stops").delete().eq("kind", "bus").gte("lng", b.w).lt("lng", b.e).gte("lat", b.s).lt("lat", b.n);
    }
    for (let i = 0; i < places.length; i += 500) {
      const { error } = await admin.from("places").insert(places.slice(i, i + 500));
      if (error) throw error;
    }
    for (let i = 0; i < stops.length; i += 500) {
      const { error } = await admin.from("transit_stops").insert(stops.slice(i, i + 500));
      if (error) throw error;
    }
    // The places count from now: a hunter there can eat, rest, refuel and take a bus.
    await admin.from("filled_areas").update({ filled_at: new Date().toISOString(), places: places.length, stops: stops.length }).eq("cell", next.key);
  } catch (e) {
    console.error(`fillArea ${next.key}:`, e);
    await admin.from("filled_areas").update({ failed_at: new Date().toISOString() }).eq("cell", next.key);
    return next.key;
  }
  // Then its train lines, the slow part (a whole line each; left out by checks that only want the places).
  if (!lines) return next.key;
  try {
    const stations = await fillTrainLines(admin, next.ix, next.iy);
    if (stations) await admin.from("filled_areas").update({ stops: busStops + stations }).eq("cell", next.key);
  } catch (e) {
    console.error(`fillArea ${next.key} train lines:`, e); // its lines come with the next square through them
  }
  return next.key;
}

/** Asks OpenStreetMap. The public servers are often busy (502, 429, 504): the next one, then round again after a pause. */
async function overpass(query: string, { rounds = 2, seconds = 120 } = {}): Promise<Element[]> {
  let last = "";
  for (let round = 0; round < rounds; round++) {
    if (round) await new Promise((r) => setTimeout(r, 5000));
    for (const server of OVERPASS) {
      try {
        const res = await fetch(server, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Loota/1.0 (treasure-hunt game)" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(seconds * 1000),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        return ((await res.json()) as { elements: Element[] }).elements;
      } catch (e) {
        last = `${new URL(server).host}: ${e instanceof Error ? e.message : e}`;
      }
    }
  }
  throw new Error(`Overpass busy (${last})`);
}

/**
 * The map's own tiles (OpenFreeMap, OpenMapTiles' "poi" layer): the same cafés, petrol stations, bus stops, parks and
 * malls the map draws, fast and from a service built for the traffic (owner, 27 Oct 2026, in San Francisco: "it is
 * telling no chill area" while the map showed cafés all round; OpenStreetMap's query service was too busy to answer).
 */
const TILES = "https://tiles.openfreemap.org/planet";
const TILE_Z = 14; // the most detailed: every place and stop
let tileUrl: { template: string; at: number } | null = null;
async function tileTemplate() {
  // The current build's address, from the service's own description (it moves with each weekly build).
  if (!tileUrl || Date.now() - tileUrl.at > 6 * 3600_000) {
    const res = await fetch(TILES, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`tiles ${res.status}`);
    tileUrl = { template: ((await res.json()) as { tiles: string[] }).tiles[0], at: Date.now() };
  }
  return tileUrl.template;
}

/** What a map place is to the game, by its OpenMapTiles class and subclass (the same things kindOf takes from OSM). */
function kindOfPoi(cls: string, sub: string): PlaceKind | "stop" | "park" | null {
  if (sub === "bus_stop") return "stop";
  if (sub === "bus_station") return "park";
  if (sub === "fuel") return "fuel";
  if (sub === "hospital" || sub === "clinic") return "hospital";
  if (sub === "tyres") return "tyres";
  if (sub === "car_repair" || sub === "motorcycle_repair") return "mechanic";
  if (["restaurant", "fast_food", "cafe", "food_court"].includes(sub)) return "eat";
  if (sub === "park" || sub === "garden" || sub === "mall" || cls === "park") return "rest";
  return null;
}
const POI_NAME: Record<string, string> = { mall: "Shopping mall", garden: "Garden", food_court: "Food court", tyres: "Tyre shop" };

/** One square's places and bus stops, from the map tiles over it. */
async function fetchSquare(ix: number, iy: number) {
  const b = boxOf(ix, iy);
  const n = 2 ** TILE_Z;
  const tx = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const template = await tileTemplate();
  const jobs: Promise<{ x: number; y: number; tile: VectorTile }>[] = [];
  for (let x = tx(b.w); x <= tx(b.e - 1e-9); x++)
    for (let y = ty(b.n); y <= ty(b.s + 1e-9); y++) {
      const url = template.replace("{z}", String(TILE_Z)).replace("{x}", String(x)).replace("{y}", String(y));
      jobs.push(
        (async () => {
          for (let attempt = 0; ; attempt++) {
            try {
              const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
              if (res.status === 204 || res.status === 404) return { x, y, tile: new VectorTile(new PbfReader(new Uint8Array(0))) }; // sea: nothing there
              if (!res.ok) throw new Error(`tile ${res.status}`);
              return { x, y, tile: new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer()))) };
            } catch (e) {
              if (attempt >= 2) throw e;
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        })(),
      );
    }
  const tiles = await Promise.all(jobs);

  const places: { kind: PlaceKind; name: string; lng: number; lat: number }[] = [];
  const stops: { kind: "bus"; name: string; lng: number; lat: number; park: boolean }[] = [];
  const inside = (lng: number, lat: number) => lng >= b.w && lng < b.e && lat >= b.s && lat < b.n;
  const seen = new Set<string>(); // a place near a tile's edge comes in both tiles
  for (const { x, y, tile } of tiles) {
    const poi = tile.layers.poi;
    for (let i = 0; i < (poi?.length ?? 0); i++) {
      const f = poi.feature(i);
      const p = f.properties as Record<string, string | number | boolean | undefined>;
      const kind = kindOfPoi(String(p.class ?? ""), String(p.subclass ?? ""));
      if (!kind) continue;
      const g = f.toGeoJSON(x, y, TILE_Z).geometry;
      if (g.type !== "Point") continue;
      const [lng, lat] = g.coordinates;
      if (!inside(lng, lat)) continue; // the next square has it
      const name = typeof p.name === "string" && p.name ? p.name : null;
      const key = `${kind}:${name}:${lng.toFixed(4)}:${lat.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (kind === "stop" || kind === "park") {
        const park = kind === "park";
        const near = stops.find((s) => metres({ lat: s.lat, lon: s.lng }, { lat, lon: lng }) < (park ? 80 : 30));
        if (near) near.park ||= park;
        else stops.push({ kind: "bus", name: name ?? (park ? "Bus station" : "Bus stop"), lng: +lng.toFixed(6), lat: +lat.toFixed(6), park });
      } else {
        places.push({ kind, name: name ?? POI_NAME[String(p.subclass)] ?? DEFAULT_NAME[kind], lng: +lng.toFixed(6), lat: +lat.toFixed(6) });
      }
    }
  }
  return { places, stops };
}

/**
 * The passenger train lines through a square (trains, metros, light rail), each brought in whole the first time it's
 * seen: its way (transit_lines) and its stations, each with how far along the line it is (transit_stops: what the
 * fare and the ride are worked out from, as for Nigeria's lines). The two directions of a line are one line (its
 * route_master). Returns how many stations came in.
 */
async function fillTrainLines(admin: SupabaseClient, ix: number, iy: number): Promise<number> {
  const b = boxOf(ix, iy);
  const found = await overpass(`[out:json][timeout:60];
rel["type"="route"]["route"~"^(train|subway|light_rail)$"](${b.s},${b.w},${b.n},${b.e})->.r;
.r out ids tags;
rel(br.r)["type"="route_master"];
out body;`);
  // One per line: a route_master's first direction, or a route on its own.
  const masterOf = new Map<number, number>();
  for (const m of found) if (m.tags?.type === "route_master") for (const mem of m.members ?? []) masterOf.set(mem.ref, m.id);
  const lines = new Map<string, Element>();
  for (const r of found) {
    if (r.tags?.type !== "route") continue;
    const id = `osm-${masterOf.get(r.id) ?? r.id}`;
    if (!lines.has(id)) lines.set(id, r);
  }
  if (!lines.size) return 0;
  const { data: known } = await admin.from("transit_lines").select("id").in("id", [...lines.keys()]);
  for (const k of known ?? []) lines.delete(k.id as string);

  let stations = 0;
  for (const [id, route] of [...lines].slice(0, LINES_PER_SQUARE)) {
    // With its track if that comes back soon; a very long line (2,000 km) as its stations only.
    let els: Element[];
    try {
      els = await overpass(`[out:json][timeout:45];rel(${route.id})->.r;.r out geom;node(r.r);out body;`, { rounds: 1, seconds: 50 });
    } catch {
      try {
        els = await overpass(`[out:json][timeout:60];rel(${route.id})->.r;.r out body;node(r.r);out body;`);
      } catch (e) {
        console.error(`train line ${route.id}:`, e); // the next square through it tries again
        continue;
      }
    }
    const rel = els.find((e) => e.type === "relation");
    if (!rel?.members) continue;
    const nodes = new Map(
      els.filter((e) => e.type === "node" && e.lat !== undefined && e.lon !== undefined).map((e) => [e.id, { lat: e.lat!, lon: e.lon!, name: e.tags?.name ?? null }]),
    );
    const line = buildLine(rel, nodes);
    if (!line) continue;
    const name = rel.tags?.name ?? rel.tags?.ref ?? "Train";
    const { error } = await admin.from("transit_lines").insert({ id, name: tidyLineName(name), colour: rel.tags?.colour ?? "#2F6FEB", path: line.path, length_m: line.length });
    if (error) continue; // brought in meanwhile by another square
    const { error: stopError } = await admin
      .from("transit_stops")
      .insert(line.stops.map((s) => ({ kind: "train", name: s.name, lng: s.lng, lat: s.lat, line_id: id, along_m: Math.round(s.along) })));
    if (stopError) throw stopError;
    stations += line.stops.length;
  }
  return stations;
}

/** "Caltrain: San Francisco => San Jose Diridon" → "Caltrain" (the line, not one direction of it). */
function tidyLineName(name: string) {
  return name.split(/:\s|\s(?:=>|->|→)\s/)[0].trim() || name;
}

/**
 * A route relation's way (joined up, thinned) and its stations along it, or null if it has fewer than two. `nodes`:
 * the member nodes' places and names. Without the track's ways (too big to fetch: a 2,000 km long-distance line),
 * the way is the stations joined in order.
 */
function buildLine(rel: Element, nodes: Map<number, { lat: number; lon: number; name: string | null }>) {
  // The stations: the stop positions on the track (else the platforms), in the line's order.
  const stopRole = (m: Member) => /^stop/.test(m.role);
  const members = (rel.members ?? []).filter((m) => m.type === "node" && (m.lat !== undefined || nodes.has(m.ref)));
  const chosen = (members.some(stopRole) ? members.filter(stopRole) : members.filter((m) => /^platform/.test(m.role))).map((m) => {
    const n = nodes.get(m.ref);
    return { ref: m.ref, lat: m.lat ?? n!.lat, lon: m.lon ?? n!.lon, name: n?.name ?? null };
  });

  // The track: its ways in order, each turned round to carry on from the last.
  const path: Point[] = [];
  let pieces = 0;
  for (const m of rel.members ?? []) {
    if (m.type !== "way" || !m.geometry?.length || /platform/.test(m.role)) continue;
    let g = m.geometry;
    if (pieces === 1) {
      // The first piece may run the other way: turn it round if the second meets its start.
      const near = (p: Point) => Math.min(metres(p, g[0]), metres(p, g[g.length - 1]));
      if (near(path[0]) < near(path[path.length - 1])) path.reverse();
    }
    if (pieces) {
      const end = path[path.length - 1];
      if (metres(end, g[g.length - 1]) < metres(end, g[0])) g = [...g].reverse();
      if (metres(end, g[0]) < 1) g = g.slice(1);
    }
    path.push(...g);
    pieces++;
  }
  if (path.length < 2) path.push(...chosen.map((c) => ({ lat: c.lat, lon: c.lon })));
  if (path.length < 2) return null;
  // Thinned to a point every ~150 m (at most 3,000), with the running distance.
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + metres(path[i - 1], path[i]));
  const length = cum[cum.length - 1];
  const step = Math.max(150, length / 3000);
  const kept: [number, number][] = [];
  let lastAt = -Infinity;
  path.forEach((p, i) => {
    if (cum[i] - lastAt >= step || i === path.length - 1) {
      kept.push([+p.lon.toFixed(6), +p.lat.toFixed(6)]);
      lastAt = cum[i];
    }
  });

  // Each station where it is along the track, named, one per place.
  const stops: { name: string; lng: number; lat: number; along: number }[] = [];
  for (const c of chosen) {
    let along = 0;
    let best = Infinity;
    path.forEach((p, i) => {
      const d = metres(p, c);
      if (d < best) [best, along] = [d, cum[i]];
    });
    if (best > 500) continue; // not on this track
    const name = c.name ?? `Stop ${stops.length + 1}`;
    if (stops.some((s) => s.name === name || Math.abs(s.along - along) < 80)) continue; // the same station twice
    stops.push({ name, lng: +c.lon.toFixed(6), lat: +c.lat.toFixed(6), along });
  }
  if (stops.length < 2) return null;
  return { path: kept, length: Math.round(length), stops };
}

/** The train lines of the squares around (lng, lat) already filled before lines came in too (27 Oct 2026). */
export async function fillTrainLinesAround(admin: SupabaseClient, lng: number, lat: number): Promise<number> {
  const { ix, iy } = cellOf(lng, lat);
  let stations = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      try {
        stations += await fillTrainLines(admin, ix + dx, iy + dy);
      } catch (e) {
        console.error(`train lines ${ix + dx}_${iy + dy}:`, e); // the service busy: the next square goes on
      }
    }
  return stations;
}

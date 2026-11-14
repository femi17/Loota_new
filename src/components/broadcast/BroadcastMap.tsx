"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { LootaLogo } from "@/components/Logo";
import { keeperLook, normalizeLook } from "@/lib/avatar";
import { daylight } from "@/game/clock";
import { WEATHER_CREDIT, weatherDim, weatherIcon, weatherWords, type Weather } from "@/game/weather";
import { ordinal } from "@/game/hunt";
import { baseSpeed, type Mode } from "@/game/movement";
import { TRAIN_CARS, alongPath, busZoom, cumulativeOf, trainAlong, trainZoom } from "@/game/transit";
import { foldAttribution } from "@/game/attribution";
import { nextAutoView } from "@/game/autocam";
import { OFFICER } from "@/components/game/RoadEventScene";
import { RoadGameBoard, gameSeconds, type RoadGame, type RoadGameLive, type RoadGameResult } from "@/components/game/RoadGames";
import { PuzzleBoard } from "@/components/game/puzzles/PuzzleTrial";
import { AnswerMirror } from "@/components/game/puzzles/mirror";
import { PUZZLE_NAMES } from "@/game/puzzles/names";
import type { InnerRoomView } from "@/game/house3d";
import { KeyWorldView, type KeyWorldData, type WorldTrack } from "./KeyWorldView";
import { jamLines } from "@/game/traffic";
import { loadSignals, signalState, signalsNear, type Signal } from "@/game/signals";
import { ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, roadCellOf, type RoadCellData, type RoadCellFile } from "@/game/roadData";

type Hunter = {
  id: string;
  name: string;
  look: unknown;
  keysHeld: number;
  place: number | null;
  lastKeyAt: string | null;
  lng: number | null;
  lat: number | null;
  mode: Mode | null;
  seenAt: string | null;
  inTrial: boolean;
  /** The vulcanizer walking back with them to change a flat (their name). */
  helper?: string | null;
  /** Resting (at a chill spot, or by the road): since when (cleared once they move on). */
  restingSince?: string | null;
  /** Their motorbike, car or bicycle left at the roadside: a flat, or out of fuel (13 Nov 2026), and since when. */
  parked?: { kind: "bicycle" | "motorbike" | "car"; lng: number; lat: number; why: "flat" | "fuel" | "left"; wheel: "off" | "fixed" | null; since: string | null } | null;
  /** The real weather where they are (their ~10 km square's, MET Norway). */
  weather?: Weather | null;
  /** The device they play on now (claim_session): positions from any other are ignored. */
  session?: string | null;
};
type Dome = { id: string; lng: number; lat: number; radiusM: number; endsAt: string; key: number; raisedBy: string | null; needed: number; attackers: number };
type ShowEvent = { at: string; kind: string; who: string | null; whoId: string | null; text: string };
/** A hunter's bus, train, taxi or plane under way: where it goes and when (its path thinned by the server). */
type Trip = { userId: string; mode: string; from: string; to: string; departsAt: string; arrivesAt: string; path: [number, number][] };
/** A hunter's hospital visit (call_ambulance): the ambulance's way to them and on to the hospital, and its times. */
type Visit = {
  userId: string;
  hospital: string;
  lng: number;
  lat: number;
  calledAt: string;
  pickedAt: string;
  arrivesAt: string;
  dischargedAt: string;
  approach: [number, number][] | null;
  route: [number, number][] | null;
};
type State = {
  hunt: { id: string; title: string; prize: string; winners: number; startsAt: string; endsAt: string; phase: string; keys: number };
  hunters: Hunter[];
  domes: Dome[];
  events: ShowEvent[];
  trips?: Trip[];
  visits?: Visit[];
  /** Hunters in a cell (the idling law): when they went in and come out (served or bailed), what was impounded. */
  /** Police chases (13 Nov 2026): the police's track ([ms, car, lng, lat, heading]) and what happened ([ms, what, detail]). */
  chases?: {
    userId: string;
    event: number;
    chaser: "officer" | "patrol";
    startedAt: string;
    endedAt: string | null;
    outcome: "caught" | "escaped" | "called_off" | null;
    level: number;
    track: [number, number, number, number, number][];
    notes: [number, string, string | number][];
  }[];
  jails?: {
    userId: string;
    at: string;
    lng: number;
    lat: number;
    station: string | null;
    stationLng: number | null;
    stationLat: number | null;
    route: [number, number][] | null;
    takenAt: string | null;
    arrivesAt: string | null;
    out: string | null;
    bailed: boolean;
    left: number;
    serving: boolean;
    vehicle: string | null;
    reason?: "idle" | "chase";
    stars?: number | null;
    parked?: string | null;
  }[];
  now?: string;
};
/** What the camera shows: the whole field, or one hunter up close. */
type View = { kind: "field" } | { kind: "follow"; id: string };

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const POLL_MS = 4000;
const LIVE_FRESH_MS = 15_000; // a live position newer than this beats the saved one
const BANNER_MS = 7000;
/** Auto camera: a minute on each hunter before moving on; the whole field for a moment between rounds. */
const DWELL_MS = 60_000;
const FIELD_MS = 15_000;

const eventKey = (e: ShowEvent) => `${e.at}|${e.text}`;
/** A box at a key's place, as the viewers know it: the chain's locks (1, 6, 7: owner, 12 Nov 2026), the other boxes. */
const boxLabel = (n: number) => (n === 1 ? "Lock 1 of 3" : n === 6 ? "Lock 2 of 3" : n === 7 ? "Lock 3 of 3" : `Box ${n}`);
const TRIP_ICON: Record<string, string> = { plane: "✈️", train: "🚆", bus: "🚌", taxi: "🚕" };
/** A route as drawn: longitudes kept continuous across the date line (a flight over the Pacific doesn't streak back). */
function unwrap(path: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [lng, lat] of path) {
    const prev = out[out.length - 1];
    let l = lng;
    if (prev) while (l - prev[0] > 180) l -= 360;
    if (prev) while (prev[0] - l > 180) l += 360;
    out.push([l, lat]);
  }
  return out;
}
const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const timeLeft = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};

/**
 * The live show's spectator screen (design doc 11): every hunter in a hunt on
 * the real map, the leaderboard, domes, and a ticker of what's happening.
 * Views: the whole field, or following one hunter (click a name); Auto jumps to
 * whoever just did something, otherwise rotates between the leaders. Key spots
 * are never shown: viewers may be players. Press H to hide the controls.
 */
const GAME_NAMES: Record<string, string> = { pairs: "Card match", cups: "Find the coin", chess: "Mate in one" };

/**
 * A board in the side panel, made smaller to fit when the screen is short (owner, 13 Nov 2026: "I played the card match
 * game, it has 3 rows, only 2 shows on the broadcast"): never cut off.
 */
function FitBox({ children, grow = 1 }: { children: React.ReactNode; /** As much bigger as it may be made to fill the space. */ grow?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const fit = () => setK(Math.min(grow, o.clientHeight / Math.max(1, i.scrollHeight), o.clientWidth / Math.max(1, i.scrollWidth)));
    const sized = new ResizeObserver(fit);
    sized.observe(o);
    sized.observe(i);
    fit();
    return () => sized.disconnect();
  }, [grow]);
  return (
    <div ref={outer} className="min-h-0 flex-1 overflow-hidden" data-fit={k.toFixed(2)}>
      <div ref={inner} className={grow > 1 ? "mx-auto w-fit" : undefined} style={{ transform: `scale(${k})`, transformOrigin: "top center" }}>
        {children}
      </div>
    </div>
  );
}

export function BroadcastMap({ huntId }: { huntId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State | null>(null);
  const [view, setView] = useState<View>({ kind: "field" });
  const [auto, setAuto] = useState(true);
  // Kept for this tab, so a reload onto a new build carries on with the same hunter followed (and the auto camera as it was)
  const viewKey = `loota:broadcast-view:${huntId}`;
  useEffect(() => {
    try {
      const kept = JSON.parse(sessionStorage.getItem(viewKey) ?? "null") as { view: View; auto: boolean } | null;
      if (kept?.view) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restored once, after the page has loaded
        setView(kept.view);
        setAuto(kept.auto);
      }
    } catch {
      // (nothing kept)
    }
  }, [viewKey]);
  useEffect(() => {
    try {
      sessionStorage.setItem(viewKey, JSON.stringify({ view, auto }));
    } catch {
      // (not kept: a reload starts on the field)
    }
  }, [viewKey, view, auto]);
  const [banner, setBanner] = useState<ShowEvent | null>(null);
  const [controls, setControls] = useState(true);
  // The leaderboard folds to its 🏆 button (folded to start with on a phone).
  const [board, setBoard] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  /** A scene the followed hunter is in: what it is, and what was last said (a TV caption). */
  /**
   * The question or game in the scene the followed hunter is in (owner, 9 Nov 2026: "lets see the puzzle, or question
   * asked by the police or strangers and see how the user plays it"): the replies on offer and the one picked, or the
   * game's board and how it ended.
   */
  const [sceneCard, setSceneCard] = useState<
    | { kind: "ask"; who: string; options: string[]; pick: string | null; question: string | null; asker: string }
    | { kind: "game"; who: string; game: RoadGame; result: RoadGameResult | null; live: RoadGameLive; left: number | null; total: number; shuffling: boolean }
    | { kind: "puzzle"; who: string; n: number; puzzleKind: string; puzzle: unknown; left: number; progress: number; result: { right?: boolean; late?: boolean; outcome?: string | null } | null; answers: Record<string, unknown> | null }
    | null
  >(null);
  /** The key's place the followed hunter is at (step 3): their own arrangement, played from their track. */
  const [keyWorld, setKeyWorld] = useState<{ id: number; data: KeyWorldData; look: unknown; playback: { current: { T: number; track: WorldTrack; inner: InnerRoomView[] | null; dug: string | null } } } | null>(null);
  /** Why the followed hunter is slow just now: 1 a red light, 2 slow traffic, 3 a go-slow (from their motion). */
  const [slowWhy, setSlowWhy] = useState(0);
  /** The followed hunter fainted: the ambulance coming, the ride to hospital, the ward (owner, 9 Nov 2026). */
  const [careNote, setCareNote] = useState<string | null>(null);
  /** A police chase, as it stands for the hunter followed: the stars, whether they're seen, how near, how it ended. */
  const [chaseShown, setChaseShown] = useState<{ who: string; stars: number; status: "seen" | "unseen" | "hiding" | "caught" | "escaped" | "called_off"; gap: number | null; hiding: string | null } | null>(null);
  /** The weather where the followed hunter is, drawn over the picture (owner, 9 Nov 2026). */
  const [weatherShown, setWeatherShown] = useState<(Weather & { who: string; night: boolean; slowed: boolean }) | null>(null);
  const [caption, setCaption] = useState<{ icon: string; title: string; lines: { who: string; text: string; you: boolean }[] } | null>(null);
  // A newer build live (owner, 13 Nov 2026: "I do not need to always refresh for it to pickup events from the user"): an
  // open broadcast keeps the code it was opened with, so it reloads itself onto the new one (it picks up where it was)
  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
    if (mine === "dev") return;
    const t = window.setInterval(() => {
      void fetch("/api/version", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ build?: string }>) : null))
        .then((v) => {
          if (v?.build && v.build !== "dev" && v.build !== mine) window.location.reload();
        })
        .catch(() => undefined);
    }, 90_000);
    return () => window.clearInterval(t);
  }, []);
  // The caption's height: the side panel (a puzzle, a game) ends above it, never over it
  const captionBox = useRef<HTMLDivElement>(null);
  const [captionH, setCaptionH] = useState(90);
  const hasCaption = caption ? (sceneCard?.kind === "ask" ? "ask" : "caption") : ""; // (whichever box is at the bottom)
  useEffect(() => {
    const el = captionBox.current;
    if (!el) return;
    const sized = new ResizeObserver(() => setCaptionH(el.offsetHeight));
    sized.observe(el);
    return () => sized.disconnect();
  }, [hasCaption]);
  const viewRef = useRef(view);
  const autoRef = useRef(auto);
  useEffect(() => {
    viewRef.current = view;
    autoRef.current = auto;
  });

  // A ticking clock for countdowns and "2 min ago".
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  // H hides the controls, for a clean capture.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "H") setControls((c) => !c);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const [{ Map: MapLibre, setWorkerUrl, LngLatBounds, Marker }, models, { ThreeMapLayer }, { createClient }, { styleMapForGame }, geo, follow, roads] = await Promise.all([
        import("maplibre-gl"),
        import("@/game/models3d"),
        import("@/game/ThreeMapLayer"),
        import("@/lib/supabase/client"),
        import("@/game/mapStyle"),
        import("@/game/geo"),
        import("@/game/follow"),
        import("@/game/roads"),
      ]);
      if (disposed || !container.current) return;
      if (window.innerWidth < 640) setBoard(false);
      setWorkerUrl("/maplibre-gl-worker.mjs");
      const supabase = createClient();
      const map = new MapLibre({
        container: container.current,
        style: MAP_STYLE,
        center: [3.38, 6.52],
        zoom: 11,
        pitch: 45,
        attributionControl: { compact: true, customAttribution: WEATHER_CREDIT },
      });
      foldAttribution(map);

      // ---- The map ahead, fetched before the camera gets there (owner, 14 Nov 2026: "The map sometimes on the broadcast
      // takes time to load, it will just look the avatar is travelling on a plain"). A tile the map hasn't got takes a
      // second or so to come (more on a slow line), and a hunter on a motorbike crosses one in a few seconds on the game's
      // clock: so the tiles on the way (along their bus, train or plane's route; else ahead of them the way they're going)
      // and round every hunter (to switch to any of them) are fetched beforehand, quietly, a few at a time. The tile server
      // lets them be kept for years, so the map then has them straight from the browser's cache.
      let tileUrl: string | null = null;
      map.once("load", () => {
        const src = map.getSource("openmaptiles") as { tiles?: string[] } | undefined;
        tileUrl = src?.tiles?.[0] ?? null;
      });
      const fetchedTiles = new Set<string>();
      const tileQueue: string[] = [];
      let tilesInFlight = 0;
      const tileOf = (lng: number, lat: number, z: number) => {
        const n = 2 ** z;
        const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
        return { x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
      };
      /** The tiles at zoom z under these spots (and `ring` tiles round each), queued to fetch; the first wanted first. */
      const wantTiles = (spots: [number, number][], z: number, ring = 0, first = false) => {
        const add: string[] = [];
        for (const [lng, lat] of spots) {
          const { x, y } = tileOf(lng, lat, z);
          for (let dx = -ring; dx <= ring; dx++)
            for (let dy = -ring; dy <= ring; dy++) {
              const key = `${z}/${x + dx}/${y + dy}`;
              if (fetchedTiles.has(key) || tileQueue.includes(key) || add.includes(key)) continue;
              add.push(key);
            }
        }
        if (first) tileQueue.unshift(...add);
        else tileQueue.push(...add);
        if (tileQueue.length > 400) tileQueue.length = 400;
        pumpTiles();
      };
      const pumpTiles = () => {
        while (tileUrl && tilesInFlight < 4 && tileQueue.length) {
          const key = tileQueue.shift()!;
          if (fetchedTiles.has(key)) continue;
          fetchedTiles.add(key);
          if (fetchedTiles.size > 5000) fetchedTiles.clear();
          const [z, x, y] = key.split("/");
          tilesInFlight++;
          void fetch(tileUrl.replace("{z}", z).replace("{x}", x).replace("{y}", y))
            .then((r) => r.arrayBuffer())
            .catch(() => fetchedTiles.delete(key)) // (tried again when next wanted)
            .finally(() => {
              tilesInFlight--;
              pumpTiles();
            });
        }
      };
      let prefetchAt = 0;
      let prefetchAllAt = 0;
      let prefetchLast: { lng: number; lat: number; at: number; v: number } | null = null;
      /** The tiles on the followed hunter's way, and (every 10 s) round every hunter. */
      const prefetch = (now: number, p: { lng: number; lat: number; heading: number } | null, r: { trip: Trip; path: [number, number][]; cum: number[] } | null) => {
        if (!tileUrl || now - prefetchAt < 1500) return;
        prefetchAt = now;
        if (p) {
          if (r && r.path.length > 1) {
            // On a bus, train or plane: along its route from where it is now (a plane's from high up too, as it's shown)
            let near = 0, best = Infinity;
            for (let i = 0; i < r.path.length; i++) {
              const d = geo.distanceM(r.path[i], [p.lng, p.lat]);
              if (d < best) [best, near] = [d, i];
            }
            const reach = r.trip.mode === "plane" ? Infinity : 30_000;
            const ahead: [number, number][] = [];
            for (let i = near; i < r.path.length && r.cum[i] - r.cum[near] <= reach; i++) ahead.push(r.path[i]);
            // between the route's points (it's thinned): every ~1 km, so no tile along it is missed
            const along: [number, number][] = [];
            for (let i = 0; i < ahead.length; i++) {
              along.push(ahead[i]);
              const b = ahead[i + 1];
              if (!b) break;
              const steps = Math.floor(geo.distanceM(ahead[i], b) / 1000);
              for (let k = 1; k <= steps; k++) along.push([ahead[i][0] + ((b[0] - ahead[i][0]) * k) / (steps + 1), ahead[i][1] + ((b[1] - ahead[i][1]) * k) / (steps + 1)]);
            }
            if (r.trip.mode === "plane") {
              wantTiles(along, 10, 1, true);
              wantTiles([r.path[r.path.length - 1]], 14, 1); // where it lands
            } else wantTiles(along, 14, 1, true);
          } else {
            // On the road: round them, and ahead the way they're going, as far as their speed takes them in a minute
            const v = prefetchLast ? geo.distanceM([prefetchLast.lng, prefetchLast.lat], [p.lng, p.lat]) / Math.max(0.5, (now - prefetchLast.at) / 1000) : 0;
            const speed = prefetchLast ? prefetchLast.v * 0.6 + Math.min(300, v) * 0.4 : 0;
            prefetchLast = { lng: p.lng, lat: p.lat, at: now, v: speed };
            const reach = Math.max(1500, speed * 60);
            const spots: [number, number][] = [[p.lng, p.lat]];
            for (let m = 700; m <= reach; m += 700)
              spots.push([p.lng + (Math.sin(p.heading) * m) / (111320 * Math.cos((p.lat * Math.PI) / 180)), p.lat + (Math.cos(p.heading) * m) / 110574]);
            wantTiles(spots, 14, 1, true);
          }
        }
        if (now - prefetchAllAt > 10_000 && latest) {
          prefetchAllAt = now;
          const all = latest.hunters.filter((h) => h.lng != null && h.lat != null).slice(0, 30).map((h) => [h.lng!, h.lat!] as [number, number]);
          wantTiles(all, 14, 1);
        }
      };

      // ---- Where each hunter is: live updates if fresh, otherwise their last saved spot.
      let latest: State | null = null;
      const live = new Map<string, { lng: number; lat: number; mode: Mode; at: number }>();
      const shown = new Map<string, { lng: number; lat: number; heading: number }>();
      // Every position heard, per hunter, joined to the one before along the roads, and the hunter drawn gliding along
      // that way (owner, 8 Nov 2026: "In an attempt for the avatar to catch up with the users avatar. They travel along a
      // path, and is not the path, like crossing roads or walking on buildings"): src/game/follow.ts. Before, they glided
      // in straight lines between positions (and guessed ahead in a straight line), cutting across blocks at every corner
      // and whenever they caught up after a gap.
      const follows = new Map<string, import("@/game/follow").Follow>();
      // The roads around each hunter, from the map's own tiles (the same roads the game uses abroad), built again when
      // they've moved on; only for hunters on or near the screen (the others aren't seen), one build a frame at most.
      const nets = new Map<string, { net: import("@/game/roads").RoadNetwork; centre: { lng: number; lat: number }; mode: Mode; at: number }>();
      let builtThisFrame = false;
      const netFor = (id: string, pos: { lng: number; lat: number }): import("@/game/roads").RoadNetwork | null => {
        const mode = (live.get(id)?.mode ?? latest?.hunters.find((h) => h.id === id)?.mode ?? "walk") as Mode;
        const known = nets.get(id);
        const fresh = known && known.mode === mode && geo.distanceM([known.centre.lng, known.centre.lat], [pos.lng, pos.lat]) < 350 && performance.now() - known.at < 20_000;
        if (fresh) return known.net;
        const view = map.getBounds();
        const pad = 0.01;
        const onScreen = pos.lng > view.getWest() - pad && pos.lng < view.getEast() + pad && pos.lat > view.getSouth() - pad && pos.lat < view.getNorth() + pad;
        if (builtThisFrame || !onScreen || map.getZoom() < 14) return known?.net ?? null;
        const features = map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" }) as import("@/game/roads").RoadFeature[];
        if (!features.length) return known?.net ?? null;
        builtThisFrame = true;
        const net = roads.buildNetwork(features, mode, pos, 700);
        nets.set(id, { net, centre: { ...pos }, mode, at: performance.now() });
        return net;
      };
      // Motion (owner, 9 Nov 2026: "If a user picks a end location, we store that, and then travel there on the broadcast,
      // it is the action of the user on the frontend we use… It should have a smooth movement for viewers"; "make sure this
      // is not eating the supabase realtime usage"). Each hunter's game saves the way they go along (once) and motion
      // keyframes (when, by the server's clock; how far along it; the speed) only when their speed changes and every 10 s.
      // Read here by a light poll (no Realtime) and played motionDelay behind, like live TV: by then the keyframes on
      // either side are already here, so they glide between them, exactly where they were, never corrected. Hunters
      // without a way (standing, the key's place): their saved spots, along the roads (follow.ts).
      // How far behind (owner, 9 Nov 2026: "the small deley on the broadcast, is there a way we can fasten it"): measured,
      // not guessed. Each keyframe and each point of a key's-place track is timed as it arrives here (by the server's
      // clock, less when it happened); played just far enough behind for even the latest of the last hundred to have been
      // here in time (and the smoothing's quarter second, and a little to spare), 2.5 to 6 s: smooth before quick (one
      // arriving after its moment is a halt on screen). It starts at 6 s and glides there: the clock runs a tenth fast to
      // catch up, or up to a quarter slow when the network gets worse; never a jump.
      const DELAY_MIN_MS = 2500;
      const DELAY_MAX_MS = 6000;
      let motionDelay = DELAY_MAX_MS;
      let delayGoal = DELAY_MAX_MS;
      const lateness: number[] = []; // the last 100 arrivals: how long after they happened (ms)
      const newestKey = new Map<string, number>(); // by hunter: the latest keyframe already timed
      const newestTrack = new Map<number, number>(); // by scene: the latest track point already timed
      const timed = (late: number) => {
        lateness.push(late);
        if (lateness.length > 100) lateness.shift();
        if (lateness.length < 12) return;
        delayGoal = Math.max(DELAY_MIN_MS, Math.min(DELAY_MAX_MS, Math.max(...lateness) + 400));
      };
      const MOTION_POLL_MS = 1000;
      type Key = [number, number, number, number?]; // [server ms, metres along, m/s, why slow: 1 a red light, 2 slow traffic, 3 a go-slow]
      const motions = new Map<string, { way: number; keys: Key[]; ended: boolean; drawnS: number | null; heading: number }>();
      const ways = new Map<string, { id: number; pts: [number, number][]; cum: number[] }>();
      const wayAsked = new Set<string>();
      // The server's ms − this page's ms: from the quickest of the first replies, then only nudged (2 ms a reply), so the
      // playback never jumps
      let motionSkew: number | null = null;
      let motionRtt = Infinity;
      let motionReplies = 0;
      // Scenes (owner, 9 Nov 2026: step 2): each scene a hunter goes into, as their game saved it (how it's built, where,
      // when, what's said), played at the same moment as their motion: the same place built at the kerb, the keeper and
      // the hunter in it, the camera looking in as on their screen, the words as captions.
      type SceneData = {
        kind: string;
        model?: { make: string; args: unknown[] }; // none at a key's place (its own arrangement is in the data)
        origin: { lng: number; lat: number };
        facing: number;
        spots: { depth: number; keeper: { x: number; z: number }; customer: { x: number; z: number } };
        keeper: { look: unknown; at: { x: number; z: number } };
        you: { from: { x: number; z: number }; to: { x: number; z: number }; lying?: boolean };
        title?: string;
        keeperName?: string;
      };
      // Lines: [ms, "them" | "you", what's said], and how it's played: "ask" (the replies on offer, JSON), "pick", "game",
      // "move", "result" (JSON)
      type Scene = { id: number; user: string; start: number; end: number | null; data: SceneData; lines: [number, string, string][]; track?: WorldTrack };
      const scenes = new Map<number, Scene>();
      /** The scene a hunter is in at server time `T`, if any. */
      const sceneAt = (user: string, T: number) => {
        let best: Scene | null = null;
        for (const sc of scenes.values()) if (sc.user === user && sc.start <= T && (sc.end === null || T < sc.end) && (!best || sc.start > best.start)) best = sc;
        return best;
      };
      /** What a scene is, as an icon and a few words. */
      const sceneLabel = (sc: Scene): { icon: string; what: string } => {
        if (sc.data.kind === "keyworld") return { icon: "🗝", what: "searching the key's place" };
        const m = sc.data.model?.make ?? "";
        if (m === "makeCheckpointScene") return { icon: "🚓", what: "at a police checkpoint" };
        if (m === "makeTravellerScene") return { icon: "🧳", what: "with a stranded traveller" };
        if (m === "makeGameTable") return { icon: "🎲", what: "playing a roadside game" };
        if (m === "makeStallScene") return { icon: "🛒", what: "at a roadside stall" };
        if (m === "makeOpenBuka") return { icon: "🍲", what: "eating at a buka" };
        if (m === "makeOpenPetrol") return { icon: "⛽", what: "at the petrol station" };
        if (m === "makeVulcanizer" || m === "makeFlatScene") return { icon: "🛞", what: "fixing a tyre" };
        if (m === "makeOpenShop") return { icon: "🔧", what: "at the mechanic" };
        if (m === "makeOpenWard" || m === "makeRoadsideCare") return { icon: "🏥", what: "being treated" };
        if (m === "makeHireStand") return { icon: "🚲", what: "hiring a ride" };
        if (m === "makeTicketHall") return { icon: "🎫", what: "buying a ticket" };
        if (m === "makeTerminal") return { icon: "🛫", what: "checking in" };
        if (m === "makeKeyScene") return { icon: "🗝", what: "at the Key Trial" };
        if (m === "makeLandmarkPlaza") return { icon: "🏛", what: "checking in at a landmark" };
        if (m === "makeLampShrine") return { icon: "🪔", what: "at the Lamp's spot" };
        if (m === "makeDjinnVault") return { icon: "🧞", what: "in the Djinn's chamber" };
        return { icon: "💬", what: "in a scene" };
      };
      const SCENE_SCALE = 1.7, SCENE_ZOOM = 19.3, SCENE_PITCH = 48; // as the game's (GameMap)
      let sceneView: {
        id: number;
        entity: import("@/game/ThreeMapLayer").MapEntity;
        you: ReturnType<typeof models.buildAvatar>;
        keeper: ReturnType<typeof models.buildAvatar>;
      } | null = null;
      const dropSceneView = () => {
        if (sceneView) layer.remove(sceneView.entity);
        sceneView = null;
      };
      let captionKey = "";
      let cardKey = "";
      let gameStaged = false; // a roadside game on the stage (last frame)
      let stagePad = 0; // the camera's room for it on the right, eased
      let worldShown: { id: number; playback: { current: { T: number; track: WorldTrack; inner: InnerRoomView[] | null; dug: string | null } } } | null = null;
      const parse = <X,>(text: string): X | null => {
        try {
          return JSON.parse(text) as X;
        } catch {
          return null;
        }
      };

      // ---- Why they slow down (owner, 9 Nov 2026: "add the traffic light, the traffic, so viewers can know the reason the
      // slows down is because of the traffic or traffic light"). Around the hunter followed: the real traffic lights in 3D
      // at the kerb, coloured as they were at the moment shown (the same cycle for everyone: src/game/signals.ts), and the
      // jammed stretches of road as their own map draws them (our road data, src/game/traffic.ts); and the reason, from
      // their motion's keyframes, as a chip.
      let allSignals: Signal[] = [];
      void loadSignals().then((list) => (allSignals = list));
      const lightModels = new Map<number, { entity: import("@/game/ThreeMapLayer").MapEntity; model: ReturnType<typeof models.makeTrafficLight> }>();
      let lightsFrom: { lng: number; lat: number } | null = null;
      let lightsNear: Signal[] = [];
      const ROADS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}`;
      const roadCells = new Map<string, RoadCellData | "loading" | "none">();
      async function loadCell(key: string) {
        roadCells.set(key, "loading");
        try {
          const res = await fetch(`${ROADS_URL}/${key}.json.gz`);
          if (!res.ok || !res.body) throw new Error(String(res.status));
          roadCells.set(key, decodeRoadCell((await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).json()) as RoadCellFile));
        } catch {
          roadCells.set(key, "none");
        }
      }
      /** Our road squares within 2.5 km of a spot (loading those not here yet). */
      function cellsAround(at: { lng: number; lat: number }) {
        const dLat = 2500 / 110574, dLng = 2500 / (111320 * Math.cos((at.lat * Math.PI) / 180));
        const a = roadCellOf(at.lng - dLng, at.lat - dLat), b = roadCellOf(at.lng + dLng, at.lat + dLat);
        const out: RoadCellData[] = [];
        for (let ix = a.ix; ix <= b.ix; ix++) {
          for (let iy = a.iy; iy <= b.iy; iy++) {
            const key = roadCellKey(ix, iy);
            const c = roadCells.get(key);
            if (c === undefined) void loadCell(key);
            else if (typeof c === "object") out.push(c);
          }
        }
        return out;
      }
      /** A light beside the road, facing along it (its spot is in the junction). */
      function kerbOf(sg: Signal, net: import("@/game/roads").RoadNetwork | null) {
        const rp = net ? roads.snapToNetwork(net, sg, 0) : null;
        const p = net && rp ? roads.positionOf(net, rp) : null;
        if (!p || geo.distanceM([p.lng, p.lat], [sg.lng, sg.lat]) > 25) return { lng: sg.lng, lat: sg.lat, heading: 0 };
        const m = 5 * layer.enlargement(); // to the right of the way the road runs (east = sin, north = −cos)
        const east = -Math.cos(p.heading) * m, north = -Math.sin(p.heading) * m;
        return { lng: p.lng + east / (111320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat + north / 110574, heading: p.heading };
      }
      let lastJams = -Infinity;
      function trafficTick(t: number, T: number, at: { lng: number; lat: number }, net: import("@/game/roads").RoadNetwork | null) {
        if (!lightsFrom || geo.distanceM([lightsFrom.lng, lightsFrom.lat], [at.lng, at.lat]) > 100) {
          lightsFrom = { ...at };
          lightsNear = signalsNear(allSignals, at, 700);
          const keep = new Set(lightsNear.map((sg) => sg.id));
          for (const [id, l] of lightModels) {
            if (keep.has(id)) continue;
            layer.remove(l.entity);
            lightModels.delete(id);
          }
        }
        for (const sg of lightsNear) {
          let l = lightModels.get(sg.id);
          if (!l) {
            if (!net) continue; // once the roads are known, to stand at the kerb
            const k = kerbOf(sg, net);
            const model = models.makeTrafficLight();
            l = { entity: layer.add({ object: model.group, lng: k.lng, lat: k.lat, heading: k.heading }), model };
            lightModels.set(sg.id, l);
          }
          l.model.show(signalState(sg.group, T).light);
        }
        if (t - lastJams > 2000) {
          lastJams = t;
          (map.getSource("b-traffic") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: jamLines(cellsAround(at), at, T, 2500) });
        }
      }
      function clearTraffic() {
        if (!lightModels.size && !lightsFrom) return;
        for (const l of lightModels.values()) layer.remove(l.entity);
        lightModels.clear();
        lightsFrom = null;
        lastJams = -Infinity;
        (map.getSource("b-traffic") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
      }
      /** Why a hunter is slow at server time `T`: the reason on the keyframe in force then (0 none). */
      const whySlow = (id: string, T: number) => {
        const mo = motions.get(id);
        if (!mo) return 0;
        let why = 0;
        for (const k of mo.keys) {
          if (k[0] > T) break;
          why = k[3] ?? 0;
        }
        return why;
      };
      let lastWhy = 0;
      async function pollMotion() {
        const t0 = Date.now();
        const { data } = await supabase.rpc("broadcast_motion", { p_hunt: huntId });
        const t1 = Date.now();
        const r = data as { now: number; hunters: { id: string; way: number; keys: Key[]; mode: Mode }[]; scenes?: Scene[] } | null;
        if (disposed || !r) return;
        const sample = r.now - (t0 + t1) / 2;
        motionReplies++;
        if (motionSkew === null || (motionReplies <= 5 && t1 - t0 < motionRtt)) motionSkew = sample;
        else if (t1 - t0 < motionRtt * 1.5) motionSkew += Math.max(-2, Math.min(2, sample - motionSkew));
        motionRtt = Math.min(motionRtt, t1 - t0);
        const arrived = t1 + motionSkew;
        const seen = new Set<string>();
        for (const m of r.hunters) {
          seen.add(m.id);
          const newest = m.keys.length ? m.keys[m.keys.length - 1][0] : null;
          const before = newestKey.get(m.id);
          if (before !== undefined) for (const k of m.keys) if (k[0] > before) timed(arrived - k[0]);
          if (newest !== null && (before === undefined || newest > before)) newestKey.set(m.id, newest);
          const known = motions.get(m.id);
          if (!known || known.way !== m.way) motions.set(m.id, { way: m.way, keys: m.keys, ended: false, drawnS: null, heading: known?.heading ?? 0 });
          else Object.assign(known, { keys: m.keys, ended: false });
          if (ways.get(m.id)?.id !== m.way && !wayAsked.has(`${m.id}:${m.way}`)) {
            wayAsked.add(`${m.id}:${m.way}`);
            void supabase.rpc("broadcast_way", { p_hunt: huntId, p_user: m.id }).then(({ data: w }) => {
              const way = w as { way: number; pts: [number, number][] } | null;
              if (!disposed && way?.pts && way.pts.length > 1) ways.set(m.id, { id: way.way, pts: way.pts, cum: cumulativeOf(way.pts) });
            });
          }
        }
        // A way done: played on to its end (it's a few seconds behind), then let go
        for (const [id, m] of motions) if (!seen.has(id)) m.ended = true;
        for (const sc of r.scenes ?? []) {
          scenes.set(sc.id, sc);
          const track = sc.track ?? [];
          if (!track.length) continue;
          const before = newestTrack.get(sc.id);
          if (before !== undefined) for (const p of track) if (p[0] > before) timed(arrived - p[0]);
          newestTrack.set(sc.id, Math.max(before ?? -Infinity, track[track.length - 1][0]));
        }
        const listed = new Set((r.scenes ?? []).map((sc) => sc.id));
        for (const id of [...scenes.keys()]) if (!listed.has(id)) scenes.delete(id);
      }
      void pollMotion();
      const motionTimer = window.setInterval(() => void pollMotion(), MOTION_POLL_MS);
      /**
       * Where a hunter is along their way at server time `T` (metres), and their speed then (m/s): between the keyframes
       * either side; beyond the last, on at its speed (the hunter's game saves a new one before that's a metre out).
       */
      const alongAt = (keys: Key[], T: number): { s: number; v: number } | null => {
        if (!keys.length) return null;
        if (T <= keys[0][0]) return { s: keys[0][1], v: 0 };
        const i = keys.findIndex((k) => k[0] >= T);
        if (i === -1) {
          const last = keys[keys.length - 1];
          const on = Math.min(12, (T - last[0]) / 1000);
          return { s: last[1] + last[2] * on, v: on < 12 ? last[2] : 0 };
        }
        const a = keys[i - 1], b = keys[i];
        const v = (b[1] - a[1]) / Math.max(0.001, (b[0] - a[0]) / 1000);
        return { s: a[1] + (v * (T - a[0])) / 1000, v };
      };
      const heard = (id: string, lng: number, lat: number) => {
        const at = { lng, lat };
        follows.set(id, follow.heard(follows.get(id) ?? null, at, performance.now(), netFor(id, at)));
      };
      // For the browser tests (in development only): where each hunter is drawn now, and the map (to read its roads).
      if (process.env.NODE_ENV !== "production") {
        Object.assign(window, { __broadcastShown: () => ({ ...Object.fromEntries(shown), drawnAt, drawnWall, trips: [...routes.keys()], moving: [...motions.keys()], zoom: map.getZoom(), delay: motionDelay, delayGoal, timed: lateness.length, lateness: [...lateness], scene: sceneView ? { id: sceneView.id, scale: sceneView.entity.scaleBy } : null, keyWorld: worldShown?.id ?? null, care: careKey || null, careVan: careVan ? { lng: careVan.entity.lng, lat: careVan.entity.lat } : null, trainCars: (followed?.id.endsWith(":train") ? [{ lng: followed.entity.lng, lat: followed.entity.lat }] : []).concat(trainCars.map((c) => ({ lng: c.lng, lat: c.lat }))), jailCell: jailCell ? { lng: jailCell.entity.lng, lat: jailCell.entity.lat } : null, policeCar: policeCar ? { lng: policeCar.entity.lng, lat: policeCar.entity.lat } : null, followedKind: followed?.id ?? null, weather: weatherKey || null, night: nightNow, helper: helperWalker ? { name: helperWalker.name, lng: helperWalker.entity.lng, lat: helperWalker.entity.lat } : null, parked: parkedCar ? { key: parkedCar.key, lng: parkedCar.entity.lng, lat: parkedCar.entity.lat } : null, tiles: fetchedTiles.size, tilesQueued: tileQueue.length, restBike: !!restBike, seat: seat ? { ...seat.at } : null, slowWhy: lastWhy, lights: [...lightModels.keys()].length, scenes: [...scenes.values()].map((sc) => ({ id: sc.id, start: sc.start, end: sc.end, lines: sc.lines.length, title: sc.data.title ?? null })), T: motionSkew !== null ? drawnWall + motionSkew - motionDelay : null }), __broadcastMap: map });
      }
      let drawnAt = 0; // the last frame's time
      let drawnWall = Date.now(); // …by the wall clock
      // Trips under way, by hunter: the route (continuous) and its length along the way, measured once.
      let skew = 0; // the server's clock minus this one
      const routes = new Map<string, { key: string; trip: Trip; path: [number, number][]; cum: number[] }>();
      const tripOf = (id: string) => routes.get(id) ?? null;
      /** How far along a path a point is (the nearest place on it). */
      const alongOn = (path: [number, number][], cum: number[], p: { lng: number; lat: number }) => {
        const k = Math.cos((p.lat * Math.PI) / 180);
        let best = { d: Infinity, s: 0 };
        for (let i = 1; i < path.length; i++) {
          const ax = (path[i - 1][0] - p.lng) * k, ay = path[i - 1][1] - p.lat, bx = (path[i][0] - p.lng) * k, by = path[i][1] - p.lat;
          const dx = bx - ax, dy = by - ay;
          const q = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-18)));
          const d = Math.hypot(ax + dx * q, ay + dy * q);
          if (d < best.d) best = { d, s: cum[i - 1] + q * (cum[i] - cum[i - 1]) };
        }
        return best.s;
      };
      // A train's other carriages, behind the first on the track (owner, 13 Nov 2026: "Train on broadcast is just one
      // coach, on user screen 3"), each lined up with the track under it, as their own screen draws them
      const trainCars: import("@/game/ThreeMapLayer").MapEntity[] = [];
      const dropTrainCars = () => {
        for (const car of trainCars.splice(0)) layer.remove(car);
      };
      /** Where a trip is now, by the clock: at the start before it leaves, along the route, at the end once there. */
      const tripAt = (r: { trip: Trip; path: [number, number][]; cum: number[] }, now: number) => {
        const dep = Date.parse(r.trip.departsAt), arr = Date.parse(r.trip.arrivesAt);
        const f = now <= dep ? 0 : now >= arr ? 1 : (now - dep) / Math.max(1, arr - dep);
        const total = r.cum[r.cum.length - 1] ?? 0;
        // A train pulls away and brakes into the station, as the game draws it (owner, 8 Nov 2026).
        const { pos, segment } = alongPath(r.path, r.cum, (r.trip.mode === "train" ? trainAlong(f) : f) * total);
        const a = r.path[Math.max(0, segment - 1)], b = r.path[Math.min(r.path.length - 1, Math.max(1, segment))];
        return { lng: pos[0], lat: pos[1], heading: a && b && (a[0] !== b[0] || a[1] !== b[1]) ? geo.headingOf(a, b) : 0, f, flying: f > 0 && f < 1 };
      };
      // ---- Fainted (owner, 9 Nov 2026: "fix the ambulance pickup, it is not showing, user had to walk to hospital"): the
      // visit played by the clock as the game plays it: lying where they fell while the ambulance drives up its way; then
      // in the ambulance along the road to the hospital; then inside, the ambulance parked, until discharged.
      type Way = { path: [number, number][]; cum: number[] };
      const visits = new Map<string, { key: string; v: Visit; approach: Way | null; route: Way | null }>();
      type Care = { phase: "waiting" | "riding" | "treated"; lng: number; lat: number; heading: number | null; van: { lng: number; lat: number; heading: number } | null; ward: boolean; hospital: string };
      const onWay = (w: Way, f: number) => {
        const total = w.cum[w.cum.length - 1] ?? 0;
        const { pos, segment } = alongPath(w.path, w.cum, Math.max(0, Math.min(1, f)) * total);
        const a = w.path[Math.max(0, segment - 1)], b = w.path[Math.min(w.path.length - 1, Math.max(1, segment))];
        return { lng: pos[0], lat: pos[1], heading: a && b && (a[0] !== b[0] || a[1] !== b[1]) ? geo.headingOf(a, b) : 0 };
      };
      const careAt = (id: string, T: number): Care | null => {
        const c = visits.get(id);
        if (!c) return null;
        const called = Date.parse(c.v.calledAt), picked = Date.parse(c.v.pickedAt), arrives = Date.parse(c.v.arrivesAt), discharged = Date.parse(c.v.dischargedAt);
        if (T < called || T >= discharged) return null;
        if (tripOf(id)) return null; // on a bus, train or plane (fainting is on foot or a bicycle): the trip
        const ward = !!c.route;
        const fell = c.route ? { lng: c.route.path[0][0], lat: c.route.path[0][1] } : { lng: c.v.lng, lat: c.v.lat };
        if (T < picked) return { phase: "waiting", ...fell, heading: null, van: c.approach ? onWay(c.approach, (T - called) / Math.max(1, picked - called)) : null, ward, hospital: c.v.hospital };
        if (c.route && T < arrives) {
          const at = onWay(c.route, (T - picked) / Math.max(1, arrives - picked));
          return { phase: "riding", ...at, van: at, ward, hospital: c.v.hospital };
        }
        const parked = c.route ? onWay(c.route, 1) : null;
        return { phase: "treated", ...(parked ?? fell), heading: parked?.heading ?? null, van: parked, ward, hospital: c.v.hospital };
      };
      let careT = 0; // this frame's moment for visits (the server's clock, motionDelay behind)
      // Arrested (the idling law, owner, 12 Nov 2026: "The lockup should happen on the broadcast page too… They should be
      // driving to the police station. That is where the lock up should happen"): by the same clock, the patrol car along
      // the road to the station, then the cell there until they're out (served, or bailed). The time left counts only
      // while they're playing.
      type Jail = {
        at: number;
        spot: { lng: number; lat: number };
        station: string | null;
        stationAt: { lng: number; lat: number } | null;
        way: { path: [number, number][]; cum: number[] } | null;
        taken: number | null;
        arrives: number | null;
        out: number | null;
        left: number;
        serving: boolean;
        vehicle: string | null;
        reason: "idle" | "chase";
        stars: number | null;
        parked: string | null;
      };
      const jails = new Map<string, Jail>();
      const jailAt = (id: string, T: number) => {
        const j = jails.get(id);
        return j && T >= j.at && (j.out === null || T < j.out) ? j : null;
      };
      /** Where an arrest has them at T: arrested where they were, in the patrol car on the way, or in the cell. */
      const jailPlace = (j: Jail, T: number): { phase: "arrested" | "riding" | "cell"; lng: number; lat: number; heading: number | null } => {
        if (j.taken === null || j.arrives === null || T < j.taken) return { phase: "arrested", ...j.spot, heading: null };
        if (T < j.arrives && j.way) {
          const total = j.way.cum[j.way.cum.length - 1];
          const { pos, segment } = alongPath(j.way.path, j.way.cum, ((T - j.taken) / Math.max(1, j.arrives - j.taken)) * total);
          return { phase: "riding", lng: pos[0], lat: pos[1], heading: geo.headingOf(j.way.path[Math.max(0, segment - 1)], j.way.path[Math.max(1, segment)]) };
        }
        return { phase: "cell", ...(j.stationAt ?? j.spot), heading: null };
      };
      let policeCar: { entity: import("@/game/ThreeMapLayer").MapEntity; flash: (on: boolean) => void } | null = null;
      const dropPoliceCar = () => {
        if (!policeCar) return;
        layer.remove(policeCar.entity);
        policeCar = null;
      };
      let jailCell: { entity: import("@/game/ThreeMapLayer").MapEntity; light: import("three").Object3D } | null = null;
      // A police chase (owner, 13 Nov 2026: "Make the police give a real chase"; shown big): by the same clock as the rest
      type ChaseRec = NonNullable<State["chases"]>[number] & { start: number; end: number | null };
      const chases = new Map<string, ChaseRec>();
      /** A chase under way for this hunter at T (and a few seconds after it ends, to say how). */
      const chaseAt = (id: string, T: number) => {
        const c = chases.get(id);
        return c && T >= c.start && (c.end === null || T < c.end + 5000) ? c : null;
      };
      /** Where each police car (or the officer) was at T, from their track. */
      const copsAt = (c: ChaseRec, T: number) => {
        const out = new Map<number, { lng: number; lat: number; heading: number }>();
        const before = new Map<number, (typeof c.track)[number]>(), after = new Map<number, (typeof c.track)[number]>();
        for (const p of c.track) {
          if (p[0] <= T) before.set(p[1], p);
          else if (!after.has(p[1])) after.set(p[1], p);
        }
        for (const [i, a] of before) {
          const b = after.get(i);
          const k = b ? (T - a[0]) / Math.max(1, b[0] - a[0]) : 0;
          out.set(i, b ? { lng: a[2] + (b[2] - a[2]) * k, lat: a[3] + (b[3] - a[3]) * k, heading: a[4] } : { lng: a[2], lat: a[3], heading: a[4] });
        }
        return out;
      };
      /** How it stood at T: the stars, seen or not, hiding where, the roadblock, how it ended. */
      const chaseState = (c: ChaseRec, T: number) => {
        let stars = 1, seen = true, hiding: string | null = null, block: [number, number, number] | null = null, ended: string | null = null;
        for (const n of c.notes) {
          if (n[0] > T) continue;
          if (n[1] === "level") stars = Math.max(stars, Number(n[2]) || 1);
          else if (n[1] === "seen") {
            seen = Number(n[2]) === 1;
            if (seen) hiding = null;
          } else if (n[1] === "hide") hiding = String(n[2]);
          else if (n[1] === "unhide") hiding = null;
          else if (n[1] === "roadblock") {
            try {
              block = JSON.parse(String(n[2]));
            } catch {
              block = null;
            }
          } else if (n[1] === "end") ended = String(n[2]);
        }
        return { stars, seen, hiding, block, ended };
      };
      const chaseCops = new Map<number, { entity: import("@/game/ThreeMapLayer").MapEntity; car: ReturnType<typeof models.makePoliceCar> | null; avatar: ReturnType<typeof models.buildAvatar> | null; last: { lng: number; lat: number } }>();
      let chaseBlock: { key: string; entity: import("@/game/ThreeMapLayer").MapEntity; flash: (on: boolean) => void } | null = null;
      let chaseKey = "";
      const dropChase = () => {
        for (const cop of chaseCops.values()) layer.remove(cop.entity);
        chaseCops.clear();
        if (chaseBlock) layer.remove(chaseBlock.entity);
        chaseBlock = null;
        if (chaseKey) {
          chaseKey = "";
          setChaseShown(null);
        }
      };
      const dropJailCell = () => {
        if (!jailCell) return;
        layer.remove(jailCell.entity);
        jailCell = null;
      };
      let careVan: { entity: import("@/game/ThreeMapLayer").MapEntity; light: import("three").Object3D } | null = null;
      let careKey = "";
      let skyAt = -Infinity;
      let nightNow = false;
      let weatherKey = "";
      const serverNowFor = () => Date.now() + skew;
      // ---- The vulcanizer brought back to a flat (owner, 9 Nov 2026: "The vulcanizer, following you back to the vehicle,
      // should be implemented too"): walking a body length or two behind the hunter, along the way the hunter went, as
      // the game draws them (helperTick). When they joined and left is noted by the server's clock as each poll sees it,
      // so they're shown at the same moment as the hunter (motionDelay behind); not while a scene plays (the flat's own).
      const helperLog = new Map<string, [number, string | null][]>();
      // ---- Resting (owner, 14 Nov 2026: "When a user is resting, that they sit on the road the broadcast doesnt have
      // that"): sitting at the roadside, off the road and facing it, as their screen draws them (roadsideSeat), their
      // bicycle on its stand beside them; from the moment they sat down, by the server's clock.
      const restLog = new Map<string, [number, boolean][]>();
      const restingAt = (id: string, T: number) => {
        let on = false;
        for (const [at, r] of restLog.get(id) ?? []) if (at <= T) on = r;
        return on;
      };
      let seat: { key: string; at: { lng: number; lat: number }; bike: { lng: number; lat: number }; heading: number } | null = null;
      let restBike: import("@/game/ThreeMapLayer").MapEntity | null = null;
      const dropRestBike = () => {
        if (restBike) layer.remove(restBike);
        restBike = null;
      };
      /** A spot `right` metres to the right of the way they face and `ahead` metres on (as the game's besideBus). */
      const beside = (p: { lng: number; lat: number }, heading: number, right: number, ahead: number) => {
        const east = -Math.cos(heading) * right + Math.sin(heading) * ahead;
        const north = -Math.sin(heading) * right - Math.cos(heading) * ahead;
        return { lng: p.lng + east / (111320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat + north / 110574 };
      };
      /** Where they sit: off the road, on whichever side is clearest of any road, facing the road (the game's roadsideSeat). */
      const roadsideSeat = (p: { lng: number; lat: number; heading: number }, net: import("@/game/roads").RoadNetwork | null) => {
        const key = `${p.lng.toFixed(6)},${p.lat.toFixed(6)},${p.heading.toFixed(2)},${!!net}`;
        if (seat?.key === key) return seat;
        const enlarge = layer.enlargement();
        const kx = 111320 * Math.cos((p.lat * Math.PI) / 180), ky = 110574;
        const clearance = (q: { lng: number; lat: number }) => {
          let best = Infinity;
          if (!net) return best;
          const px = q.lng * kx, py = q.lat * ky;
          for (const e of net.edges) {
            const a = net.nodes[e.a], b = net.nodes[e.b];
            const ax = a.lng * kx, ay = a.lat * ky, bx = b.lng * kx, by = b.lat * ky;
            if (Math.min(ax, bx) - px > 120 || px - Math.max(ax, bx) > 120 || Math.min(ay, by) - py > 120 || py - Math.max(ay, by) > 120) continue;
            const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9;
            const k = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
            best = Math.min(best, Math.hypot(ax + k * (bx - ax) - px, ay + k * (by - ay) - py));
          }
          return best;
        };
        let pick = { side: 1, off: 2.4, clear: -1 };
        for (const off of [2.4, 3.4]) {
          for (const side of [1, -1]) {
            const clear = clearance(beside(p, p.heading, side * off * enlarge, 0));
            if (clear > pick.clear + 0.5) pick = { side, off, clear };
          }
          if (pick.clear >= 1.6 * enlarge) break;
        }
        seat = {
          key,
          at: beside(p, p.heading, pick.side * pick.off * enlarge, 0),
          bike: beside(p, p.heading, pick.side * (pick.off - 0.2) * enlarge, 1.7 * enlarge),
          heading: p.heading + (pick.side * Math.PI) / 2,
        };
        return seat;
      };
      // ---- A vehicle left at the roadside (owner, 13 Nov 2026: "when vehicle have flat, it doesnt show on the broadcast"):
      // shown where it stands with its tag, as on the hunter's screen, from the moment it stopped (by the server's clock).
      type Parked = NonNullable<Hunter["parked"]>;
      const parkedLog = new Map<string, [number, Parked | null][]>();
      const parkedAt = (id: string, T: number) => {
        let out: Parked | null = null;
        for (const [at, v] of parkedLog.get(id) ?? []) if (at <= T) out = v;
        return out;
      };
      let parkedCar: { key: string; entity: import("@/game/ThreeMapLayer").MapEntity } | null = null;
      const dropParked = () => {
        if (!parkedCar) return;
        layer.remove(parkedCar.entity);
        parkedCar = null;
      };
      const helperAt = (id: string, T: number) => {
        const log = helperLog.get(id);
        if (!log) return null;
        let name: string | null = null;
        for (const [at, n] of log) if (at <= T) name = n;
        return name;
      };
      let helperWalker: { id: string; name: string; avatar: ReturnType<typeof models.buildAvatar>; entity: import("@/game/ThreeMapLayer").MapEntity; d: number } | null = null;
      /** The followed hunter's way as drawn (metres along it), for the vulcanizer to walk behind them. */
      let trail: { id: string; pts: { lng: number; lat: number; d: number }[] } | null = null;
      const trailAt = (pts: { lng: number; lat: number; d: number }[], d: number) => {
        if (d <= pts[0].d) return pts[0];
        for (let i = 1; i < pts.length; i++) {
          if (pts[i].d >= d) {
            const a = pts[i - 1], b = pts[i], k = (d - a.d) / Math.max(1e-6, b.d - a.d);
            return { lng: a.lng + (b.lng - a.lng) * k, lat: a.lat + (b.lat - a.lat) * k, d };
          }
        }
        return pts[pts.length - 1];
      };
      const dropHelper = () => {
        if (!helperWalker) return;
        layer.remove(helperWalker.entity);
        helperWalker = null;
      };
      const freshLive = (id: string) => {
        const l = live.get(id);
        return !!l && Date.now() - l.at < LIVE_FRESH_MS;
      };
      // ---- The show's state, every few seconds; new events make a banner.
      const seen = new Set<string>();
      let first = true;
      let misses = 0; // in a row, before the first answer
      async function poll() {
        const { data, error } = await supabase.rpc("broadcast_state", { p_hunt: huntId });
        if (disposed) return;
        if (error || !data) {
          // Only when it's refused (not the owner), the hunt isn't there, or it's failed a minute running: a slow or busy
          // moment (a timeout) is tried again at the next poll, not the end of the broadcast
          misses++;
          if (first && (!error || /Owner only/i.test(error.message ?? "") || misses >= 15)) setFailed(true);
          return;
        }
        misses = 0;
        if (first) setFailed(false);
        latest = data as State;
        setState(latest);
        if (latest.now) skew = Date.parse(latest.now) - Date.now();
        const polledAt = latest.now ? Date.parse(latest.now) : Date.now() + skew;
        for (const h of latest.hunters) {
          const resting = !!h.restingSince;
          const rlog = restLog.get(h.id);
          if (!rlog) restLog.set(h.id, [[resting ? Date.parse(h.restingSince!) : 0, resting]]);
          else if (rlog[rlog.length - 1][1] !== resting) {
            const since = resting ? Date.parse(h.restingSince!) : NaN;
            rlog.push([Number.isFinite(since) ? Math.max(rlog[rlog.length - 1][0], since) : polledAt, resting]);
            if (rlog.length > 8) rlog.shift();
          }
          const pv = h.parked ?? null;
          const plog = parkedLog.get(h.id);
          const pkey = (v: Parked | null) => (v ? `${v.kind}|${v.lng},${v.lat}|${v.why}|${v.wheel}` : "");
          if (!plog) parkedLog.set(h.id, [[0, pv]]);
          else if (pkey(plog[plog.length - 1][1]) !== pkey(pv)) {
            // From when it stopped (if that's news), else from this poll
            const since = pv?.since && !plog[plog.length - 1][1] ? Date.parse(pv.since) : NaN;
            plog.push([Number.isFinite(since) ? Math.max(plog[plog.length - 1][0], since) : polledAt, pv]);
            if (plog.length > 8) plog.shift();
          }
          const name = h.helper ?? null;
          const log = helperLog.get(h.id);
          if (!log) helperLog.set(h.id, [[0, name]]); // as it was when the broadcast opened
          else if (log[log.length - 1][1] !== name) {
            log.push([polledAt, name]);
            if (log.length > 8) log.shift();
          }
        }
        // Trips under way: placed along their route by the clock (a trip saves no positions).
        const going = new Set<string>();
        for (const trip of latest.trips ?? []) {
          if (!Array.isArray(trip.path) || trip.path.length < 2) continue;
          going.add(trip.userId);
          const key = `${trip.departsAt}|${trip.arrivesAt}|${trip.path.length}`;
          if (routes.get(trip.userId)?.key !== key) {
            const path = unwrap(trip.path);
            routes.set(trip.userId, { key, trip, path, cum: cumulativeOf(path) });
          }
        }
        for (const id of [...routes.keys()]) if (!going.has(id)) routes.delete(id);
        const visiting = new Set<string>();
        for (const v of latest.visits ?? []) {
          visiting.add(v.userId);
          const key = `${v.calledAt}|${v.dischargedAt}`;
          if (visits.get(v.userId)?.key === key) continue;
          const way = (pts: [number, number][] | null) => {
            if (!Array.isArray(pts) || pts.length < 2) return null;
            const path = unwrap(pts);
            return { path, cum: cumulativeOf(path) };
          };
          visits.set(v.userId, { key, v, approach: way(v.approach), route: way(v.route) });
        }
        chases.clear();
        for (const c of latest.chases ?? []) {
          const start = Date.parse(c.startedAt);
          chases.set(c.userId, { ...c, start, end: c.endedAt ? Date.parse(c.endedAt) : null, track: [...c.track].sort((a, b) => a[0] - b[0]) });
        }
        jails.clear();
        for (const j of latest.jails ?? []) {
          const path = Array.isArray(j.route) && j.route.length >= 2 ? unwrap(j.route) : null;
          jails.set(j.userId, {
            at: Date.parse(j.at),
            spot: { lng: j.lng, lat: j.lat },
            station: j.station,
            stationAt: j.stationLng != null && j.stationLat != null ? { lng: j.stationLng, lat: j.stationLat } : null,
            way: path ? { path, cum: cumulativeOf(path) } : null,
            taken: j.takenAt ? Date.parse(j.takenAt) : null,
            arrives: j.arrivesAt ? Date.parse(j.arrivesAt) : null,
            out: j.out ? Date.parse(j.out) : null,
            left: j.left,
            serving: j.serving,
            vehicle: j.vehicle,
            reason: j.reason ?? "idle",
            stars: j.stars ?? null,
            parked: j.parked ?? null,
          });
        }
        // Gone from the list once they're out (kept a moment longer here: played 6 s behind)
        const careNow = Date.now() + skew - motionDelay;
        for (const [id, c] of visits) if (!visiting.has(id) && careNow > Date.parse(c.v.dischargedAt) + 5000) visits.delete(id);
        // Saved spots, for hunters not heard live just now (and not on a trip: their saved spot is where it began).
        for (const h of latest.hunters) if (h.lng != null && h.lat != null && !freshLive(h.id) && !going.has(h.id) && !careAt(h.id, careNow)) heard(h.id, h.lng, h.lat);
        const fresh = latest.events.filter((e) => !seen.has(eventKey(e)));
        fresh.forEach((e) => seen.add(eventKey(e)));
        if (first) {
          first = false;
          return; // events from before the broadcast opened don't get banners
        }
        // Banners, oldest first, one after another (several can happen in one poll); joins are the least exciting.
        const big = fresh.filter((e) => e.kind !== "joined");
        queue.push(...(big.length ? big : fresh.slice(0, 1)).reverse());
        if (!showing) nextBanner();
      }
      const queue: ShowEvent[] = [];
      let showing = false;
      function nextBanner() {
        const e = queue.shift();
        showing = !!e;
        setBanner(e ?? null);
        if (!e) return;
        // Auto: whoever made it happen is next (once the current minute is up).
        if (autoRef.current && e.whoId) wantNext = e.whoId;
        // Shorter when more are waiting.
        bannerTimer = window.setTimeout(() => !disposed && nextBanner(), queue.length ? BANNER_MS / 2 : BANNER_MS);
      }
      let bannerTimer = 0;
      void poll();
      const pollTimer = window.setInterval(() => void poll(), POLL_MS);

      // Auto: each hunter in turn (leaders first) for a minute before the camera moves on (owner, 3 Nov 2026: "We
      // should show each user 1 min before moving"), the whole field between rounds. Someone doing something goes
      // next, without cutting the current minute short.
      let wantNext: string | null = null;
      let shownSince = Date.now();
      let shownView = "field";
      const seenThisRound = new Set<string>();
      let lastFollowed: string | null = null;
      const autoTimer = window.setInterval(() => {
        if (!latest) return;
        const cur = viewRef.current;
        const key = cur.kind === "follow" ? cur.id : "field";
        if (key !== shownView) {
          shownView = key; // a new view (also one chosen by hand): its minute starts now
          shownSince = Date.now();
        }
        if (!autoRef.current || Date.now() - shownSince < (cur.kind === "field" ? FIELD_MS : DWELL_MS)) return;
        // Everyone drawn on the map, each in turn (src/game/autocam.ts)
        const here = latest.hunters.filter((h) => shown.has(h.id)).map((h) => h.id);
        const next = nextAutoView(here, key, seenThisRound, wantNext, lastFollowed);
        wantNext = null;
        if (next === "field") {
          if (cur.kind !== "field") setView({ kind: "field" });
        } else {
          lastFollowed = next;
          if (key !== next) setView({ kind: "follow", id: next });
          else shownSince = Date.now(); // one hunter: on them, a new minute
        }
      }, 1000);

      // ---- The followed hunter in 3D.
      let followPos: { lng: number; lat: number } | null = null;
      const layer = new ThreeMapLayer(() => followPos ?? { lng: map.getCenter().lng, lat: map.getCenter().lat }, 44);
      let followed: {
        id: string;
        avatar: ReturnType<typeof models.buildAvatar> | null;
        plane: ReturnType<typeof models.makePlane> | null;
        light: import("three").Object3D | null; // an ambulance's flashing light
        pace: number; // metres a second it moves on screen, smoothed (its stride)
        entity: import("@/game/ThreeMapLayer").MapEntity;
        road?: { lng: number; lat: number }; // where they are on the road (the figure may sit beside it)
      } | null = null;
      let lastView = "";
      let lastFit = 0;
      const markers = new Map<string, { marker: import("maplibre-gl").Marker; el: HTMLDivElement; label: string }>();
      let lastDomeKey = "";
      let frame = 0;
      let last = performance.now();

      const domeShape = (d: Dome) => {
        const ring: [number, number][] = [];
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          ring.push([d.lng + (d.radiusM * Math.sin(a)) / (111320 * Math.cos((d.lat * Math.PI) / 180)), d.lat + (d.radiusM * Math.cos(a)) / 110574]);
        }
        return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } };
      };

      const loop = (t: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        const s = latest;
        if (!s) return;

        drawnAt = t;
        drawnWall = Date.now(); // one clock for the whole frame: everyone's spot is for this moment
        // Toward the measured delay: catching up at 10% fast, falling back at up to 25% slow (never a jump)
        const toGoal = delayGoal - motionDelay;
        motionDelay += Math.max(-100 * dt, Math.min(250 * dt, toGoal));
        if (t - skyAt > 1000) {
          skyAt = t;
          const here = followPos ?? { lng: map.getCenter().lng, lat: map.getCenter().lat };
          const followedWeather = viewRef.current.kind === "follow" ? (s.hunters.find((x) => viewRef.current.kind === "follow" && x.id === viewRef.current.id)?.weather ?? null) : null;
          const light = daylight(serverNowFor(), here.lng, here.lat) * weatherDim(followedWeather);
          const dark = 1 - light;
          if (map.getLayer("b-night-ground")) {
            // Dusk and dawn a deep purple; full night a dark blue (as the game's)
            map.setPaintProperty("b-night-ground", "fill-color", light > 0.15 ? "#2B2450" : "#0B1630");
            map.setPaintProperty("b-night-ground", "fill-opacity", 0.62 * dark);
            map.setPaintProperty("b-night-dim", "fill-opacity", 0.22 * dark);
          }
          layer.setDaylight(light);
          nightNow = light < 0.35;
        }
        builtThisFrame = false;
        // Every hunter where they were a moment ago, between the positions heard; on a trip, where the trip is.
        const serverNow = drawnWall + skew;
        careT = (motionSkew !== null ? drawnWall + motionSkew : serverNow) - motionDelay;
        for (const h of s.hunters) {
          // Finished (every key won): free to roam, but not on the show any more (owner, 12 Nov 2026: "if a user get all
          // key in the hunt there is no need broadcasting them again, they can free roam, but not broadcast"). Not drawn,
          // so not on the map nor in the auto camera's rounds; still on the leaderboard with their place.
          if (h.place != null) {
            shown.delete(h.id);
            follows.delete(h.id);
            continue;
          }
          // Arrested: where the police have them (never walked there)
          const arrest = jailAt(h.id, careT);
          if (arrest) {
            const jp = jailPlace(arrest, careT);
            const cur = shown.get(h.id);
            const at = { lng: jp.lng, lat: jp.lat, heading: jp.heading ?? cur?.heading ?? 0 };
            if (!cur) shown.set(h.id, at);
            else Object.assign(cur, at);
            follows.delete(h.id);
            continue;
          }
          // Fainted: where the ambulance visit has them (never walked there)
          const care = careAt(h.id, careT);
          if (care) {
            const cur = shown.get(h.id);
            const at = { lng: care.lng, lat: care.lat, heading: care.heading ?? cur?.heading ?? 0 };
            if (!cur) shown.set(h.id, at);
            else Object.assign(cur, at);
            follows.delete(h.id); // their saved spots start afresh after
            continue;
          }
          // On a trip: where the game says the bus, train or plane is (it sends that live, by its own timetable of
          // stops, lights and jams); only without that, along the route by the clock.
          const r = tripOf(h.id);
          // (with their motion, the vehicle as on their screen, below; without it, along its line by the clock)
          if (r && !motions.has(h.id)) {
            const at = tripAt(r, serverNow);
            shown.set(h.id, { lng: at.lng, lat: at.lat, heading: at.heading });
            continue;
          }
          // Going along their way: where they were motionDelay ago, between the keyframes either side
          const mo = motions.get(h.id);
          const mw = ways.get(h.id);
          if (mo && mw && mw.id === mo.way && motionSkew !== null) {
            const T = drawnWall + motionSkew - motionDelay;
            const last = mo.keys[mo.keys.length - 1];
            if (mo.ended && (!last || T > last[0] + 3000)) {
              motions.delete(h.id); // played to its end: their saved spot from here
            } else {
              const total = mw.cum[mw.cum.length - 1] ?? 0;
              // Where they were by time alone (as the original Loota's simulateTravelTick), never by adding up frames: the
              // same at any frame rate. Smoothed over a quarter of a second either side (it's played seconds behind, so
              // that's already here): a phone that draws in uneven steps glides here; a real stop is still a stop.
              let sum = 0, weight = 0;
              for (const [dtMs, w] of [[-250, 1], [-125, 2], [0, 3], [125, 2], [250, 1]] as const) {
                sum += w * Math.min(total, Math.max(0, alongAt(mo.keys, T + dtMs)?.s ?? 0));
                weight += w;
              }
              const want = sum / weight;
              // Never back (a new start, or far out: there at once)
              mo.drawnS = mo.drawnS === null || want > mo.drawnS || mo.drawnS - want > 30 ? want : mo.drawnS;
              const { pos } = alongPath(mw.pts, mw.cum, mo.drawnS);
              const a = alongPath(mw.pts, mw.cum, Math.max(0, mo.drawnS - 3)).pos, b = alongPath(mw.pts, mw.cum, Math.min(total, mo.drawnS + 4)).pos;
              if (a[0] !== b[0] || a[1] !== b[1]) mo.heading = geo.turnTowards(mo.heading, geo.headingOf(a, b), Math.min(1, 5 * dt));
              const at = { lng: pos[0], lat: pos[1], heading: mo.heading };
              const cur = shown.get(h.id);
              if (!cur) shown.set(h.id, at);
              else Object.assign(cur, at);
              follows.delete(h.id); // its saved spots start afresh after
              continue;
            }
          }
          const fw = follows.get(h.id);
          if (!fw) continue;
          const at = follow.drawn(fw, t, dt, netFor(h.id, fw.last));
          const cur = shown.get(h.id);
          if (!cur) shown.set(h.id, { ...at });
          else Object.assign(cur, at);
        }

        // A dot and name for every hunter, moved every frame.
        const leaderId = s.hunters[0]?.id;
        const following = viewRef.current.kind === "follow" ? viewRef.current.id : null;
        for (const h of s.hunters) {
          const p = shown.get(h.id);
          if (!p) continue;
          let m = markers.get(h.id);
          if (!m) {
            const el = document.createElement("div");
            el.className = "loota-hunter-marker";
            el.innerHTML = '<span class="dot"></span><span class="name"></span>';
            m = { marker: new Marker({ element: el, anchor: "top" }).setLngLat([p.lng, p.lat]).addTo(map), el, label: "" };
            markers.set(h.id, m);
          }
          m.marker.setLngLat([p.lng, p.lat]);
          const r = tripOf(h.id);
          const inThreeD = !!r && h.id === following; // the 3D vehicle is drawn instead
          const icon = r && !inThreeD ? (TRIP_ICON[r.trip.mode] ?? "🚌") : "";
          const inScene = motionSkew !== null ? sceneAt(h.id, drawnWall + motionSkew - motionDelay) : null;
          const slow = motionSkew !== null ? whySlow(h.id, drawnWall + motionSkew - motionDelay) : 0;
          const care = careAt(h.id, careT);
          const arrestNow = jailAt(h.id, careT);
          const arrestPhase = arrestNow ? jailPlace(arrestNow, careT).phase : null;
          const chaseNow = chaseAt(h.id, careT);
          const label = chaseNow && !chaseNow.outcome
            ? `🚨 ${h.name} · chased by the police`
            : arrestNow
            ? arrestPhase === "cell"
              ? `🚔 ${h.name} · in the cell`
              : `🚓 ${h.name} · arrested${arrestPhase === "riding" && arrestNow.station ? ` → ${arrestNow.station}` : ""}`
            : care
            ? care.phase === "treated"
              ? `${care.ward ? "🏥" : "🚑"} ${h.name} · ${care.ward ? care.hospital : "paramedics"}`
              : `🚑 ${h.name}${care.ward ? ` → ${care.hospital}` : " · fainted"}`
            : r
            ? `${icon} ${h.name} → ${r.trip.to}`
            : inScene
              ? `${sceneLabel(inScene).icon} ${h.name} · ${sceneLabel(inScene).what}`
              : `${h.name} · ${h.keysHeld}/${s.hunt.keys}${slow === 1 ? " · 🚦" : slow ? " · 🚗" : ""}${helperAt(h.id, careT) ? " · 🧰" : ""}${restingAt(h.id, careT) ? " · 🪑 resting" : ""}`;
          if (m.label !== label) {
            m.label = label;
            m.el.querySelector(".name")!.textContent = label;
          }
          m.el.dataset.kind = r ? "trip" : h.place ? "finished" : h.inTrial ? "trial" : h.id === leaderId ? "leader" : "hunter";
          // On a trip: the vehicle instead of the dot, turned the way it's going (✈️ is drawn pointing north-east).
          const dot = m.el.querySelector<HTMLElement>(".dot")!;
          if (dot.textContent !== icon) dot.textContent = icon;
          dot.style.transform = r ? `rotate(${geo.compassFromHeading(p.heading) - map.getBearing() - (r.trip.mode === "plane" ? 45 : 0)}deg)` : "";
          m.el.dataset.followed = String(h.id === following);
        }
        for (const [id, m] of markers) {
          if (!s.hunters.some((h) => h.id === id)) {
            m.marker.remove();
            markers.delete(id);
          }
        }
        // Domes change rarely: only re-send them when they do.
        const domeKey = s.domes.map((d) => d.id).join(",");
        if (domeKey !== lastDomeKey) {
          lastDomeKey = domeKey;
          (map.getSource("b-domes") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({
            type: "FeatureCollection",
            features: s.domes.map(domeShape),
          });
        }

        // The camera.
        const v = viewRef.current;
        const viewKey = v.kind === "follow" ? `follow:${v.id}` : "field";
        if (v.kind === "follow" && s.hunters.find((x) => x.id === v.id)?.place != null) setView({ kind: "field" });
        if (v.kind !== "follow") prefetch(t, null, null); // (round every hunter, to switch to any of them)
        if (v.kind === "follow") {
          const h = s.hunters.find((x) => x.id === v.id);
          const p = h ? shown.get(h.id) : null;
          prefetch(t, p ?? null, h ? tripOf(h.id) : null);
          const r = h ? tripOf(h.id) : null;
          const ride = r ? r.trip.mode : null;
          if (h && p) {
            followPos = { lng: p.lng, lat: p.lat };
            // As the hunter's own laptop shows them: walking or on their own bicycle, motorbike or car, the hunter in
            // 3D; on a bus, train, taxi or plane, that vehicle as the game draws it.
            const care = careAt(h.id, careT);
            {
              const w = h.weather ?? null;
              const onFoot = !ride && (live.get(h.id)?.mode ?? h.mode ?? "walk") !== "car" && (live.get(h.id)?.mode ?? h.mode) !== "motorbike";
              const key = w ? `${h.id}|${w.kind}|${w.heavy}|${w.temp}|${nightNow}|${onFoot}` : "";
              if (key !== weatherKey) {
                weatherKey = key;
                setWeatherShown(w ? { ...w, who: h.name, night: nightNow, slowed: onFoot && (w.kind === "rain" || w.kind === "storm") } : null);
              }
            }
            const inAmbulance = care?.phase === "riding";
            const key = ride ? `${h.id}:${ride}` : inAmbulance ? `${h.id}:ambulance` : h.id;
            if (!followed || followed.id !== key) {
              if (followed) layer.remove(followed.entity);
              const avatar = ride || inAmbulance ? null : models.buildAvatar(normalizeLook(h.look));
              const plane = ride === "plane" ? models.makePlane() : null;
              const amb = inAmbulance ? models.makeAmbulance() : null;
              const object = amb ? amb.group : plane ? plane.group : ride === "taxi" ? models.makeTaxi() : ride === "train" ? models.makeTrainCar(true) : ride ? models.makeBus() : avatar!.root;
              object.add(layer.billboard(models.makeNameplate(h.name, "#F4B41A")));
              followed = { id: key, avatar, plane, light: amb?.light ?? null, pace: 0, entity: layer.add({ object, lng: p.lng, lat: p.lat, heading: p.heading, scaleBy: ride === "train" ? 0.8 : plane ? 0.45 : undefined }) };
            }
            const before = followed.road ?? { lng: followed.entity.lng, lat: followed.entity.lat };
            followed.road = { lng: p.lng, lat: p.lat };
            followed.entity.lng = p.lng;
            followed.entity.lat = p.lat;
            followed.entity.heading = p.heading;
            if (ride === "train" && r && r.path.length > 1) {
              const spacing = models.TRAIN_CAR_SPACING * layer.enlargement() * 0.8;
              const total = r.cum[r.cum.length - 1] ?? 0;
              const s = alongOn(r.path, r.cum, p);
              const half = Math.min(spacing / 2, total / 2);
              while (trainCars.length < TRAIN_CARS - 1) trainCars.push(layer.add({ object: models.makeTrainCar(false), lng: p.lng, lat: p.lat, heading: p.heading, scaleBy: 0.8 }));
              // As their screen does: the whole train on the track from the start (not piled up at the platform), its
              // front sliding from one train's length along to the end
              const length = Math.min(total, (TRAIN_CARS - 1) * spacing);
              const lead = length + (Math.min(total, s) / Math.max(1, total)) * (total - length);
              const place = (e: import("@/game/ThreeMapLayer").MapEntity, at: number) => {
                const pos = alongPath(r.path, r.cum, at).pos;
                const back = alongPath(r.path, r.cum, Math.max(0, at - half)).pos;
                const front = alongPath(r.path, r.cum, Math.min(total, at + half)).pos;
                e.lng = pos[0];
                e.lat = pos[1];
                if (back[0] !== front[0] || back[1] !== front[1]) e.heading = geo.headingOf(back, front);
              };
              place(followed.entity, lead);
              trainCars.forEach((car, i) => {
                const at = Math.max(0, lead - (i + 1) * spacing);
                const pos = alongPath(r.path, r.cum, at).pos;
                const back = alongPath(r.path, r.cum, Math.max(0, at - half)).pos;
                const front = alongPath(r.path, r.cum, Math.min(total, at + half)).pos;
                car.lng = pos[0];
                car.lat = pos[1];
                if (back[0] !== front[0] || back[1] !== front[1]) car.heading = geo.headingOf(back, front);
              });
            } else if (trainCars.length) dropTrainCars();
            const stepM = geo.distanceM([before.lng, before.lat], [p.lng, p.lat]);
            const mode = live.get(h.id)?.mode ?? h.mode ?? "walk";
            // Resting: sat at the roadside (stood up again as soon as they move on)
            const sitting = !ride && !care && !!followed.avatar && restingAt(h.id, careT) && followed.pace < 0.4;
            if (sitting) {
              const spot = roadsideSeat(p, netFor(h.id, p));
              followed.entity.lng = spot.at.lng;
              followed.entity.lat = spot.at.lat;
              followed.entity.heading = spot.heading;
              if (mode === "bicycle") {
                if (!restBike) {
                  const bike = models.makeVehicleModel("bicycle");
                  bike.rotation.z = 0.12; // leaning on its stand
                  restBike = layer.add({ object: bike, lng: spot.bike.lng, lat: spot.bike.lat, heading: p.heading });
                }
                restBike.lng = spot.bike.lng;
                restBike.lat = spot.bike.lat;
                restBike.heading = p.heading;
              } else dropRestBike();
            } else dropRestBike();
            // Its stride by their speed, smoothed: a frame without a step doesn't drop it to standing (which looked like
            // turning back); it comes to a stand only once they've really stopped.
            followed.pace += ((dt > 0 ? stepM / dt : 0) - followed.pace) * Math.min(1, 4 * dt);
            const moving = followed.pace < 0.4 ? 0 : Math.min(1, followed.pace / baseSpeed(mode as Mode));
            // Fainted: lying where they fell (and by the road while paramedics treat them); in the ward, unseen inside
            const lying = !!care && (care.phase === "waiting" || (care.phase === "treated" && !care.ward));
            if (followed.avatar) models.animateAvatar(followed.avatar, { mode: lying ? "walk" : mode, phase: lying ? "fainted" : "idle", moving: lying || sitting ? 0 : moving, distance: sitting ? 0 : stepM / layer.enlargement(), sitting }, dt, t / 1000);
            followed.entity.object.visible = !(care?.phase === "treated" && care.ward);
            if (followed.light) followed.light.visible = Math.floor(t / 250) % 2 === 0;
            // The ambulance on its way to them, and parked at the hospital after
            const van = care && care.phase !== "riding" ? care.van : null;
            if (van) {
              if (!careVan) {
                const amb = models.makeAmbulance();
                careVan = { entity: layer.add({ object: amb.group, lng: van.lng, lat: van.lat, heading: van.heading }), light: amb.light };
              }
              careVan.entity.lng = van.lng;
              careVan.entity.lat = van.lat;
              careVan.entity.heading = geo.turnTowards(careVan.entity.heading ?? van.heading, van.heading, Math.min(1, 6 * dt));
              careVan.light.visible = Math.floor(t / 250) % 2 === 0;
            } else if (careVan) {
              layer.remove(careVan.entity);
              careVan = null;
            }
            // A police chase: the police where they were, the roadblock, the stars and how it stands
            const chased = chaseAt(h.id, careT);
            if (chased) {
              const st = chaseState(chased, careT);
              const where = copsAt(chased, careT);
              for (const [i, at] of where) {
                let cop = chaseCops.get(i);
                if (!cop) {
                  const officer = i === 0 && chased.chaser === "officer";
                  const avatar = officer ? models.buildAvatar(OFFICER) : null;
                  const car = officer ? null : models.makePoliceCar();
                  cop = { entity: layer.add({ object: avatar ? avatar.root : car!.group, lng: at.lng, lat: at.lat, heading: at.heading }), car, avatar, last: { lng: at.lng, lat: at.lat } };
                  chaseCops.set(i, cop);
                }
                const moved = geo.distanceM([cop.last.lng, cop.last.lat], [at.lng, at.lat]);
                cop.entity.lng = at.lng;
                cop.entity.lat = at.lat;
                cop.entity.heading = geo.turnTowards(cop.entity.heading ?? at.heading, at.heading, Math.min(1, 6 * dt));
                cop.last = { lng: at.lng, lat: at.lat };
                cop.car?.flash(Math.floor(t / 250) % 2 === 0);
                if (cop.avatar) models.animateAvatar(cop.avatar, { mode: "walk", phase: "idle", moving: moved > 0.01 ? 1 : 0, distance: moved / layer.enlargement() }, dt, t / 1000);
              }
              const bk = st.block ? st.block.join(",") : "";
              if (chaseBlock && chaseBlock.key !== bk) {
                layer.remove(chaseBlock.entity);
                chaseBlock = null;
              }
              if (st.block && !chaseBlock) {
                const rb = models.makeRoadblock();
                chaseBlock = { key: bk, entity: layer.add({ object: rb.group, lng: st.block[0], lat: st.block[1], heading: st.block[2] }), flash: rb.flash };
              }
              chaseBlock?.flash(Math.floor(t / 250) % 2 === 0);
              if (st.hiding) followed.entity.object.visible = false; // out of sight, inside
              const gaps = [...where.values()].map((at) => geo.distanceM([at.lng, at.lat], [p.lng, p.lat]));
              const shownNow = {
                who: h.name,
                stars: st.stars,
                status: (st.ended ?? (st.hiding ? "hiding" : st.seen ? "seen" : "unseen")) as "seen" | "unseen" | "hiding" | "caught" | "escaped" | "called_off",
                gap: gaps.length ? Math.round(Math.min(...gaps) / 10) * 10 : null,
                hiding: st.hiding,
              };
              const k2 = JSON.stringify(shownNow);
              if (k2 !== chaseKey) {
                chaseKey = k2;
                setChaseShown(shownNow);
              }
            } else if (chaseCops.size || chaseBlock || chaseKey) dropChase();
            // Arrested: the patrol car taking them along the road (they're in it), then the cell at the station
            const jail = jailAt(h.id, careT);
            const jp = jail ? jailPlace(jail, careT) : null;
            if (jp && jp.phase !== "cell") {
              if (!policeCar) {
                const car = models.makePoliceCar();
                policeCar = { entity: layer.add({ object: car.group, lng: jp.lng, lat: jp.lat, heading: jp.heading ?? 0 }), flash: car.flash };
              }
              policeCar.entity.lng = jp.lng;
              policeCar.entity.lat = jp.lat;
              if (jp.heading !== null) policeCar.entity.heading = geo.turnTowards(policeCar.entity.heading ?? jp.heading, jp.heading, Math.min(1, 6 * dt));
              policeCar.flash(Math.floor(t / 250) % 2 === 0);
            } else dropPoliceCar();
            if (jp?.phase === "riding") followed.entity.object.visible = false; // in the back of the car
            if (jp?.phase === "cell") {
              if (!jailCell) {
                const cell = models.makeJailCell();
                jailCell = { entity: layer.add({ object: cell.group, lng: jp.lng, lat: jp.lat, heading: 0 }), light: cell.light };
              }
              jailCell.entity.lng = jp.lng;
              jailCell.entity.lat = jp.lat;
              jailCell.light.visible = Math.floor(t / 300) % 2 === 0;
            } else dropJailCell();
            // Their vehicle left at the roadside: there, with its tag (FLAT TYRE / NO FUEL)
            const parked = ride ? null : parkedAt(h.id, careT);
            const pk = parked ? `${h.id}|${parked.kind}|${parked.lng},${parked.lat}|${parked.why}` : "";
            if (parkedCar && parkedCar.key !== pk) dropParked();
            if (parked && !parkedCar) {
              const object = models.makeVehicleModel(parked.kind);
              const tag = layer.billboard(models.makeNameplate(parked.why === "flat" ? "FLAT TYRE" : parked.why === "left" ? "PARKED" : "NO FUEL", parked.why === "left" ? "#2F6FEB" : "#B23A3A"));
              tag.position.y = parked.kind === "car" ? 2.6 : 2.2;
              object.add(tag);
              // By the kerb on the right, facing along the road (as the game parks it)
              const net = netFor(h.id, p);
              const rp = net ? roads.snapToNetwork(net, parked, 0) : null;
              const rd = net && rp ? roads.positionOf(net, rp) : null;
              let at = { lng: parked.lng, lat: parked.lat, heading: p.heading };
              if (rd && geo.distanceM([rd.lng, rd.lat], [parked.lng, parked.lat]) < 60) {
                const off = (parked.kind === "car" ? 2.2 : 1.6) * layer.enlargement();
                at = { lng: rd.lng + (-Math.cos(rd.heading) * off) / (111320 * Math.cos((rd.lat * Math.PI) / 180)), lat: rd.lat + (-Math.sin(rd.heading) * off) / 110574, heading: rd.heading };
              }
              parkedCar = { key: pk, entity: layer.add({ object, lng: at.lng, lat: at.lat, heading: at.heading }) };
            }
            const parkedFar = parked ? geo.distanceM([parked.lng, parked.lat], [p.lng, p.lat]) : Infinity;
            const parkedFresh = !!parked && (careT - Date.parse(parked.since ?? "") < 10 * 60_000 || parkedFar < 60 || !!parked.wheel || !!h.helper);
            const parkedNote = !parked || !parkedFresh
              ? null
              : parked.why === "left"
                ? `🅿️ ${h.name}'s ${parked.kind} is parked where the police caught them`
              : parked.why === "fuel"
                ? `⛽ ${h.name}'s ${parked.kind} ran out of fuel${parkedFar < 30 ? " at the roadside" : ": off to get some"}`
                : h.helper
                  ? `🛞 ${h.helper} the vulcanizer is walking back with ${h.name} to fix the ${parked.kind}`
                  : parked.wheel === "off"
                    ? `🛞 ${h.name} is rolling the ${parked.kind}'s wheel to a vulcanizer`
                    : parked.wheel === "fixed"
                      ? `🛞 ${h.name} is rolling the patched wheel back to the ${parked.kind}`
                      : `🛞 ${h.name}'s ${parked.kind} has a flat tyre${parkedFar < 30 ? "" : ": off to find a vulcanizer"}`;
            const jailLeft = jail ? Math.max(1, Math.ceil(jail.left / 60)) : 0;
            const impounded = jail?.vehicle ? ` · their ${jail.vehicle} impounded` : jail?.parked ? ` · their ${jail.parked} left at the roadside` : "";
            const arrestWhy = jail?.reason === "chase" ? `caught after a police chase (${"★".repeat(jail.stars ?? 1)})` : "arrested for idling on a main road";
            const note = jail && jp
              ? jp.phase === "cell"
                ? `🚔 ${h.name} is in the cell at ${jail.station ?? "the police station"} · ${jailLeft} min left${jail.serving ? "" : " (the clock waits while they're away)"}${impounded}`
                : jp.phase === "riding"
                  ? `🚓 ${h.name} was ${arrestWhy}: the police are taking them to ${jail.station ?? "the station"}${impounded}`
                  : `🚓 ${h.name} was ${arrestWhy}${impounded}`
              : !care
              ? parkedNote
              : care.phase === "waiting"
                ? `🚑 ${h.name} fainted: ${care.ward ? "an ambulance" : "paramedics"} on the way`
                : care.phase === "riding"
                  ? `🚑 Rushing ${h.name} to ${care.hospital}`
                  : care.ward
                    ? `🏥 ${h.name} is being treated at ${care.hospital}`
                    : `🚑 Paramedics are treating ${h.name}`;
            if ((note ?? "") !== careKey) {
              careKey = note ?? "";
              setCareNote(note);
            }
            // The laptop's zoom (GameMap's GAME_ZOOM and rideZoom): 17; a train or a long-distance bus 16; a plane pulls
            // back to 10 at cruising height (40 km from either end) and comes in again to land, climbing as the game's does.
            let zoom = ride === "train" || (ride === "bus" && (r?.cum[r.cum.length - 1] ?? 0) > 40_000) ? 16 : 17;
            if (r && ride === "train") {
              // Pulled back as far as its speed needs, as on the hunter's laptop (owner, 8 Nov 2026: "yes, it should be so").
              const total = r.cum[r.cum.length - 1] ?? 0;
              const secs = (Date.parse(r.trip.arrivesAt) - Date.parse(r.trip.departsAt)) / 1000;
              const dep = Date.parse(r.trip.departsAt);
              const f = Math.max(0, Math.min(1, (serverNow - dep) / Math.max(1, secs * 1000)));
              zoom = trainZoom(total, secs, trainAlong(f) * total, p.lat, 16);
            }
            if (r && (ride === "bus" || ride === "taxi")) {
              // As far back as its speed between stops needs, as on the hunter's screen (owner, 9 Nov 2026: "the bus was
              // just moving too fast"): its fastest so far from its motion (a city bus or taxi stops and starts), else about
              // half again its average (a long-distance bus runs at an even speed: its average)
              const total = r.cum[r.cum.length - 1] ?? 0;
              const dep = Date.parse(r.trip.departsAt), arr = Date.parse(r.trip.arrivesAt);
              const avg = total / Math.max(1, (arr - dep) / 1000);
              const keys = motions.get(h.id)?.keys ?? [];
              const fastest = keys.reduce((m, k) => Math.max(m, k[2] ?? 0), 0);
              const cruise = Math.max(fastest, avg * (total > 40_000 ? 1 : 1.5));
              const at = motionSkew !== null ? drawnWall + motionSkew - motionDelay : serverNow;
              zoom = busZoom(cruise, at - dep, arr - at, p.lat, 17);
            }
            if (r && ride === "plane") {
              const total = r.cum[r.cum.length - 1] ?? 0;
              const along = tripAt(r, serverNow).f * total;
              const edge = Math.min(along, total - along);
              const climb = Math.min(1, edge / 40000);
              zoom = 17 - 7 * climb * climb * (3 - 2 * climb);
              const height = Math.min(1, edge / 20000);
              if (followed.plane) followed.plane.body.position.y = 1.6 + 8 * height * height * (3 - 2 * height);
              followed.entity.scaleBy = 0.45 + (1.4 - 0.45) * climb * climb * (3 - 2 * climb);
            }
            // In a scene: the same place at the kerb, the keeper and the hunter in it, looked into as on their screen
            const T = motionSkew !== null ? drawnWall + motionSkew - motionDelay : 0;
            const anyScene = motionSkew !== null && !ride ? sceneAt(h.id, T) : null;
            const world = anyScene?.data.kind === "keyworld" ? anyScene : null;
            const sc = world ? null : anyScene; // a scene built at the kerb
            // Their way as drawn, for the vulcanizer to walk behind them
            if (!trail || trail.id !== h.id) {
              // Begun a few metres behind them, the way they face (followed from here on), so no one starts on top of them
              const back = 2.5 * layer.enlargement(); // where the vulcanizer walks (helperTick's gap)
              const behind = { lng: p.lng - (Math.sin(p.heading) * back) / (111320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat + (Math.cos(p.heading) * back) / 110574 };
              trail = { id: h.id, pts: [{ ...behind, d: 0 }, { lng: p.lng, lat: p.lat, d: back }] };
            }
            const end = trail.pts[trail.pts.length - 1];
            const stepped = geo.distanceM([end.lng, end.lat], [p.lng, p.lat]);
            if (stepped > 0.3) {
              trail.pts.push({ lng: p.lng, lat: p.lat, d: end.d + stepped });
              if (trail.pts.length > 400) trail.pts.shift();
            }
            const helper = ride || care || anyScene ? null : helperAt(h.id, careT);
            if (helperWalker && (helperWalker.name !== helper || helperWalker.id !== h.id)) dropHelper();
            if (helper) {
              const pts = trail.pts;
              const playerD = pts[pts.length - 1].d;
              const gap = 2.5 * layer.enlargement(); // people are drawn enlarged: a body length or two behind, as seen
              if (!helperWalker) {
                const avatar = models.buildAvatar({ ...keeperLook(helper), topColour: "#5B4636", extra: "cap" });
                const tag = layer.billboard(models.makeNameplate(helper, "#5B4636"));
                tag.position.y = 2.9;
                avatar.root.add(tag);
                const at = trailAt(pts, playerD - gap);
                helperWalker = { id: h.id, name: helper, avatar, entity: layer.add({ object: avatar.root, lng: at.lng, lat: at.lat, heading: p.heading }), d: playerD - gap };
              }
              const hw = helperWalker;
              const before = trailAt(pts, hw.d);
              // Just behind; quicker when left further back (as the game's)
              hw.d = Math.max(pts[0].d, Math.min(playerD - gap, hw.d + Math.max(2, (playerD - gap - hw.d) * 4) * dt));
              const at = trailAt(pts, hw.d);
              const ahead = trailAt(pts, hw.d + 2);
              hw.entity.lng = at.lng;
              hw.entity.lat = at.lat;
              if (ahead.lng !== at.lng || ahead.lat !== at.lat) hw.entity.heading = geo.headingOf([at.lng, at.lat], [ahead.lng, ahead.lat]);
              const moved = geo.distanceM([before.lng, before.lat], [at.lng, at.lat]);
              models.animateAvatar(hw.avatar, { mode: "walk", phase: "idle", moving: moved > 0.01 ? 1 : 0, distance: moved / layer.enlargement() }, dt, t / 1000);
            }
            // At a key's place: their own arrangement of it, them walking where they walked (step 3)
            if (world && worldShown?.id !== world.id) {
              worldShown = { id: world.id, playback: { current: { T, track: [], inner: null, dug: null } } };
              setKeyWorld({ id: world.id, data: world.data as unknown as KeyWorldData, look: h.look, playback: worldShown.playback });
            } else if (!world && worldShown) {
              worldShown = null;
              setKeyWorld(null);
            }
            if (world && worldShown) {
              const pb = worldShown.playback.current;
              pb.T = T;
              pb.track = world.track ?? [];
              const wd = world.data as unknown as KeyWorldData;
              let state = { inner: wd.inner, dug: wd.dug };
              for (const l of world.lines) {
                if (l[0] > T) break;
                if (l[1] === "state") state = parse<typeof state>(l[2]) ?? state;
              }
              pb.inner = state.inner;
              pb.dug = state.dug;
            }
            if (sc?.data.model && (!sceneView || sceneView.id !== sc.id)) {
              dropSceneView();
              try {
                const make = (models as unknown as Record<string, (...args: unknown[]) => unknown>)[sc.data.model.make];
                const made = make(...sc.data.model.args) as { isObject3D?: boolean; group?: import("three").Object3D };
                const group = (made.isObject3D ? made : made.group) as import("three").Object3D;
                const keeper = models.buildAvatar(normalizeLook(sc.data.keeper.look));
                keeper.root.position.set(sc.data.keeper.at.x, 0.14, sc.data.keeper.at.z);
                const you = models.buildAvatar(normalizeLook(h.look));
                you.root.position.set(sc.data.you.from.x, 0.14, sc.data.you.from.z);
                you.root.rotation.y = Math.PI;
                group.add(keeper.root, you.root);
                const entity = layer.add({ object: group, lng: sc.data.origin.lng, lat: sc.data.origin.lat, heading: sc.data.facing, scaleBy: 0.01 });
                sceneView = { id: sc.id, entity, you, keeper };
              } catch {
                sceneView = null; // a model this broadcast can't build: just the caption
              }
            } else if (!sc && sceneView) dropSceneView();
            followed.entity.object.visible = !sceneView;
            if (sc && sceneView) {
              const grow = Math.min(1, (T - sc.start) / 700), shrink = sc.end !== null ? Math.min(1, Math.max(0, (sc.end - T) / 500)) : 1;
              const ease = (x: number) => x * x * (3 - 2 * x);
              sceneView.entity.scaleBy = SCENE_SCALE * Math.max(0.01, ease(grow) * ease(shrink));
              // The hunter walks in from the door to their place
              const w = Math.min(1, Math.max(0, (T - sc.start - 300) / 1500));
              const { from, to } = sc.data.you;
              sceneView.you.root.position.set(from.x + (to.x - from.x) * w, 0.14, from.z + (to.z - from.z) * w);
              models.animateAvatar(sceneView.you, { mode: "walk", phase: "idle", moving: w > 0 && w < 1 ? 1 : 0, distance: 0.02 }, dt, t / 1000);
              models.animateAvatar(sceneView.keeper, { mode: "walk", phase: "idle", moving: 0, distance: 0 }, dt, t / 1000);
              // The camera looks in (as the game's: a little past the middle of the place, from the street)
              const sz = layer.enlargement() * SCENE_SCALE;
              const z = -sc.data.spots.depth * 0.62, f = sc.data.facing;
              const east = z * Math.sin(f) * sz, south = z * Math.cos(f) * sz;
              const centre = { lng: sc.data.origin.lng + east / (111320 * Math.cos((sc.data.origin.lat * Math.PI) / 180)), lat: sc.data.origin.lat - south / 110574 };
              const k = Math.min(1, 2 * dt);
              const turn = ((geo.compassFromHeading(f + Math.PI) - map.getBearing()) % 360 + 540) % 360 - 180;
              if (map.getMaxZoom() < 20) map.setMaxZoom(20);
              map.jumpTo({
                center: [map.getCenter().lng + (centre.lng - map.getCenter().lng) * k, map.getCenter().lat + (centre.lat - map.getCenter().lat) * k],
                zoom: map.getZoom() + (SCENE_ZOOM - map.getZoom()) * k,
                pitch: map.getPitch() + (SCENE_PITCH - map.getPitch()) * k,
                bearing: map.getBearing() + turn * k,
                // (a game on: the stage on the right, so the place in the space left of it, eased across)
                padding: { top: 0, left: 0, right: (stagePad += ((gameStaged ? Math.min(innerWidth * 0.48, 736) + 16 : 0) - stagePad) * Math.min(1, 3 * dt)), bottom: gameStaged ? 40 : 170 },
              });
            } else {
              // Behind them, turning with them (the laptop's chase camera), tilted like the laptop: 60°.
              const behind = geo.compassFromHeading(p.heading);
              const turn = ((behind - map.getBearing()) % 360 + 540) % 360 - 180;
              const k = Math.min(1, 2.5 * dt);
              map.jumpTo({
                center: [p.lng, p.lat],
                zoom: viewKey !== lastView ? map.getZoom() + (zoom - map.getZoom()) * 0.08 : map.getZoom() + (zoom - map.getZoom()) * Math.min(1, 2 * dt),
                pitch: map.getPitch() + (60 - map.getPitch()) * k,
                bearing: map.getBearing() + turn * k,
                padding: { top: 0, left: 0, right: 0, bottom: 0 },
              });
            }
            // The traffic around them, and why they're slow
            trafficTick(t, motionSkew !== null ? T : Date.now(), p, netFor(h.id, p));
            const why = motionSkew !== null && !sc && !care ? whySlow(h.id, T) : 0;
            if (why !== lastWhy) {
              lastWhy = why;
              setSlowWhy(why);
            }
            // The caption: the last two lines said, in the order they were said, and by whom
            let next: typeof caption = null;
            if (anyScene) {
              const { icon, what } = sceneLabel(anyScene);
              next = {
                icon,
                title: world ? `${h.name} ${what}: ${anyScene.data.title ?? ""}` : (anyScene.data.title ?? `${h.name} ${what}`),
                lines: anyScene.lines
                  .filter((l) => l[0] <= T && (l[1] === "them" || l[1] === "you" || l[1] === "note"))
                  .slice(world ? -1 : -2)
                  .map((l) => ({ who: l[1] === "you" ? h.name : l[1] === "note" ? "" : (anyScene.data.keeperName ?? ""), text: l[2], you: l[1] === "you" })),
              };
            }
            const said = JSON.stringify(next);
            if (said !== captionKey) {
              captionKey = said;
              setCaption(next);
            }
            // The question on offer and the reply picked, or the game being played, as they were then
            let card: typeof sceneCard = null;
            if (sc) {
              let ask: { at: number; options: string[]; pick: string | null; pickAt: number | null } | null = null;
              let game: { at: number; game: RoadGame; result: RoadGameResult | null; live: RoadGameLive } | null = null;
              let them: { at: number; len: number; text: string } | null = null; // what was last said to them
              for (const l of sc.lines) {
                if (l[0] > T) break;
                if (l[1] === "them") them = { at: l[0], len: String(l[2]).length, text: String(l[2]) };
                if (l[1] === "ask") {
                  const options = parse<string[]>(l[2]);
                  if (options) ask = { at: l[0], options, pick: null, pickAt: null };
                } else if (l[1] === "pick" && ask) {
                  ask.pick = l[2];
                  ask.pickAt = l[0];
                }
                else if (l[1] === "game") {
                  const g = parse<RoadGame>(l[2]);
                  if (g) game = { at: l[0], game: g, result: null, live: {} };
                } else if (l[1] === "result" && game) game.result = parse<RoadGameResult>(l[2]);
                else if (l[1] === "live" && game) game.live = parse<RoadGameLive>(l[2]) ?? game.live; // their moves, as they made them
                else if (l[1] === "move" && game) {
                  // Their move as sent to be judged (a game played on an older page, which sends no moves as it goes): the
                  // cards they turned, the cup, the chess move
                  const g = game.game;
                  if (g.type === "pairs") game.live = { flips: parse<number[]>(l[2]) ?? game.live.flips ?? [] };
                  else if (g.type === "cups" && /^d$/.test(l[2])) game.live = { ...game.live, picked: Number(l[2]) };
                  else if (g.type === "chess" && /^[a-h][1-8][a-h][1-8]/.test(l[2])) game.live = { ...game.live, played: l[2].slice(0, 4) };
                }
              }
              if (game && (!ask || game.at >= ask.at)) {
                // Its clock, as theirs: from when it can be played (the cups: once the shuffle's done)
                const g = game.game;
                const readyAt = game.at + (g.type === "cups" ? 1500 + g.swaps.length * g.ms : 0);
                const total = gameSeconds(g);
                const shuffling = T < readyAt;
                const left = game.result ? null : shuffling ? total : Math.max(0, Math.ceil((readyAt + total * 1000 - T) / 1000));
                card = { kind: "game", who: h.name, game: game.game, result: game.result, live: game.live, left, total, shuffling };
              }
              else if (ask) {
                // The question and its replies in one card (owner, 14 Nov 2026: "In the street quiz, the question should
                // not have a separate window from the option, both should be one"), in place of the caption (owner, 13 Nov:
                // "one after the other, like the user's page"): from when it's asked; the one picked a moment, at least
                // long enough to read the question (the pick may already be known: the broadcast plays a few seconds behind).
                const a = ask;
                const picked = a.pickAt ?? sc.lines.find((l) => l[1] === "pick" && l[0] >= a.at)?.[0] ?? null;
                const q = them && them.at <= a.at + 500 ? them : null; // what they were asked
                const from = Math.max(a.at, q?.at ?? a.at);
                const readFor = q ? Math.min(7000, 2500 + q.len * 45) : 3500;
                const till = picked !== null ? Math.max(picked + 2500, from + readFor) : Infinity;
                if (T >= from && T < till)
                  card = { kind: "ask", who: h.name, options: a.options, pick: a.pickAt !== null && T >= a.pickAt ? a.pick : null, question: q?.text ?? null, asker: sc.data.keeperName ?? "" };
              }
            }
            if (world) {
              // A box's puzzle, as they have it: the board, the time left, how far they've got, and how it ended
              type Opened = { at: number; n: number; kind: string; puzzle: unknown; seconds: number; progress: number; result: { right?: boolean; late?: boolean; outcome?: string | null } | null; endedAt: number | null };
              let open: Opened | null = null;
              for (const l of world.lines) {
                if (l[0] > T) break;
                if (l[1] === "puzzle") {
                  const p = parse<{ n: number; kind: string; puzzle: unknown; seconds: number }>(l[2]);
                  if (p) open = { at: l[0], ...p, progress: 0, result: null, endedAt: null };
                } else if (l[1] === "progress" && open && !open.endedAt) open.progress = Number(l[2]) || 0;
                else if (l[1] === "result" && open) {
                  open.result = parse<{ right?: boolean; late?: boolean; outcome?: string | null }>(l[2]);
                  if (open.result?.right || open.result?.late) open.endedAt = l[0];
                }
              }
              // Shown while it's open, and a few seconds after it ends
              if (open && (!open.endedAt || T - open.endedAt < 5000)) {
                // What they'd put in by then
                let answers: Record<string, unknown> | null = null;
                for (const [at, n, a] of ((world.data as { board?: [number, number, Record<string, unknown>][] }).board ?? [])) if (at <= T && n === open.n) answers = a;
                card = {
                  answers,
                  kind: "puzzle",
                  who: h.name,
                  n: open.n,
                  puzzleKind: open.kind,
                  puzzle: open.puzzle,
                  left: Math.max(0, Math.ceil(open.seconds - ((open.endedAt ?? T) - open.at) / 1000)),
                  progress: open.result?.right ? 1 : open.progress,
                  result: open.result,
                };
              }
            }
            gameStaged = card?.kind === "game";
            const cardNow = JSON.stringify(card);
            if (cardNow !== cardKey) {
              cardKey = cardNow;
              setSceneCard(card);
            }
          }
        } else {
          followPos = null;
          if (followed) {
            layer.remove(followed.entity);
            followed = null;
          }
          dropSceneView();
          clearTraffic();
          if (careVan) {
            layer.remove(careVan.entity);
            careVan = null;
          }
          dropJailCell();
          dropPoliceCar();
          dropTrainCars();
          dropChase();
          dropHelper();
          dropParked();
          dropRestBike();
          if (weatherKey) {
            weatherKey = "";
            setWeatherShown(null);
          }
          trail = null;
          if (careKey) {
            careKey = "";
            setCareNote(null);
          }
          if (worldShown) {
            worldShown = null;
            setKeyWorld(null);
          }
          if (lastWhy !== 0) {
            lastWhy = 0;
            setSlowWhy(0);
          }
          if (captionKey !== "null") {
            captionKey = "null";
            setCaption(null);
          }
          if (cardKey !== "null") {
            cardKey = "null";
            setSceneCard(null);
          }
          // Keep everyone in shot.
          if (viewKey !== lastView || t - lastFit > 8000) {
            lastFit = t;
            const points = s.hunters.map((h) => shown.get(h.id)).filter((p): p is { lng: number; lat: number; heading: number } => !!p);
            for (const d of s.domes) points.push({ lng: d.lng, lat: d.lat, heading: 0 });
            if (points.length) {
              const bounds = new LngLatBounds();
              points.forEach((p) => bounds.extend([p.lng, p.lat]));
              const phone = window.innerWidth < 640;
              map.fitBounds(bounds, { padding: phone ? { top: 100, bottom: 150, left: 70, right: 70 } : { top: 90, bottom: 110, left: 60, right: 260 }, maxZoom: 15, pitch: 45, bearing: 0, duration: 2000 });
            }
          }
        }
        lastView = viewKey;
      };

      map.on("load", () => {
        styleMapForGame(map);
        {
          const styleLayers = map.getStyle().layers;
          let lastRoad = -1;
          styleLayers.forEach((l, i) => {
            if (l.type === "line" && /^(road|bridge|tunnel)_/.test(l.id)) lastRoad = i;
          });
          const firstSymbol = styleLayers.slice(lastRoad + 1).find((l) => l.type === "symbol")?.id;
          const firstRoad = styleLayers.find((l) => l.type === "line" && /^(road|bridge|tunnel)_/.test(l.id))?.id;
          if (firstRoad && map.getLayer("building")) map.moveLayer("building", firstRoad);
          map.addSource("b-night", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } } });
          map.addLayer({ id: "b-night-ground", type: "fill", source: "b-night", paint: { "fill-color": "#0B1630", "fill-opacity": 0 } }, firstRoad);
          map.addLayer({ id: "b-night-dim", type: "fill", source: "b-night", paint: { "fill-color": "#0B1630", "fill-opacity": 0 } }, firstSymbol);
        }
        map.addSource("b-traffic", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "b-traffic",
          type: "line",
          source: "b-traffic",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["match", ["get", "jam"], 2, "#D62828", "#F28C28"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 6, 20, 9],
            "line-opacity": 0.9,
          },
        });
        map.addSource("b-domes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "b-domes-fill", type: "fill", source: "b-domes", paint: { "fill-color": "#9B5DE5", "fill-opacity": 0.22 } });
        map.addLayer({ id: "b-domes-edge", type: "line", source: "b-domes", paint: { "line-color": "#C89BFF", "line-width": 3 } });
        map.addLayer(layer);
        frame = requestAnimationFrame(loop);
      });

      cleanup = () => {
        cancelAnimationFrame(frame);
        for (const m of markers.values()) m.marker.remove();
        window.clearInterval(pollTimer);
        window.clearInterval(autoTimer);
        window.clearTimeout(bannerTimer);
        window.clearInterval(motionTimer);
        map.remove();
      };
    })().catch(() => setFailed(true));
    return () => {
      disposed = true;
      cleanup();
    };
  }, [huntId]);

  if (failed) {
    return <div className="flex h-dvh items-center justify-center bg-ink p-6 text-center">Couldn&apos;t start the broadcast. Check you&apos;re signed in as the owner.</div>;
  }

  const hunt = state?.hunt;
  const following = view.kind === "follow" ? state?.hunters.find((h) => h.id === view.id) : null;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-map">
      {/* The key's place the followed hunter is at: their own arrangement of it, them walking where they walked (step 3) */}
      {keyWorld && (
        <div className="absolute inset-0 z-10" aria-label="The key's place">
          <KeyWorldView key={keyWorld.id} data={keyWorld.data} look={keyWorld.look} playback={keyWorld.playback} />
        </div>
      )}
      {/* The weather where the followed hunter is (owner, 9 Nov 2026): drawn as on their screen, and a chip */}
      {weatherShown && view.kind === "follow" && (
        <>
          {(weatherShown.kind === "rain" || weatherShown.kind === "storm") && (
            <div className={`loota-rain pointer-events-none absolute inset-0 z-[5] ${weatherShown.kind === "storm" ? "loota-storm" : weatherShown.heavy ? "loota-rain-heavy" : ""}`} aria-hidden="true" />
          )}
          {weatherShown.kind === "fog" && <div className="loota-fog pointer-events-none absolute inset-0 z-[5]" aria-hidden="true" />}
          {weatherShown.kind === "cloudy" && <div className="loota-cloud pointer-events-none absolute inset-0 z-[5]" aria-hidden="true" />}
          {weatherShown.kind === "snow" && <div className="loota-snow pointer-events-none absolute inset-0 z-[5]" aria-hidden="true" />}
          <div className="pointer-events-none absolute left-4 top-28 z-20" role="status" aria-label="Weather">
            <span className="flex items-center gap-2 rounded-full bg-ink/85 px-3 py-1.5 text-sm font-bold text-paper shadow-xl">
              <span aria-hidden="true">{weatherIcon(weatherShown, weatherShown.night)}</span>
              {weatherWords(weatherShown)} where {weatherShown.who} is{weatherShown.temp != null ? ` · ${Math.round(weatherShown.temp)}°C` : ""}
              {weatherShown.slowed && <span className="text-gold">· {weatherShown.kind === "storm" ? "30" : "20"}% slower on foot or bike</span>}
            </span>
          </div>
        </>
      )}
      {/* The followed hunter fainted: the ambulance, the ride, the ward (owner, 9 Nov 2026) */}
      {chaseShown && view.kind === "follow" && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2" role="status" aria-label="Police chase" data-chase-shown={chaseShown.status} data-chase-stars={chaseShown.stars}>
          <div className={`flex flex-col items-center gap-0.5 rounded-2xl px-5 py-2 text-white shadow-xl ring-2 ${chaseShown.status === "caught" ? "bg-danger ring-white/40" : chaseShown.status === "escaped" || chaseShown.status === "called_off" ? "bg-[#1E9E62] ring-white/40" : "bg-ink/95 ring-[#3D7BFF]"}`}>
            <p className="flex items-center gap-2 text-lg font-extrabold">
              <span className="tracking-widest text-[#FF4D4D]">
                {"★".repeat(chaseShown.stars)}
                <span className="text-white/25">{"★".repeat(3 - chaseShown.stars)}</span>
              </span>
              {chaseShown.status === "caught"
                ? `🚔 ${chaseShown.who} is caught!`
                : chaseShown.status === "escaped"
                  ? `🏁 ${chaseShown.who} lost the police!`
                  : chaseShown.status === "called_off"
                    ? `🏁 The police gave up: ${chaseShown.who} got away`
                    : `🚨 The police are after ${chaseShown.who}`}
            </p>
            {(chaseShown.status === "seen" || chaseShown.status === "unseen" || chaseShown.status === "hiding") && (
              <p className="text-sm font-bold text-gold">
                {chaseShown.status === "hiding"
                  ? `🫥 Hiding in ${chaseShown.hiding}… they're searching the streets`
                  : chaseShown.status === "unseen"
                    ? "👀 Out of their sight: they're searching where they last saw them"
                    : `They can see them${chaseShown.gap !== null ? ` · ${chaseShown.gap} m behind` : ""}`}
              </p>
            )}
          </div>
        </div>
      )}
      {careNote && !chaseShown && view.kind === "follow" && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2" role="status" aria-label="Fainted">
          <span className="flex items-center gap-2 rounded-full bg-danger px-4 py-2 text-base font-extrabold text-white shadow-xl">{careNote}</span>
        </div>
      )}
      {/* Why the hunter followed is slow just now (owner, 9 Nov 2026) */}
      {slowWhy > 0 && view.kind === "follow" && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2" role="status" aria-label="Why they're slow">
          <span className={`flex items-center gap-2 rounded-full px-4 py-2 text-base font-extrabold shadow-xl ${slowWhy === 2 ? "bg-[#F28C28] text-ink" : "bg-danger text-white"}`}>
            {slowWhy === 1 ? "🚦 Red light: waiting for green" : slowWhy === 3 ? "🚗 Go-slow: the traffic has stopped" : "🚗 Slow traffic"}
          </span>
        </div>
      )}
      {/* A box's puzzle or a road game, as the hunter has it: on one side, beside the hunter (owner, 12 Nov 2026: "If it is
          a game, can it show one side like the 3d world"); the caption stays below, clear of it */}
      {sceneCard && caption && sceneCard.kind === "game" && (
        // A roadside game: the stage (owner, 13 Nov 2026: "The game could be bigger because that is the only event
        // happening for the user, so let viewers enjoy it see the time countdown and they feel the thrill"): big, beside
        // the hunter, its clock counting down; the talk hidden meanwhile ("it is not useful, since the user is already
        // playing")
        <div className="pointer-events-none absolute bottom-5 right-4 top-[104px] z-20 flex w-[min(48vw,46rem)] justify-end" role="status" aria-label="Scene card" data-card-side data-game-stage>
          <div className="flex h-full w-full flex-col overflow-hidden rounded-3xl bg-ink/92 p-5 text-paper shadow-2xl ring-2 ring-gold/80">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gold">{caption.icon} {GAME_NAMES[sceneCard.game.type] ?? "A game"} · with {caption.title.split(":")[0]}</p>
                <p className="mt-1 font-display text-2xl font-extrabold leading-tight" data-game-status>
                  {sceneCard.result
                    ? sceneCard.result.won && !sceneCard.result.late
                      ? `✓ ${sceneCard.who} wins ${sceneCard.result.reward} coins!`
                      : sceneCard.result.late
                        ? `✗ Out of time: ${sceneCard.who} loses this one`
                        : `✗ ${sceneCard.who} loses this one`
                    : sceneCard.shuffling
                      ? `👀 ${sceneCard.who} is watching the shuffle…`
                      : `🎲 ${sceneCard.who} is playing…`}
                </p>
              </div>
              {sceneCard.left !== null && (
                <span
                  className={`shrink-0 rounded-2xl px-3 py-1.5 font-mono text-3xl font-extrabold tabular-nums ${sceneCard.left <= 10 && !sceneCard.shuffling ? "animate-pulse bg-danger text-white" : "bg-ink-2 text-gold"}`}
                  aria-label={`${sceneCard.left} seconds left`}
                  data-game-left={sceneCard.left}
                >
                  ⏱ {sceneCard.left}s
                </span>
              )}
            </div>
            <div className="mb-3 mt-2 h-2.5 overflow-hidden rounded-full bg-ink-2" aria-hidden="true">
              <div
                className={`h-full transition-[width] duration-500 ${sceneCard.result ? (sceneCard.result.won && !sceneCard.result.late ? "bg-[#3DD68C]" : "bg-danger") : (sceneCard.left ?? 0) <= 10 ? "bg-danger" : "bg-gold"}`}
                style={{ width: `${sceneCard.result ? 100 : Math.round((100 * (sceneCard.left ?? 0)) / Math.max(1, sceneCard.total))}%` }}
              />
            </div>
            <FitBox grow={2.4}>
              <div className="w-[19rem]">
                <RoadGameBoard game={sceneCard.game} result={sceneCard.result} mirror={sceneCard.live} onMove={() => {}} />
              </div>
            </FitBox>
          </div>
        </div>
      )}
      {sceneCard && caption && sceneCard.kind === "puzzle" && (
        <div
          className="pointer-events-none absolute right-4 top-[104px] z-20 flex items-start justify-end" // under the leaderboard
          style={{ bottom: `calc(${captionH}px + 2rem)` }}
          role="status"
          aria-label="Scene card"
          data-card-side
        >
          <div className="flex max-h-full w-[20rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-ink/92 p-4 text-paper shadow-2xl ring-2 ring-gold/70">
            {sceneCard.kind === "puzzle" ? (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-xs font-extrabold uppercase tracking-widest text-gold">
                    {sceneCard.result?.right
                      ? `✓ ${sceneCard.who} opened ${boxLabel(sceneCard.n)}${sceneCard.result.outcome ? `: ${sceneCard.result.outcome === "key" ? "the key!" : sceneCard.result.outcome === "lock" ? "on to the next lock" : sceneCard.result.outcome}` : ""}`
                      : sceneCard.result?.late
                        ? `⏳ ${sceneCard.who}: too slow, the lock jams`
                        : `${sceneCard.who} · ${boxLabel(sceneCard.n)} · ${PUZZLE_NAMES[sceneCard.puzzleKind as keyof typeof PUZZLE_NAMES]?.name ?? "A puzzle"}`}
                  </p>
                  {!sceneCard.result?.right && !sceneCard.result?.late && <span className="rounded-full bg-ink-2 px-2 py-0.5 font-mono text-sm font-extrabold text-gold">⏱ {sceneCard.left}s</span>}
                </div>
                <div className="h-2 overflow-hidden rounded bg-ink-2" aria-label="How far they've got">
                  <div className={`h-full transition-[width] duration-500 ${sceneCard.result?.right ? "bg-[#3DD68C]" : "bg-gold"}`} style={{ width: `${Math.round(sceneCard.progress * 100)}%` }} />
                </div>
                {sceneCard.result && !sceneCard.result.right && !sceneCard.result.late && <p className="mt-1 text-xs font-bold text-danger">✗ Not quite: they look again</p>}
                <p className="my-2 text-xs text-paper/75">{PUZZLE_NAMES[sceneCard.puzzleKind as keyof typeof PUZZLE_NAMES]?.rule}</p>
                <FitBox>
                  <div style={{ zoom: 0.62 }}>
                    <AnswerMirror.Provider value={{ shown: sceneCard.answers }}>
                      <PuzzleBoard key={sceneCard.n} kind={sceneCard.puzzleKind} puzzle={sceneCard.puzzle} disabled onDone={() => {}} />
                    </AnswerMirror.Provider>
                  </div>
                </FitBox>
              </>
            ) : null}
          </div>
        </div>
      )}
      {/* At the bottom, one after the other (owner, 12 Nov 2026: "the conversation box, plus the interaction box, is mixed
          up together"): the replies on offer and the one picked, then the caption below it, like TV's lower third */}
      {caption && sceneCard?.kind !== "game" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex flex-col items-center gap-3 px-4" data-lower-third>
          {sceneCard?.kind === "ask" ? (
            <div ref={captionBox} className="w-full max-w-2xl rounded-2xl bg-ink/92 px-4 py-3 text-paper shadow-2xl ring-2 ring-gold/70" role="status" aria-label="Scene card">
              <p className="mb-1 text-xs font-extrabold uppercase tracking-widest text-gold">
                {caption.icon} {sceneCard.pick ? `${sceneCard.who} chose` : `${sceneCard.who} is choosing…`}
              </p>
              {sceneCard.question && (
                <p className="mb-2 text-lg leading-snug" data-ask-question>
                  {sceneCard.asker && <b className="text-gold">{sceneCard.asker}: </b>}
                  {sceneCard.question}
                </p>
              )}
              <div className="grid gap-1.5 sm:grid-cols-3">
                {sceneCard.options.map((o) => (
                  <span
                    key={o}
                    className={`rounded-xl px-3 py-1.5 text-sm font-bold ${o === sceneCard.pick ? "bg-gold text-ink ring-2 ring-paper" : sceneCard.pick ? "bg-ink-2 text-paper/45" : "bg-ink-2 text-paper"}`}
                  >
                    {o === sceneCard.pick ? "👉 " : ""}
                    {o}
                  </span>
                ))}
              </div>
            </div>
          ) : (
          <div ref={captionBox} className="w-full max-w-2xl rounded-2xl bg-ink/92 px-5 py-3 text-paper shadow-2xl ring-1 ring-gold/60" role="status" aria-label="Scene caption">
            <p className="text-xs font-extrabold uppercase tracking-widest text-gold">
              {caption.icon} {caption.title}
            </p>
            {caption.lines.map((l, i) => (
              <p key={i} className={`mt-1 leading-snug ${l.you ? "text-base text-paper/85" : "text-lg"}`}>
                {l.who && <b className={l.you ? "" : "text-gold"}>{l.who}: </b>}
                {l.text}
              </p>
            ))}
          </div>
          )}
        </div>
      )}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>

      {/* The title strip: small chips, icon-first (owner, 3 Nov 2026: "the screen is practically cover… we can use
          icons or make the font size small") */}
      {hunt && (
        <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-5rem)] flex-col items-start gap-1 sm:max-w-[min(32rem,calc(100%-17rem))]">
          <div className="flex max-w-full items-center gap-2 rounded-xl bg-ink/85 px-2.5 py-1.5 text-paper shadow">
            {hunt.phase === "live" ? (
              <span className="flex shrink-0 items-center gap-1 rounded bg-danger px-1.5 py-0.5 text-[10px] font-extrabold tracking-widest text-white">
                <span className="size-1.5 animate-pulse rounded-full bg-white" /> LIVE
              </span>
            ) : (
              <span className="shrink-0 rounded bg-line px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest">{hunt.phase}</span>
            )}
            <LootaLogo height={18} tone="gold" />
            <h1 className="truncate font-display text-sm font-extrabold">{hunt.title}</h1>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-1 text-[11px] font-bold text-paper">
            <span className="rounded-lg bg-ink/80 px-2 py-0.5" title="Keys">🗝 {hunt.keys}</span>
            <span className="rounded-lg bg-ink/80 px-2 py-0.5" title="Hunters">👥 {state?.hunters.length ?? 0}</span>
            {hunt.phase === "live" && <span className="rounded-lg bg-ink/80 px-2 py-0.5" title="Time left">⏱ {timeLeft(hunt.endsAt, now)}</span>}
            <span className="max-w-[14rem] truncate rounded-lg bg-ink/80 px-2 py-0.5" title={`Prize: ${hunt.prize} · ${hunt.winners} ${hunt.winners === 1 ? "winner" : "winners"}`}>
              🏆 {hunt.prize}
            </span>
            {state?.domes.map((d) => (
              <span key={d.id} className="rounded-lg bg-[#3A1E5C]/90 px-2 py-0.5" title={`${d.raisedBy ?? "Someone"}'s dome`}>
                🔒 Key {d.key} · {timeLeft(d.endsAt, now)} · {d.attackers}/{d.needed}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard (tap a name to follow them; 🏆 folds it away) */}
      {state && (
        <div className="absolute right-3 top-3 flex w-[13.5rem] flex-col items-end gap-1 text-paper">
          <button
            type="button"
            onClick={() => setBoard((b) => !b)}
            aria-expanded={board}
            aria-label="Leaderboard"
            className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-extrabold shadow ${board ? "bg-ink/85" : "bg-gold text-ink"}`}
          >
            🏆 <span className="hidden sm:inline">Leaderboard</span>
          </button>
          {board && (
            <ol className="flex w-full flex-col gap-0.5 rounded-xl bg-ink/85 p-1.5 shadow">
              {state.hunters.length === 0 && <li className="px-1.5 py-1 text-xs text-paper/70">No hunters yet.</li>}
              {state.hunters.slice(0, 5).map((h, i) => (
                <li key={h.id}>
                  <button
                    type="button"
                    disabled={h.place != null}
                    title={h.place != null ? "Finished: roaming freely, off the show" : undefined}
                    onClick={() => {
                      setAuto(false);
                      setView({ kind: "follow", id: h.id });
                    }}
                    className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs ${following?.id === h.id ? "bg-gold text-ink" : "hover:bg-ink-2"}`}
                  >
                    <span className="w-4 shrink-0 font-bold opacity-70">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-bold">{h.name}</span>
                    {h.inTrial && <span className="shrink-0 rounded bg-[#9B5DE5] px-1 text-[9px] font-extrabold text-white">TRIAL</span>}
                    {state.jails?.some((j) => j.userId === h.id && !j.out) && <span className="shrink-0 rounded bg-[#2F6FEB] px-1 text-[9px] font-extrabold text-white" data-cell-tag>🚔 CELL</span>}
                    <span className="shrink-0 font-mono text-[11px] tracking-tighter">{h.place ? `🏁 ${ordinal(h.place)}` : `🗝 ${h.keysHeld}/${state.hunt.keys}`}</span>
                  </button>
                </li>
              ))}
              {state.hunters.length > 5 && <li className="px-1.5 pt-0.5 text-[10px] text-paper/60">+ {state.hunters.length - 5} more hunters</li>}
            </ol>
          )}
        </div>
      )}

      {/* What just happened: a short banner under the title strip */}
      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center px-4">
          <p className="max-w-xl animate-[pulse_1.2s_ease-in-out_2] rounded-2xl bg-gold px-4 py-2 text-center font-display text-sm font-extrabold text-ink shadow-xl sm:text-lg">
            {banner.text}
          </p>
        </div>
      )}

      {/* Ticker: the last few moments, small */}
      {state && state.events.length > 0 && (
        <div className="pointer-events-none absolute bottom-10 left-3 right-28 flex flex-col items-start gap-0.5 sm:right-auto sm:max-w-[60%]">
          {state.events.slice(0, 3).map((e, i) => (
            <p key={eventKey(e)} className={`max-w-full truncate rounded-lg px-2.5 py-1 text-paper ${i === 0 ? "bg-ink/90 text-xs font-bold sm:text-sm" : "bg-ink/70 text-[11px]"}`}>
              <span className="mr-1.5 text-paper/60">{ago(e.at, now)}</span>
              {e.text}
            </p>
          ))}
        </div>
      )}

      {/* Controls: icons (H hides them) */}
      {controls && (
        <div className="absolute bottom-10 right-3 flex flex-col items-end gap-1.5">
          {following && <span className="max-w-[12rem] truncate rounded-lg bg-ink/85 px-2 py-0.5 text-[11px] font-bold text-paper">Following {following.name}</span>}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setAuto(false);
                setView({ kind: "field" });
              }}
              aria-label="Whole field"
              title="Whole field"
              className={`flex size-10 items-center justify-center rounded-xl text-lg shadow ${view.kind === "field" && !auto ? "bg-gold" : "bg-ink/85"}`}
            >
              🗺
            </button>
            <button
              type="button"
              onClick={() => setAuto((a) => !a)}
              aria-label={auto ? "Auto camera: on" : "Auto camera: off"}
              aria-pressed={auto}
              title={`Auto camera ${auto ? "on" : "off"} · H hides the controls`}
              className={`flex size-10 items-center justify-center rounded-xl text-lg shadow ${auto ? "bg-gold" : "bg-ink/85"}`}
            >
              🎬
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { LootaLogo } from "@/components/Logo";
import { normalizeLook } from "@/lib/avatar";
import { ordinal } from "@/game/hunt";
import { baseSpeed, type Mode } from "@/game/movement";
import { alongPath, cumulativeOf, trainAlong, trainZoom } from "@/game/transit";
import { foldAttribution } from "@/game/attribution";
import { nextAutoView } from "@/game/autocam";
import { RoadGameBoard, type RoadGame, type RoadGameResult } from "@/components/game/RoadGames";
import { PuzzleBoard } from "@/components/game/puzzles/PuzzleTrial";
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
  /** The device they play on now (claim_session): positions from any other are ignored. */
  session?: string | null;
};
type Dome = { id: string; lng: number; lat: number; radiusM: number; endsAt: string; key: number; raisedBy: string | null; needed: number; attackers: number };
type ShowEvent = { at: string; kind: string; who: string | null; whoId: string | null; text: string };
/** A hunter's bus, train, taxi or plane under way: where it goes and when (its path thinned by the server). */
type Trip = { userId: string; mode: string; from: string; to: string; departsAt: string; arrivesAt: string; path: [number, number][] };
type State = {
  hunt: { id: string; title: string; prize: string; winners: number; startsAt: string; endsAt: string; phase: string; keys: number };
  hunters: Hunter[];
  domes: Dome[];
  events: ShowEvent[];
  trips?: Trip[];
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
export function BroadcastMap({ huntId }: { huntId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State | null>(null);
  const [view, setView] = useState<View>({ kind: "field" });
  const [auto, setAuto] = useState(true);
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
    | { kind: "ask"; who: string; options: string[]; pick: string | null }
    | { kind: "game"; who: string; game: RoadGame; result: RoadGameResult | null }
    | { kind: "puzzle"; who: string; n: number; puzzleKind: string; puzzle: unknown; left: number; progress: number; result: { right?: boolean; late?: boolean; outcome?: string | null } | null }
    | null
  >(null);
  /** The key's place the followed hunter is at (step 3): their own arrangement, played from their track. */
  const [keyWorld, setKeyWorld] = useState<{ id: number; data: KeyWorldData; look: unknown; playback: { current: { T: number; track: WorldTrack; inner: InnerRoomView[] | null; dug: string | null } } } | null>(null);
  /** Why the followed hunter is slow just now: 1 a red light, 2 slow traffic, 3 a go-slow (from their motion). */
  const [slowWhy, setSlowWhy] = useState(0);
  const [caption, setCaption] = useState<{ icon: string; title: string; lines: { who: string; text: string; you: boolean }[] } | null>(null);
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
        attributionControl: { compact: true },
      });
      foldAttribution(map);

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
      // Read here by a light poll (no Realtime) and played MOTION_DELAY_MS behind, like live TV: by then the keyframes on
      // either side are already here, so they glide between them, exactly where they were, never corrected. Hunters
      // without a way (standing, the key's place): their saved spots, along the roads (follow.ts).
      const MOTION_DELAY_MS = 6000;
      const MOTION_POLL_MS = 1500;
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
        const seen = new Set<string>();
        for (const m of r.hunters) {
          seen.add(m.id);
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
        for (const sc of r.scenes ?? []) scenes.set(sc.id, sc);
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
        Object.assign(window, { __broadcastShown: () => ({ ...Object.fromEntries(shown), drawnAt, drawnWall, trips: [...routes.keys()], moving: [...motions.keys()], zoom: map.getZoom(), delay: MOTION_DELAY_MS, scene: sceneView ? { id: sceneView.id, scale: sceneView.entity.scaleBy } : null, keyWorld: worldShown?.id ?? null, slowWhy: lastWhy, lights: [...lightModels.keys()].length, scenes: [...scenes.values()].map((sc) => ({ id: sc.id, start: sc.start, end: sc.end, lines: sc.lines.length, title: sc.data.title ?? null })), T: motionSkew !== null ? drawnWall + motionSkew - MOTION_DELAY_MS : null }), __broadcastMap: map });
      }
      let drawnAt = 0; // the last frame's time
      let drawnWall = Date.now(); // …by the wall clock
      // Trips under way, by hunter: the route (continuous) and its length along the way, measured once.
      let skew = 0; // the server's clock minus this one
      const routes = new Map<string, { key: string; trip: Trip; path: [number, number][]; cum: number[] }>();
      const tripOf = (id: string) => routes.get(id) ?? null;
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
      const freshLive = (id: string) => {
        const l = live.get(id);
        return !!l && Date.now() - l.at < LIVE_FRESH_MS;
      };
      // ---- The show's state, every few seconds; new events make a banner.
      const seen = new Set<string>();
      let first = true;
      async function poll() {
        const { data, error } = await supabase.rpc("broadcast_state", { p_hunt: huntId });
        if (disposed) return;
        if (error || !data) {
          if (first) setFailed(true);
          return;
        }
        latest = data as State;
        setState(latest);
        if (latest.now) skew = Date.parse(latest.now) - Date.now();
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
        // Saved spots, for hunters not heard live just now (and not on a trip: their saved spot is where it began).
        for (const h of latest.hunters) if (h.lng != null && h.lat != null && !freshLive(h.id) && !going.has(h.id)) heard(h.id, h.lng, h.lat);
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
        pace: number; // metres a second it moves on screen, smoothed (its stride)
        entity: import("@/game/ThreeMapLayer").MapEntity;
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
        builtThisFrame = false;
        // Every hunter where they were a moment ago, between the positions heard; on a trip, where the trip is.
        const serverNow = drawnWall + skew;
        for (const h of s.hunters) {
          // On a trip: where the game says the bus, train or plane is (it sends that live, by its own timetable of
          // stops, lights and jams); only without that, along the route by the clock.
          const r = tripOf(h.id);
          // (with their motion, the vehicle as on their screen, below; without it, along its line by the clock)
          if (r && !motions.has(h.id)) {
            const at = tripAt(r, serverNow);
            shown.set(h.id, { lng: at.lng, lat: at.lat, heading: at.heading });
            continue;
          }
          // Going along their way: where they were MOTION_DELAY_MS ago, between the keyframes either side
          const mo = motions.get(h.id);
          const mw = ways.get(h.id);
          if (mo && mw && mw.id === mo.way && motionSkew !== null) {
            const T = drawnWall + motionSkew - MOTION_DELAY_MS;
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
          const inScene = motionSkew !== null ? sceneAt(h.id, drawnWall + motionSkew - MOTION_DELAY_MS) : null;
          const slow = motionSkew !== null ? whySlow(h.id, drawnWall + motionSkew - MOTION_DELAY_MS) : 0;
          const label = r
            ? `${icon} ${h.name} → ${r.trip.to}`
            : inScene
              ? `${sceneLabel(inScene).icon} ${h.name} · ${sceneLabel(inScene).what}`
              : `${h.name} · ${h.keysHeld}/${s.hunt.keys}${slow === 1 ? " · 🚦" : slow ? " · 🚗" : ""}`;
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
        if (v.kind === "follow") {
          const h = s.hunters.find((x) => x.id === v.id);
          const p = h ? shown.get(h.id) : null;
          const r = h ? tripOf(h.id) : null;
          const ride = r ? r.trip.mode : null;
          if (h && p) {
            followPos = { lng: p.lng, lat: p.lat };
            // As the hunter's own laptop shows them: walking or on their own bicycle, motorbike or car, the hunter in
            // 3D; on a bus, train, taxi or plane, that vehicle as the game draws it.
            const key = ride ? `${h.id}:${ride}` : h.id;
            if (!followed || followed.id !== key) {
              if (followed) layer.remove(followed.entity);
              const avatar = ride ? null : models.buildAvatar(normalizeLook(h.look));
              const plane = ride === "plane" ? models.makePlane() : null;
              const object = plane ? plane.group : ride === "taxi" ? models.makeTaxi() : ride === "train" ? models.makeTrainCar(true) : ride ? models.makeBus() : avatar!.root;
              object.add(layer.billboard(models.makeNameplate(h.name, "#F4B41A")));
              followed = { id: key, avatar, plane, pace: 0, entity: layer.add({ object, lng: p.lng, lat: p.lat, heading: p.heading, scaleBy: ride === "train" ? 0.8 : plane ? 0.45 : undefined }) };
            }
            const before = { lng: followed.entity.lng, lat: followed.entity.lat };
            followed.entity.lng = p.lng;
            followed.entity.lat = p.lat;
            followed.entity.heading = p.heading;
            const stepM = geo.distanceM([before.lng, before.lat], [p.lng, p.lat]);
            const mode = live.get(h.id)?.mode ?? h.mode ?? "walk";
            // Its stride by their speed, smoothed: a frame without a step doesn't drop it to standing (which looked like
            // turning back); it comes to a stand only once they've really stopped.
            followed.pace += ((dt > 0 ? stepM / dt : 0) - followed.pace) * Math.min(1, 4 * dt);
            const moving = followed.pace < 0.4 ? 0 : Math.min(1, followed.pace / baseSpeed(mode as Mode));
            if (followed.avatar) models.animateAvatar(followed.avatar, { mode, phase: "idle", moving, distance: stepM / layer.enlargement() }, dt, t / 1000);
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
            const T = motionSkew !== null ? drawnWall + motionSkew - MOTION_DELAY_MS : 0;
            const anyScene = motionSkew !== null && !ride ? sceneAt(h.id, T) : null;
            const world = anyScene?.data.kind === "keyworld" ? anyScene : null;
            const sc = world ? null : anyScene; // a scene built at the kerb
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
                padding: { top: 0, left: 0, right: 0, bottom: 170 },
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
            const why = motionSkew !== null && !sc ? whySlow(h.id, T) : 0;
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
              let ask: { at: number; options: string[]; pick: string | null } | null = null;
              let game: { at: number; game: RoadGame; result: RoadGameResult | null } | null = null;
              for (const l of sc.lines) {
                if (l[0] > T) break;
                if (l[1] === "ask") {
                  const options = parse<string[]>(l[2]);
                  if (options) ask = { at: l[0], options, pick: null };
                } else if (l[1] === "pick" && ask) ask.pick = l[2];
                else if (l[1] === "game") {
                  const g = parse<RoadGame>(l[2]);
                  if (g) game = { at: l[0], game: g, result: null };
                } else if (l[1] === "result" && game) game.result = parse<RoadGameResult>(l[2]);
              }
              if (game && (!ask || game.at >= ask.at)) card = { kind: "game", who: h.name, game: game.game, result: game.result };
              else if (ask) card = { kind: "ask", who: h.name, options: ask.options, pick: ask.pick };
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
                card = {
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
      {/* Why the hunter followed is slow just now (owner, 9 Nov 2026) */}
      {slowWhy > 0 && view.kind === "follow" && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2" role="status" aria-label="Why they're slow">
          <span className={`flex items-center gap-2 rounded-full px-4 py-2 text-base font-extrabold shadow-xl ${slowWhy === 2 ? "bg-[#F28C28] text-ink" : "bg-danger text-white"}`}>
            {slowWhy === 1 ? "🚦 Red light: waiting for green" : slowWhy === 3 ? "🚗 Go-slow: the traffic has stopped" : "🚗 Slow traffic"}
          </span>
        </div>
      )}
      {/* The question or game in the scene, as the hunter has it: the replies on offer and the one picked, or the board */}
      {sceneCard && caption && (
        <div
          className={
            sceneCard.kind === "puzzle"
              ? "pointer-events-none absolute bottom-[110px] right-4 top-4 z-20 flex items-start justify-end" // beside the hunter, not over them
              : "pointer-events-none absolute inset-x-0 bottom-[150px] z-20 flex justify-center px-4"
          }
          role="status"
          aria-label="Scene card"
        >
          <div className={`rounded-2xl bg-ink/92 p-4 text-paper shadow-2xl ring-2 ring-gold/70 ${sceneCard.kind === "puzzle" ? "max-h-full w-[20rem] overflow-hidden" : "w-full max-w-xl"}`}>
            {sceneCard.kind === "puzzle" ? (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-xs font-extrabold uppercase tracking-widest text-gold">
                    {sceneCard.result?.right
                      ? `✓ ${sceneCard.who} opened Box ${sceneCard.n}${sceneCard.result.outcome ? `: ${sceneCard.result.outcome === "key" ? "the key!" : sceneCard.result.outcome}` : ""}`
                      : sceneCard.result?.late
                        ? `⏳ ${sceneCard.who}: too slow, the lock jams`
                        : `${sceneCard.who} · Box ${sceneCard.n} · ${PUZZLE_NAMES[sceneCard.puzzleKind as keyof typeof PUZZLE_NAMES]?.name ?? "A puzzle"}`}
                  </p>
                  {!sceneCard.result?.right && !sceneCard.result?.late && <span className="rounded-full bg-ink-2 px-2 py-0.5 font-mono text-sm font-extrabold text-gold">⏱ {sceneCard.left}s</span>}
                </div>
                <div className="h-2 overflow-hidden rounded bg-ink-2" aria-label="How far they've got">
                  <div className={`h-full transition-[width] duration-500 ${sceneCard.result?.right ? "bg-[#3DD68C]" : "bg-gold"}`} style={{ width: `${Math.round(sceneCard.progress * 100)}%` }} />
                </div>
                {sceneCard.result && !sceneCard.result.right && !sceneCard.result.late && <p className="mt-1 text-xs font-bold text-danger">✗ Not quite: they look again</p>}
                <p className="my-2 text-xs text-paper/75">{PUZZLE_NAMES[sceneCard.puzzleKind as keyof typeof PUZZLE_NAMES]?.rule}</p>
                <div style={{ zoom: 0.62 }}>
                  <PuzzleBoard kind={sceneCard.puzzleKind} puzzle={sceneCard.puzzle} disabled onDone={() => {}} />
                </div>
              </>
            ) : sceneCard.kind === "ask" ? (
              <>
                <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-gold">{sceneCard.pick ? `${sceneCard.who} chose` : `${sceneCard.who} is choosing…`}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {sceneCard.options.map((o) => (
                    <span
                      key={o}
                      className={`rounded-xl px-3 py-2 text-sm font-bold ${o === sceneCard.pick ? "bg-gold text-ink ring-2 ring-paper" : sceneCard.pick ? "bg-ink-2 text-paper/45" : "bg-ink-2 text-paper"}`}
                    >
                      {o === sceneCard.pick ? "👉 " : ""}
                      {o}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-gold">
                  {sceneCard.result ? (sceneCard.result.won && !sceneCard.result.late ? `✓ ${sceneCard.who} wins it` : `✗ ${sceneCard.who} loses this one`) : `🎲 ${sceneCard.who} is playing…`}
                </p>
                <RoadGameBoard game={sceneCard.game} result={sceneCard.result} locked={false} onMove={() => {}} />
              </>
            )}
          </div>
        </div>
      )}
      {/* A scene's caption, like TV's lower third: what it is, what was last said and by whom */}
      {caption && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4" role="status" aria-label="Scene caption">
          <div className="w-full max-w-2xl rounded-2xl bg-ink/92 px-5 py-3 text-paper shadow-2xl ring-1 ring-gold/60">
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
                    onClick={() => {
                      setAuto(false);
                      setView({ kind: "follow", id: h.id });
                    }}
                    className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs ${following?.id === h.id ? "bg-gold text-ink" : "hover:bg-ink-2"}`}
                  >
                    <span className="w-4 shrink-0 font-bold opacity-70">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-bold">{h.name}</span>
                    {h.inTrial && <span className="shrink-0 rounded bg-[#9B5DE5] px-1 text-[9px] font-extrabold text-white">TRIAL</span>}
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

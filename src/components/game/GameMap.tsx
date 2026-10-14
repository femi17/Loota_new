"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { lookForId, type AvatarLook } from "@/lib/avatar";
import type { LngLat } from "@/game/geo";
import { canSprint, type Mode } from "@/game/movement";
import { PICKUP_RADIUS_M, RELICS, type Lead, type RelicId, type WorldItem } from "@/game/items";
import { MEAL_ENERGY, MEAL_PRICE, VEHICLES, type VehicleKind } from "@/game/economy";
import { BagPanel } from "./BagPanel";
import { VehiclePanel, type OwnedVehicle } from "./VehiclePanel";
import { HuntPanel, type HuntActions } from "./HuntPanel";
import type { SearchResult } from "@/game/hunt";
import type { Place } from "@/game/places";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData, type RoadCellFile } from "@/game/roadData";
import { PlaceSearch } from "./PlaceSearch";
import { highwayRoute, loadHighways } from "@/game/highways";
import { LandmarkPanel, type CheckinQuestion, type CheckinResult, type Landmark, type LandmarkActions } from "./LandmarkPanel";
import { TransitPanel, type TaxiQuote, type TransitActions, type TransitNear, type TransitQuote } from "./TransitPanel";
import {
  BUS_RANGE_M,
  COACH_RANGE_M,
  DRIVER_SPEED,
  TRANSIT,
  TRAIN_CARS,
  alongPath,
  clock,
  cumulativeOf,
  flightPath,
  sliceLine,
  thinPath,
  transitFare,
  transitSpeedFor,
  transitWaitS,
  type TransitStop,
  type Trip as TransitTrip,
} from "@/game/transit";

type Hud = {
  energy: number;
  speedKmh: number;
  mode: Mode;
  hint: string;
  alert: boolean;
  coins: number;
  relics: number;
  leads: number;
  /** Closest find: distance, and arrow angle relative to the screen (0 = straight ahead). */
  nearest: { metres: number; angle: number } | null;
  /** Turn waiting for the next junction: −1 left, +1 right. */
  turn: -1 | 0 | 1;
  /** What you're riding: fuel and engine (motor vehicles you own), tyres (your bicycle), and the rental meter. */
  vehicle: { kind: VehicleKind; source: "owned" | "rented"; fuel: number | null; tyre: number | null; engine: number | null; meter: string | null } | null;
  /** Names of the petrol station and place to eat within reach, if any. */
  services: { fuel: string | null; food: string | null };
  /** Name of the street the hunter is on, if it has one. */
  street: string | null;
  /** A purchase or vehicle change is on its way to the server. */
  busy: boolean;
  /** Turn-by-turn directions, while the player has a destination. */
  guide: Guide | null;
  /** Other hunters seen nearby (live). */
  hunters: number;
  /** Radar (while active): seconds left, and which way to the nearest relic and, on a Final Approach, the key. */
  radar: { secondsLeft: number; relic: Pointer | null; key: Pointer | null } | null;
  /** It's raining where the hunter is (a Rain Charm); `slowed` if it slows them. */
  rain: { slowed: boolean } | null;
  /**
   * The Lockdown dome nearest the hunter, if any: minutes left, whether they're
   * inside (free to move), and, when they're at its edge outside, the siege.
   */
  dome: { minutesLeft: number; key: number; inside: boolean; mine: boolean; siege: { attackers: number; needed: number } | null } | null;
  /** On a bus, train or plane (or waiting for one). */
  ride: { icon: string; title: string; status: string; canCancel: boolean } | null;
  /** At a bus stop, station or airport: what the Transport button offers. */
  stopHere: { icon: string; label: string } | null;
  /** What can be done where the player stands: eat, rest, refuel, kegs, tyres, repairs. */
  actions: { id: LimitAction; label: string }[];
  /** A warning that needs acting on (tired, fuel low, soft tyres, a worn engine), with the nearest place that helps. */
  advice: { key: string; text: string; place: { name: string; lng: number; lat: number } | null } | null;
  /** Being looked after: the ambulance, the hospital, a mechanic on the way. */
  care: { icon: string; title: string; status: string } | null;
  /** The fuel keg the player carries, if any. */
  keg: { fuel: number; usesLeft: number } | null;
  /** At a landmark (within its check-in area): what checking in would pay. */
  landmarkHere: { landmark: Landmark; canTry: boolean } | null;
  /** A rental waiting at a bus stop, or a taxi on its way: where, how far, and the button once there. */
  pickup: { icon: string; title: string; status: string; action: string | null } | null;
};

/** Things a player can do at a place or by their vehicle (see computeActions in GameMap). */
type LimitAction = "eat" | "rest" | "refuel" | "buy_keg" | "fill_keg" | "pour_keg" | "pump" | "service" | "mechanic";

/** A direction and rough distance (bearing: compass degrees). */
type Pointer = { bearing: number; metres: number };

/** What a hunter announces to others in the same area, about once a second while moving. */
type HunterUpdate = {
  id: string;
  name: string;
  look: AvatarLook;
  lng: number;
  lat: number;
  heading: number;
  mode: Mode;
  moving: boolean;
};

/** Areas for live positions (~2.2 km); each hunter listens to theirs and the 8 around it. */
const LIVE_AREA_DEG = 0.02;
const liveArea = (lng: number, lat: number) => ({ ax: Math.floor(lng / LIVE_AREA_DEG), ay: Math.floor(lat / LIVE_AREA_DEG) });

/** What the directions banner shows: the next turn, and the trip as a whole. */
type Guide = {
  /** Arrow rotation in degrees (0 = straight on, negative = left). */
  arrow: number;
  /** "In 40 m, turn left onto Ricca Street" */
  step: string;
  /** "To National Theatre · 1.2 km · about 12 minutes" */
  trip: string;
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SAVE_EVERY_MS = 4000;
/** The one zoom level the game is played at (a few streets around the hunter); players can't change it. */
const GAME_ZOOM = 17;

/** A button that reports while it's held down (mouse, touch or pen). */
function HoldButton({
  onHold,
  className,
  label,
  children,
}: {
  onHold: (down: boolean) => void;
  className: string;
  label?: string;
  children: ReactNode;
}) {
  const set = (e: ReactPointerEvent<HTMLButtonElement>, down: boolean) => {
    e.currentTarget.dataset.down = String(down);
    onHold(down);
  };
  return (
    <button
      type="button"
      aria-label={label}
      className={`touch-none select-none ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e, true);
      }}
      onPointerUp={(e) => set(e, false)}
      onPointerCancel={(e) => set(e, false)}
      onLostPointerCapture={(e) => set(e, false)}
      onContextMenu={(e: ReactMouseEvent) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/**
 * The live 3D map: the player's hunter steered along real roads, directions
 * to a chosen place, the chase camera, and saving position to the server.
 */
export function GameMap({
  playerId,
  username,
  look,
  start,
  startMode,
  initialCoins,
  huntId,
}: {
  playerId: string;
  username: string;
  look: AvatarLook;
  start: LngLat;
  startMode: Mode;
  initialCoins: number;
  /** The hunt the player has joined, if any. */
  huntId: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef({ go: false, sprint: false });
  const actions = useRef<{
    vehicles: () => OwnedVehicle[];
    ride: (kind: VehicleKind, how: "own" | "rent" | "buy") => void;
    getOff: () => void;
    walkTo: (vehicle: OwnedVehicle) => void;
    refuel: () => void;
    eat: () => void;
    /** Use a relic from the bag; resolves to a message for the bag. */
    useRelic: (id: string) => Promise<string>;
    /** Attack the dome the hunter is standing at the edge of. */
    attackDome: () => void;
    follow: () => void;
    turn: (dir: -1 | 1) => void;
    /** False when not allowed (a motor vehicle on a one-way street). */
    turnAround: () => boolean;
    endDirections: () => void;
    where: () => LngLat;
    goTo: (place: Place) => void;
    /** Get off a bus, train or plane that hasn't left yet (fare refunded). */
    cancelTrip: () => void;
    /** Do something where the player stands (eat, rest, refuel, kegs, tyres, repairs). */
    act: (id: LimitAction) => void;
    /** Directions to the place a warning points to, or dismiss the warning. */
    followAdvice: () => void;
    dismissAdvice: () => void;
    /** Get in the taxi, or ride off on the rented bike, once there. */
    pickupAction: () => void;
    cancelPickup: () => void;
  } | null>(null);
  const huntActions = useRef<HuntActions | null>(null);
  const [failed, setFailed] = useState(false);
  const [hud, setHud] = useState<Hud>({
    energy: 100,
    speedKmh: 0,
    mode: startMode,
    hint: "",
    alert: false,
    coins: initialCoins,
    relics: 0,
    leads: 0,
    nearest: null,
    turn: 0,
    vehicle: null,
    services: { fuel: null, food: null },
    street: null,
    busy: false,
    guide: null,
    hunters: 0,
    radar: null,
    rain: null,
    dome: null,
    ride: null,
    stopHere: null,
    actions: [],
    advice: null,
    care: null,
    keg: null,
    pickup: null,
    landmarkHere: null,
  });
  const [bagOpen, setBagOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [garage, setGarage] = useState<OwnedVehicle[] | null>(null); // the Vehicles panel, when open
  const [transitOpen, setTransitOpen] = useState(false);
  const [transitActions, setTransitActions] = useState<TransitActions | null>(null); // set once the map is ready
  const [landmarkActions, setLandmarkActions] = useState<LandmarkActions | null>(null);
  const [landmarksOpen, setLandmarksOpen] = useState<{ quiz: CheckinQuestion | null; message: string | null } | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  /** The Check in button: ask the server for a question (once), then show it. */
  const checkIn = async (landmark: Landmark) => {
    if (!landmarkActions || checkingIn) return;
    setCheckingIn(true);
    const q = await landmarkActions.start(landmark);
    setCheckingIn(false);
    setLandmarksOpen(typeof q === "string" ? { quiz: null, message: q } : { quiz: q, message: null });
  };

  const lookKey = JSON.stringify(look);
  const startLng = start.lng;
  const startLat = start.lat;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      // Map and 3D code only ever run in the browser.
      const [{ Map: MapLibre, setWorkerUrl }, geo, movement, models, roads, { ThreeMapLayer }, { fetchRoute }, { createClient }, { styleMapForGame }, directions] =
        await Promise.all([
          import("maplibre-gl"),
          import("@/game/geo"),
          import("@/game/movement"),
          import("@/game/models3d"),
          import("@/game/roads"),
          import("@/game/ThreeMapLayer"),
          import("@/game/routing"),
          import("@/lib/supabase/client"),
          import("@/game/mapStyle"),
          import("@/game/directions"),
        ]);
      if (disposed || !container.current) return;
      // Served from public/ by scripts/copy-map-worker.mjs (the bundler doesn't serve MapLibre's worker).
      setWorkerUrl("/maplibre-gl-worker.mjs");

      const supabase = createClient();
      const small = window.matchMedia("(max-width: 600px)").matches;
      // Mouse and keyboard, or touch: the hints describe the controls the player has.
      const traveller = movement.createTraveller({ lng: startLng, lat: startLat }, startMode);

      const map = new MapLibre({
        container: container.current,
        style: MAP_STYLE,
        center: [startLng, startLat],
        zoom: GAME_ZOOM,
        pitch: small ? 55 : 60,
        bearing: geo.compassFromHeading(traveller.heading),
        maxPitch: 70,
        dragPan: false, // dragging looks around the hunter instead (see "Look around" below)
        dragRotate: false,
        touchPitch: false,
        // Everyone plays at the same zoom: no wheel, double-click or pinch zooming.
        scrollZoom: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        minZoom: GAME_ZOOM,
        maxZoom: GAME_ZOOM,
        keyboard: false, // the keyboard drives the hunter instead
        attributionControl: { compact: true },
      });

      const layer = new ThreeMapLayer(() => traveller.pos, small ? 40 : 32);
      const avatar = models.buildAvatar(JSON.parse(lookKey) as AvatarLook);
      avatar.root.add(layer.billboard(models.makeNameplate("YOU", "#2F6FEB")));
      const me = layer.add({ object: avatar.root, lng: startLng, lat: startLat, heading: traveller.heading });
      const marker = models.makeDestinationMarker();
      const destination = layer.add({ object: marker.group, lng: startLng, lat: startLat });

      // Messages show for a few seconds, then get out of the way.
      let hintTimer = 0;
      const say = (hint: string, alert = false, stay = false) => {
        setHud((h) => ({ ...h, hint, alert }));
        window.clearTimeout(hintTimer);
        if (stay) return; // e.g. "Finding a route…" until the route arrives
        hintTimer = window.setTimeout(() => setHud((h) => (h.hint === hint ? { ...h, hint: "" } : h)), alert ? 9000 : 5000);
      };
      const showRoute = (coords: [number, number][] | null) => {
        const source = map.getSource("route") as import("maplibre-gl").GeoJSONSource | undefined;
        source?.setData(
          coords
            ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }
            : { type: "FeatureCollection", features: [] },
        );
      };

      let camBearing = geo.compassFromHeading(traveller.heading);
      let lookOffset = 0; // degrees the player has turned the view by dragging
      let dragging = false;

      // ---- Travel on roads (the player always steers) ---------------------
      let network: import("@/game/roads").RoadNetwork | null = null;
      let onRoad: import("@/game/roads").RoadPosition | null = null;
      // Straight on by default, or a left/right turn waiting for the next junction.
      let pendingTurn: -1 | 0 | 1 = 0;
      let justPassed: import("@/game/roads").PassedJunction | null = null;
      let lastNetworkCheck = 0;
      let lastDeadEndCheck = 0;

      let builtFrom = ""; // what the current network was built from, to skip rebuilding the same thing

      // Our own road squares (exact junctions and street names), loaded around
      // the hunter. Where there are none (outside the areas we host), the
      // roads come from the map's drawing tiles instead.
      const roadSquares = new Map<string, RoadCellData | "loading" | "none">();
      const ROADS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/roads/${ROAD_DATA_VERSION}`;
      const ROAD_REACH_M = 1600; // the network covers 1.5 km around the hunter
      let snapReachM = 400; // how far the hunter may be put onto the nearest road (more just after landing)

      /** The squares within reach of the hunter, loading any not yet asked for. */
      function squaresAround(): string[] {
        const { lng, lat } = traveller.pos;
        const dLat = ROAD_REACH_M / 110574;
        const dLng = ROAD_REACH_M / (111320 * Math.cos((lat * Math.PI) / 180));
        const keys: string[] = [];
        for (let ix = Math.floor((lng - dLng) / ROAD_CELL_DEG); ix <= Math.floor((lng + dLng) / ROAD_CELL_DEG); ix++) {
          for (let iy = Math.floor((lat - dLat) / ROAD_CELL_DEG); iy <= Math.floor((lat + dLat) / ROAD_CELL_DEG); iy++) {
            const key = roadCellKey(ix, iy);
            keys.push(key);
            void ensureSquare(key);
          }
        }
        return keys;
      }

      const squareLoads = new Map<string, Promise<void>>();
      function ensureSquare(key: string) {
        let load = squareLoads.get(key);
        if (!load) {
          load = loadSquare(key);
          squareLoads.set(key, load);
        }
        return load;
      }

      async function loadSquare(key: string) {
        roadSquares.set(key, "loading");
        try {
          const res = await fetch(`${ROADS_URL}/${key}.json.gz`);
          if (!res.ok || !res.body) throw new Error(String(res.status));
          const file = (await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).json()) as RoadCellFile;
          roadSquares.set(key, decodeRoadCell(file));
        } catch {
          roadSquares.set(key, "none"); // not hosted (or offline): use the drawing tiles here
        }
        if (!disposed) lastNetworkCheck = 0; // rebuild with it on the next frame
      }

      /** (Re)build the roads around the hunter; `ifChanged` skips it when nothing new has loaded. */
      function buildRoads(ifChanged = false) {
        const keys = squaresAround();
        const states = keys.map((k) => roadSquares.get(k));
        const own = states.filter((st): st is RoadCellData => typeof st === "object");
        const waiting = states.includes("loading");
        let source: string;
        let features: import("@/game/roads").RoadFeature[] = [];
        if (own.length && !waiting) source = `own:${keys.join(",")}:${traveller.mode}`;
        else if (waiting && network && onRoad) return true; // keep the current roads until the squares arrive
        else {
          features = map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" }) as import("@/game/roads").RoadFeature[];
          if (!features.length) return false;
          source = `tiles:${features.length}:${traveller.mode}`;
        }
        const near = network && geo.distanceM([network.centre.lng, network.centre.lat], [traveller.pos.lng, traveller.pos.lat]) < 300;
        if (ifChanged && near && onRoad && source === builtFrom) return true;
        builtFrom = source;
        if (container.current) container.current.dataset.roads = source.split(":")[0]; // "own" or "tiles", for checking
        // Keep facing the way the player chose on the road (e.g. just turned round), not the way the body still points.
        const facing = network && onRoad ? roads.positionOf(network, onRoad).heading : traveller.heading;
        network = source.startsWith("own:")
          ? roads.buildNetworkFromCells(own, traveller.mode, traveller.pos)
          : roads.buildNetwork(features, traveller.mode, traveller.pos);
        onRoad = roads.snapToNetwork(network, traveller.pos, facing);
        if (!onRoad) return false;
        const p = roads.positionOf(network, onRoad);
        if (geo.distanceM([traveller.pos.lng, traveller.pos.lat], [p.lng, p.lat]) > snapReachM) {
          // Only far-away roads loaded so far (e.g. just thrown out of a trial): wait for nearer tiles.
          onRoad = null;
          return false;
        }
        traveller.pos = { lng: p.lng, lat: p.lat };
        snapReachM = 400;
        return true;
      }

      const setTurn = (turn: -1 | 0 | 1) => {
        pendingTurn = turn;
        setHud((h) => ({ ...h, turn }));
      };

      // ---- Directions: a route to follow, turn by turn ----------------------
      // The route is only guidance: the player steers (only buses, trains and
      // planes will carry a player by themselves).
      type Trip = {
        to: LngLat;
        name: string;
        route: import("@/game/geo").Route;
        turns: import("@/game/directions").Maneuver[];
        segment: number; // where on the route the player was last seen (to search near it)
        offSince: number; // when the player left the route (0 = on it)
        straight: boolean; // routing was unavailable: just a straight line to the place
        plannedAt: number;
        streets: Map<number, string | null>; // street names after each turn, looked up once
      };
      let trip: Trip | null = null;
      let planId = 0;

      async function planDirections(to: LngLat, name: string, quiet = false) {
        const id = ++planId;
        // Nearby places on the loaded roads: the shortest way, straight away.
        let route: import("@/game/geo").Route | null = null;
        let forks: { index: number; side: -1 | 1 }[] = [];
        let fallback = false;
        if (network && onRoad) {
          const path = roads.findPath(network, onRoad, to);
          if (path) {
            route = geo.buildRoute(path);
            forks = roads.findForks(network, path);
          }
        }
        // Farther away: our own roads between here and there.
        if (!route) {
          if (!quiet) say("Finding a route…", false, true);
          const found = await routeOnOwnRoads(traveller.pos, to);
          if (found) {
            route = geo.buildRoute(found.path);
            forks = found.forks;
          }
        }
        // Very far, or outside the areas we host: the routing service (a straight line if that fails).
        if (!route) ({ route, fallback } = await fetchRoute(traveller.pos, to, traveller.mode));
        if (disposed || id !== planId) return;
        const end = route.coords[route.coords.length - 1];
        if (route.total < 30 && geo.distanceM([traveller.pos.lng, traveller.pos.lat], end) < 30) {
          endDirections();
          // The spot may be off the roads (inside a block): this road is then the nearest way to it.
          const Name = `${name[0].toUpperCase()}${name.slice(1)}`;
          say(geo.distanceM([traveller.pos.lng, traveller.pos.lat], [to.lng, to.lat]) < 30 ? `${Name} is right here.` : `You're as close to ${name} as the roads go.`);
          return;
        }
        trip = {
          to,
          name,
          route,
          turns: directions.findManeuvers(route, forks),
          segment: 0,
          offSince: 0,
          straight: fallback,
          plannedAt: performance.now(),
          streets: new Map(),
        };
        destination.lng = end[0];
        destination.lat = end[1];
        marker.group.visible = true;
        showRoute(route.coords);
        if (!quiet) {
          say(
            fallback
              ? `Road directions are unavailable right now. The arrow points to ${name}; steer your own way there.`
              : `Directions to ${name}: ${geo.formatDistance(route.total)}, ${travelTime(route.total)} by ${
                  traveller.mode === "walk" ? "foot" : VEHICLES[traveller.mode].name.toLowerCase()
                }. Follow the blue line.`,
          );
        }
        updateGuide();
      }

      /**
       * The shortest way along our own roads, for trips beyond the roads kept
       * around the hunter: loads the squares between here and there (up to
       * ~25 km across; longer trips are for buses and planes) and searches them.
       */
      async function routeOnOwnRoads(
        from: LngLat,
        to: LngLat,
        mode: Mode = traveller.mode,
      ): Promise<{ path: import("@/game/geo").Coord[]; forks: { index: number; side: -1 | 1 }[] } | null> {
        const MARGIN = 0.01; // ~1 km around the straight line's box, for roads that bend outward
        const x0 = Math.floor((Math.min(from.lng, to.lng) - MARGIN) / ROAD_CELL_DEG);
        const x1 = Math.floor((Math.max(from.lng, to.lng) + MARGIN) / ROAD_CELL_DEG);
        const y0 = Math.floor((Math.min(from.lat, to.lat) - MARGIN) / ROAD_CELL_DEG);
        const y1 = Math.floor((Math.max(from.lat, to.lat) + MARGIN) / ROAD_CELL_DEG);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 30) return null;
        const keys: string[] = [];
        for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) keys.push(roadCellKey(ix, iy));
        await Promise.all(keys.map(ensureSquare));
        const cells = keys.map((k) => roadSquares.get(k)).filter((c): c is RoadCellData => typeof c === "object");
        if (!cells.length || disposed) return null;
        await new Promise((r) => setTimeout(r, 30)); // let "Finding a route…" show before the search
        const centre = { lng: (from.lng + to.lng) / 2, lat: (from.lat + to.lat) / 2 };
        const net = roads.buildNetworkFromCells(cells, mode, centre, Infinity);
        const start = roads.snapToNetwork(net, from, traveller.heading);
        const path = start ? roads.findPath(net, start, to, 300) : null;
        return path ? { path, forks: roads.findForks(net, path) } : null;
      }

      /** Roughly how long a trip takes at the current mode's normal pace. */
      function travelTime(metres: number) {
        const minutes = Math.round(metres / movement.baseSpeed(traveller.mode) / 60);
        return minutes < 1 ? "under a minute" : minutes === 1 ? "about 1 minute" : `about ${minutes} minutes`;
      }

      function endDirections() {
        planId++;
        trip = null;
        marker.group.visible = false;
        showRoute(null);
        setHud((h) => (h.guide ? { ...h, guide: null } : h));
      }

      /** Next turn, distance to it, arrival, and re-planning when the player leaves the route. */
      function updateGuide() {
        if (!trip) return;
        const here = traveller.pos;
        const at = directions.progressOn(trip.route, here, trip.segment);
        trip.segment = at.segment;
        const left = trip.route.total - at.s;
        const end = trip.route.coords[trip.route.coords.length - 1];

        if (geo.distanceM([here.lng, here.lat], end) < 25 || left < 15) {
          const name = trip.name;
          endDirections();
          void savePosition();
          say(`You've arrived at ${name}.`, true);
          return;
        }

        const now = performance.now();
        const cap = (text: string) => text[0].toUpperCase() + text.slice(1);
        const tripLine = `To ${trip.name} · ${geo.formatDistance(left)} · ${travelTime(left)}`;

        // No road route (routing was unavailable): point the way, and try again now and then.
        if (trip.straight) {
          if (now - trip.plannedAt > 30_000) {
            trip.plannedAt = now;
            void planDirections(trip.to, trip.name, true);
          }
          const away = geo.distanceM([here.lng, here.lat], end);
          const arrow = Math.round(geo.compassFromHeading(geo.headingOf([here.lng, here.lat], end)) - camBearing);
          const guide: Guide = { arrow, step: cap(`${trip.name} is ${directions.roundedDistance(away)} that way`), trip: tripLine };
          setHud((h) => (h.guide && h.guide.step === guide.step && h.guide.arrow === guide.arrow ? h : { ...h, guide }));
          return;
        }

        // Off the route for a few seconds: plan again from here.
        if (at.off > 35) {
          if (!trip.offSince) trip.offSince = now;
          else if (now - trip.offSince > 3000 && now - trip.plannedAt > 8000) {
            trip.plannedAt = now;
            say("You left the route, so the directions have been updated.");
            void planDirections(trip.to, trip.name, true);
            return;
          }
        } else trip.offSince = 0;

        const next = directions.nextManeuver(trip.turns, at.s);
        let step: string;
        let arrow = 0;
        if (at.off > 35) {
          step = "Head back to the blue line";
          arrow = Math.round(
            geo.compassFromHeading(geo.headingOf([here.lng, here.lat], [trip.route.coords[at.segment][0], trip.route.coords[at.segment][1]])) -
              camBearing,
          );
        } else if (next && next.s - at.s < left - 10) {
          if (!trip.streets.has(next.s)) {
            // The street name just after the turn: from our own roads when they're
            // loaded there (exact), otherwise from the map's labels.
            const after = geo.pointAt(trip.route, Math.min(trip.route.total, next.s + 15));
            const along = geo.headingOf([next.lng, next.lat], [after.lng, after.lat]);
            let street: string | null | undefined;
            const there = network ? roads.snapToNetwork(network, after, along) : null;
            if (network && there) {
              const p = roads.positionOf(network, there);
              if (geo.distanceM([p.lng, p.lat], [after.lng, after.lat]) < 8) street = roads.streetName(network, there);
            }
            trip.streets.set(next.s, street !== undefined ? street : streetAt(after, along));
          }
          const street = trip.streets.get(next.s);
          step = `In ${directions.roundedDistance(next.s - at.s)}, ${directions.turnWords(next.angle, next.keep)}${street ? ` onto ${street}` : ""}`;
          arrow = Math.round((-next.angle * 180) / Math.PI);
        } else {
          step = cap(`${trip.name} is ${directions.roundedDistance(left)} ahead`);
        }
        const guide: Guide = { arrow, step, trip: tripLine };
        setHud((h) =>
          h.guide && h.guide.step === guide.step && h.guide.trip === guide.trip && h.guide.arrow === guide.arrow ? h : { ...h, guide },
        );
      }

      // ---- Saving position (the server rejects impossible moves) -----------
      let saved = { lng: startLng, lat: startLat };
      let saving = false;
      let lastSave = 0;
      // Tell the server where the hunter starts (a new player has no saved spot until they
      // first move), so domes, rain and radar know where they are straight away.
      void supabase.rpc("save_position", { p_lng: startLng, p_lat: startLat, p_mode: startMode }).then(() => undefined);

      type SaveResult = {
        ok: boolean;
        lng: number;
        lat: number;
        reason?: string;
        mode?: Mode;
        fuel?: number | null;
        tyre?: number | null;
        engine?: number | null;
        energy?: number;
        fainted?: boolean;
        stopped?: "fuel" | "broken" | null;
      };
      /** `force`: save even without having moved (e.g. to have the server confirm a faint). */
      async function savePosition(force = false) {
        if (saving || (!force && geo.distanceM([saved.lng, saved.lat], [traveller.pos.lng, traveller.pos.lat]) < 5)) return;
        saving = true;
        const sent = { ...traveller.pos };
        const { data, error } = await supabase.rpc("save_position", { p_lng: sent.lng, p_lat: sent.lat, p_mode: traveller.mode });
        saving = false;
        if (disposed || error || !data) return;
        const result = data as SaveResult;
        saved = { lng: result.lng, lat: result.lat };
        if (result.ok) {
          onSaved(result);
          return;
        }
        // Go back to the last accepted spot.
        traveller.pos = { ...saved };
        traveller.v = 0;
        if (result.reason === "vehicle" && result.mode) {
          // The server's record of what you're riding wins (e.g. a rental that ended while you were away).
          traveller.mode = result.mode;
          await refreshVehicles();
          say(result.mode === "walk" ? "Your rental has ended, so you're on foot again." : `You're on your ${VEHICLES[result.mode].name.toLowerCase()}.`, true);
        } else if (result.reason === "trip") {
          void resumeTrip();
          return;
        } else if (result.reason === "fainted") {
          faint();
          return;
        } else if (result.reason === "hospital") {
          void loadCondition();
          return;
        } else if (result.reason === "dome") {
          say("A Lockdown dome keeps you out of this key area. Attack it with other hunters at its edge to break it.", true);
        } else {
          say("Your position was corrected to the last valid spot.", true);
        }
        buildRoads();
      }

      const saveOnHide = () => {
        if (document.visibilityState === "hidden") void savePosition();
      };
      document.addEventListener("visibilitychange", saveOnHide);

      // ---- Vehicles: ride, rent or buy; fuel and food ----------------------
      type VehicleRow = {
        kind: VehicleKind;
        fuel: number;
        tyre: number;
        engine: number;
        broken_at: string | null;
        repair_ready_at: string | null;
        lng: number;
        lat: number;
        in_use: boolean;
      };
      let owned: VehicleRow[] = [];
      let rental: { kind: VehicleKind; startedAt: number; rate: number } | null = null;
      let busy = false;
      const parked = new Map<VehicleKind, import("@/game/ThreeMapLayer").MapEntity>();

      const setBusy = (value: boolean) => {
        busy = value;
        setHud((h) => ({ ...h, busy: value }));
      };
      const vehicleName = (kind: VehicleKind) => VEHICLES[kind].name.toLowerCase();
      const ownInUse = () => owned.find((v) => v.in_use) ?? null;
      const meterText = () => {
        if (!rental) return null;
        const minutes = Math.max(1, Math.ceil((Date.now() - rental.startedAt) / 60_000));
        return `${minutes} min · ${minutes * rental.rate} coins`;
      };

      /** Reflect what the player is riding in the display (and push a bicycle with a flat at walking pace). */
      function showVehicle() {
        const kind = traveller.mode === "walk" ? null : (traveller.mode as VehicleKind);
        const mine = ownInUse();
        const fuel = mine && mine.kind !== "bicycle" ? mine.fuel : null;
        const tyre = mine && mine.kind === "bicycle" ? mine.tyre : null;
        const engine = mine && mine.kind !== "bicycle" ? mine.engine : null;
        // A flat tyre: pushing the bicycle at walking pace; soft tyres: a little slower.
        vehicleFactor = tyre === null ? 1 : tyre <= 0 ? movement.MODES.walk.kmh / movement.MODES.bicycle.kmh : tyre < 20 ? 0.85 : 1;
        applySpeed();
        setHud((h) => ({
          ...h,
          mode: traveller.mode,
          vehicle: kind ? { kind, source: rental ? "rented" : "owned", fuel, tyre, engine, meter: meterText() } : null,
        }));
      }

      // What holds the traveller back: soft or flat tyres, and rain (walkers and bikes).
      let vehicleFactor = 1;
      let weatherFactor = 1;
      function applySpeed() {
        traveller.speedFactor = vehicleFactor * (traveller.mode === "walk" || traveller.mode === "bicycle" ? weatherFactor : 1);
      }

      /** New fuel for the vehicle the player is on (a save, a refuel, a Jerry Can relic). */
      function onFuel(fuel: number) {
        const mine = ownInUse();
        if (!mine) return;
        mine.fuel = fuel;
        showVehicle();
      }

      /** Your own vehicles wait where you left them, with a green tag. */
      function showParked() {
        for (const [kind, entity] of [...parked]) {
          if (!owned.some((v) => v.kind === kind && !v.in_use)) {
            layer.remove(entity);
            parked.delete(kind);
          }
        }
        for (const v of owned) {
          if (v.in_use) continue;
          let entity = parked.get(v.kind);
          if (!entity) {
            const model = models.makeVehicleModel(v.kind);
            model.add(layer.billboard(models.makeNameplate(`YOUR ${VEHICLES[v.kind].name.toUpperCase()}`, "#1E9E62")));
            entity = layer.add({ object: model, lng: v.lng, lat: v.lat, heading: 0 });
            parked.set(v.kind, entity);
          }
          entity.lng = v.lng;
          entity.lat = v.lat;
        }
      }

      async function refreshVehicles() {
        const [{ data: vehicles }, { data: rentals }] = await Promise.all([
          supabase.from("player_vehicles").select("kind, fuel, tyre, engine, broken_at, repair_ready_at, lng, lat, in_use"),
          supabase.from("vehicle_rentals").select("kind, started_at").is("ended_at", null),
        ]);
        if (disposed) return;
        owned = (vehicles ?? []) as VehicleRow[];
        const active = rentals?.[0] as { kind: VehicleKind; started_at: string } | undefined;
        rental = active ? { kind: active.kind, startedAt: new Date(active.started_at).getTime(), rate: VEHICLES[active.kind].ratePerMinute } : null;
        showParked();
        showVehicle();
      }

      function afterModeChange() {
        buildRoads(); // cars keep off footpaths, bikes off steps
        if (trip) void planDirections(trip.to, trip.name, true); // and may need a different way there
      }

      async function chooseVehicle(kind: VehicleKind, how: "own" | "rent" | "buy") {
        if (busy || traveller.phase !== "idle") return;
        if (how === "rent") {
          if (kind === "car") {
            setTransitOpen(true); // cars come as taxis
            return;
          }
          // Rent only where the renter is waiting; until then, ask for one.
          const waiting = pickup && pickup.p.kind === kind;
          if (!waiting) {
            await requestBikePickup(kind);
            return;
          }
          if (geo.distanceM([traveller.pos.lng, traveller.pos.lat], [pickup!.p.lng, pickup!.p.lat]) > PICKUP_AT_M) {
            say(`Walk to the renter at ${pickup!.p.name} first (the blue line).`, true);
            return;
          }
        }
        setBusy(true);
        try {
          if (how === "buy") {
            await savePosition(); // it's parked where the server last saw you
            const { data } = await supabase.rpc("buy_vehicle", { p_kind: kind });
            const bought = data as { ok: boolean; reason?: string; balance?: number } | null;
            if (!bought?.ok) {
              say(
                bought?.reason === "coins"
                  ? `You need ${VEHICLES[kind].price.toLocaleString("en-NG")} coins to buy a ${vehicleName(kind)}.`
                  : "Couldn't complete the purchase. Please try again.",
                true,
              );
              return;
            }
            const balance = bought.balance;
            if (balance != null) setHud((h) => ({ ...h, coins: balance }));
            await refreshVehicles();
          }

          const { data } = await supabase.rpc("start_vehicle", {
            p_kind: kind,
            p_lng: traveller.pos.lng,
            p_lat: traveller.pos.lat,
            p_rent: how === "rent",
          });
          const started = data as { ok: boolean; reason?: string; source?: "owned" | "rented"; balance?: number; lng?: number; lat?: number } | null;
          if (!started?.ok) {
            traveller.mode = "walk"; // the server put you on foot
            await refreshVehicles();
            if (started?.reason === "far" && started.lng != null && started.lat != null) {
              const away = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [started.lng, started.lat]);
              void planDirections({ lng: started.lng, lat: started.lat }, `your ${vehicleName(kind)}`, true);
              say(`Your ${vehicleName(kind)} is parked ${geo.formatDistance(away)} away (green tag). Follow the blue line to it, then open Vehicles and ride it.`, true);
            } else if (started?.reason === "coins") say(`Not enough coins to rent a ${vehicleName(kind)}.`, true);
            else if (started?.reason === "fuel") say(`Your ${vehicleName(kind)} has no fuel. Bring fuel in a keg from a petrol station and pour it in.`, true);
            else if (started?.reason === "far_pickup") say("Walk to the renter first: they're waiting at the bus stop.", true);
            else if (started?.reason === "pickup") say(`Ask for a ${vehicleName(kind)} first (Rent in Vehicles): a renter brings one to a bus stop near you.`, true);
            else if (started?.reason === "taxi") say("Cars come as taxis: call one from Taxi, bus, train or plane.", true);
            else if (started?.reason === "broken") say(`Your ${vehicleName(kind)} has broken down. Call a mechanic (the button appears next to it).`, true);
            else if (started?.reason === "repairing") say(`The mechanic is still working on your ${vehicleName(kind)}. Try again in a moment.`, true);
            else say("Couldn't get on. Please try again.", true);
            afterModeChange();
            return;
          }

          traveller.mode = kind;
          saved = { ...traveller.pos };
          if (started.source === "rented") {
            endPickup();
            endDirections();
          }
          const balance = started.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          await refreshVehicles();
          afterModeChange();
          say(
            started.source === "rented"
              ? `You've rented a ${vehicleName(kind)}: ${VEHICLES[kind].ratePerMinute} coins a minute until you get off.`
              : `You're on your ${vehicleName(kind)}.`,
          );
        } finally {
          setBusy(false);
        }
      }

      async function getOff() {
        if (busy || traveller.mode === "walk") return;
        setBusy(true);
        try {
          const kind = traveller.mode as VehicleKind;
          const wasRental = !!rental;
          const { data } = await supabase.rpc("stop_vehicle", { p_lng: traveller.pos.lng, p_lat: traveller.pos.lat });
          const stopped = data as { ok: boolean; charged: number; balance: number } | null;
          if (!stopped?.ok) {
            say("Couldn't get off. Please try again.", true);
            return;
          }
          traveller.mode = "walk";
          saved = { ...traveller.pos };
          setHud((h) => ({ ...h, coins: stopped.balance }));
          await refreshVehicles();
          afterModeChange();
          say(
            wasRental
              ? `Rental returned.${stopped.charged > 0 ? ` ${stopped.charged} more coins for the extra minutes.` : ""}`
              : `You've parked your ${vehicleName(kind)} here. It'll wait for you.`,
          );
        } finally {
          setBusy(false);
        }
      }

      async function refuelHere() {
        if (busy) return;
        setBusy(true);
        try {
          const { data } = await supabase.rpc("refuel");
          const r = data as { ok: boolean; reason?: string; fuel?: number; cost?: number; balance?: number } | null;
          if (!r?.ok) {
            say(r?.reason === "full" ? "Your tank is already full." : r?.reason === "coins" ? "Not enough coins for fuel." : "Couldn't refuel here.", true);
            return;
          }
          const mine = ownInUse();
          if (mine && r.fuel != null) mine.fuel = r.fuel;
          warned.fuel = 100;
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          showVehicle();
          say(`Filled up for ${r.cost} coins.`);
        } finally {
          setBusy(false);
        }
      }

      async function eatHere(place: string) {
        if (busy) return;
        setBusy(true);
        try {
          const { data } = await supabase.rpc("buy_meal");
          const r = data as { ok: boolean; reason?: string; energy?: number; now?: number; balance?: number } | null;
          if (!r?.ok) {
            say(r?.reason === "not_here" ? "Meals are sold at places to eat." : `A meal costs ${MEAL_PRICE} coins. Rest at a chill spot for free instead.`, true);
            return;
          }
          traveller.energy = r.now ?? Math.min(100, traveller.energy + (r.energy ?? MEAL_ENERGY));
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          say(`You ate at ${place}: +${r.energy ?? MEAL_ENERGY} energy.`);
        } finally {
          setBusy(false);
        }
      }


      /**
       * The street the hunter is on, from the map's own street names. The hunter
       * walks on road centre lines, which street names share, so only a name
       * within 10 m can be theirs; one running the way the hunter's road does wins
       * (so a cross street at a junction doesn't).
       */
      function scanStreet() {
        // Our own roads know their names; with the drawing tiles, look the name up nearby.
        const own = network && onRoad ? roads.streetName(network, onRoad) : undefined;
        let street =
          own !== undefined ? own : streetAt(traveller.pos, network && onRoad ? roads.positionOf(network, onRoad).heading : traveller.heading);
        // Many smaller streets have no name in OpenStreetMap yet.
        if (!street && onRoad) street = "Unnamed road";
        setHud((h) => (h.street === street ? h : { ...h, street }));
      }

      /** The name of the street at a spot, for a road running along `along` (a scene heading). */
      function streetAt(pos: LngLat, along: number): string | null {
        const k = Math.cos((pos.lat * Math.PI) / 180);
        const toLocal = ([lng, lat]: number[]) => [(lng - pos.lng) * 111320 * k, (lat - pos.lat) * 110574];
        let street: string | null = null;
        let best = 10;
        for (const f of map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation_name" })) {
          const name = f.properties?.name;
          if (!name) continue;
          const g = f.geometry;
          const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
          for (const line of lines) {
            for (let i = 1; i < line.length; i++) {
              const [ax, ay] = toLocal(line[i - 1]);
              const [bx, by] = toLocal(line[i]);
              if (Math.min(Math.abs(ax), Math.abs(bx)) > 300 && Math.min(Math.abs(ay), Math.abs(by)) > 300) continue;
              const dx = bx - ax;
              const dy = by - ay;
              const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-9)));
              const d = Math.hypot(ax + dx * t, ay + dy * t);
              if (d > 10) continue;
              // Up to 15 m extra for a street at right angles to the hunter's road.
              const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, -dy) - along), Math.cos(Math.atan2(dx, -dy) - along)));
              const score = d + (15 * Math.min(off, Math.PI - off)) / (Math.PI / 2);
              if (score < best) {
                best = score;
                street = String(name);
              }
            }
          }
        }
        return street;
      }

      /** Petrol stations and places to eat within reach, from the map's own points of interest. */
      void refreshVehicles();

      // ---- Things to find while roaming ------------------------------------
      type ItemOnMap = { item: WorldItem; entity: import("@/game/ThreeMapLayer").MapEntity; model: import("@/game/models3d").ItemModel };
      type PickupResult =
        | { ok: false; reason: "gone" | "far" | "position"; lng?: number; lat?: number }
        | { ok: true; kind: "coins" | "cache"; coins: number; balance: number }
        | { ok: true; kind: "relic"; relic: RelicId }
        | { ok: true; kind: "intel"; lead: { lng: number; lat: number } | null };

      const onMap = new Map<string, ItemOnMap>();
      const leadMarkers = new Map<string, import("@/game/ThreeMapLayer").MapEntity>();
      const picking = new Set<string>();
      const retryAfter = new Map<string, number>();
      let lastSync = 0;
      let syncedAt: LngLat | null = null;
      let syncing = false;

      const removeItem = (id: string) => {
        const entry = onMap.get(id);
        if (entry) layer.remove(entry.entity);
        onMap.delete(id);
      };
      const addLead = (id: string, lng: number, lat: number) => {
        if (!leadMarkers.has(id)) leadMarkers.set(id, layer.add({ object: models.makeLeadMarker(), lng, lat }));
      };
      const showLeadCount = () => setHud((h) => ({ ...h, leads: leadMarkers.size }));
      const compassWord = (deg: number) =>
        ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

      /** Fetch what's around the player (the server stocks empty squares on the way). */
      async function syncWorld() {
        if (syncing) return;
        syncing = true;
        try {
          await savePosition(); // the server looks around where it last saw the player
          const res = await fetch("/api/world/nearby", { method: "POST" });
          if (!res.ok || disposed) return;
          const data = (await res.json()) as { items: WorldItem[]; leads: Lead[]; decoysFound: number };
          syncedAt = { ...traveller.pos };

          const visible = new Set(data.items.map((i) => i.id));
          for (const item of data.items) {
            if (onMap.has(item.id)) continue;
            const model = models.makeItemModel(item.kind, item.relic ? RELICS[item.relic].colour : undefined);
            const entity = layer.add({ object: model.group, lng: item.lng, lat: item.lat, scaleBy: item.relic === "lockdown_orb" ? 3.5 : 1.7 });
            onMap.set(item.id, { item, entity, model });
          }
          for (const id of [...onMap.keys()]) if (!visible.has(id) && !picking.has(id)) removeItem(id);

          // The server's list of open leads is the truth (it includes ones just found).
          for (const marker of leadMarkers.values()) layer.remove(marker);
          leadMarkers.clear();
          for (const lead of data.leads) addLead(lead.id, lead.lng, lead.lat);
          showLeadCount();
          if (data.decoysFound > 0) say("Nothing here. That intel scroll was a decoy.", true);
        } catch {
          // Offline or the server is busy: try again on the next sync.
        } finally {
          syncing = false;
        }
      }

      async function pickUp(id: string) {
        const entry = onMap.get(id);
        if (!entry) return;
        picking.add(id);
        const { data, error } = await supabase.rpc("pickup_item", {
          p_item: id,
          p_lng: traveller.pos.lng,
          p_lat: traveller.pos.lat,
          p_mode: traveller.mode,
        });
        picking.delete(id);
        if (disposed) return;
        if (error || !data) {
          retryAfter.set(id, performance.now() + 3000);
          return;
        }
        const result = data as PickupResult;
        if (!result.ok) {
          if (result.reason === "gone") removeItem(id);
          else retryAfter.set(id, performance.now() + 3000);
          return;
        }

        removeItem(id);
        saved = { ...traveller.pos }; // a pickup also saves the player's position
        // An intel lead that pointed here is done.
        for (const [leadId, marker] of [...leadMarkers]) {
          if (geo.distanceM([marker.lng, marker.lat], [entry.item.lng, entry.item.lat]) < 5) {
            layer.remove(marker);
            leadMarkers.delete(leadId);
          }
        }
        showLeadCount();

        if (result.kind === "coins" || result.kind === "cache") {
          const balance = result.balance;
          setHud((h) => ({ ...h, coins: balance }));
          say(result.kind === "cache" ? `You found a hidden coin cache! +${result.coins} coins.` : `+${result.coins} coins`);
        } else if (result.kind === "relic") {
          const relic = RELICS[result.relic];
          setHud((h) => ({ ...h, relics: h.relics + 1 }));
          say(`You found a ${relic.name}! ${relic.effect} It's in your bag for 7 days.`, true);
        } else if (result.kind === "intel" && result.lead) {
          const { lng, lat } = result.lead;
          addLead(`new:${id}`, lng, lat);
          showLeadCount();
          const metres = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [lng, lat]);
          const direction = compassWord(geo.compassFromHeading(geo.headingOf([traveller.pos.lng, traveller.pos.lat], [lng, lat])));
          say(`Intel scroll: something is hidden about ${geo.formatDistance(metres)} ${direction}. Follow the purple beam.`, true);
        } else {
          say("This intel scroll is blank.");
        }
      }

      // Relics count for the bag button (relics with uses left).
      function countRelics() {
        void supabase
          .from("player_relics")
          .select("expires_at")
          .gt("charges", 0)
          .then(({ data }) => {
            if (disposed || !data) return;
            const now = Date.now();
            setHud((h) => ({ ...h, relics: data.filter((r) => new Date(r.expires_at).getTime() > now).length }));
          });
      }
      countRelics();

      // ---- Player actions --------------------------------------------------
      actions.current = {
        vehicles: () =>
          owned.map((v) => ({
            kind: v.kind,
            fuel: v.fuel,
            lng: v.lng,
            lat: v.lat,
            inUse: v.in_use,
            distanceM: geo.distanceM([traveller.pos.lng, traveller.pos.lat], [v.lng, v.lat]),
          })),
        ride: (kind, how) => void chooseVehicle(kind, how),
        getOff: () => void getOff(),
        walkTo(vehicle) {
          void planDirections({ lng: vehicle.lng, lat: vehicle.lat }, `your ${vehicleName(vehicle.kind)}`);
        },
        refuel: () => void refuelHere(),
        eat() {
          void act("eat");
        },
        useRelic: (id) => useRelic(id),
        attackDome: () => void attackDome(),
        turn(dir) {
          // Standing on a junction, or pressed just after going through one: take the turn there.
          if (network && onRoad) {
            const turned =
              roads.turnHere(network, onRoad, dir) ??
              (justPassed && justPassed.metresSince < 30 ? roads.turnAtPassed(network, justPassed, dir) : null);
            if (turned) {
              onRoad = turned;
              justPassed = null;
              setTurn(0);
              return;
            }
          }
          setTurn(pendingTurn === dir ? 0 : dir); // pressing the same way again cancels
        },
        turnAround() {
          if (!onRoad) return false;
          if (network && roads.isOneWay(network, onRoad)) {
            say("This is a one-way street: you can't turn round here. Take the next turn instead.", true);
            return false;
          }
          onRoad = roads.reverse(onRoad);
          justPassed = null;
          setTurn(0);
          return true;
        },
        endDirections,
        follow() {
          lookOffset = 0;
        },
        where: () => ({ ...traveller.pos }),
        cancelTrip: () => void cancelTrip(),
        act: (id) => void act(id),
        followAdvice: () => {
          const place = advicePlace;
          if (place) void planDirections({ lng: place.lng, lat: place.lat }, place.name);
        },
        pickupAction: () => void pickupAction(),
        cancelPickup: () => void cancelPickup(),
        dismissAdvice: () => {
          advicePlace = null;
          setHud((h) => ({ ...h, advice: null }));
        },
        goTo(place) {
          void planDirections({ lng: place.lng, lat: place.lat }, place.name);
        },
      };

      // ---- Hunts: searching where you stand, trials and being thrown out ----
      let frozen = false; // standing still during a Key Trial

      /** Put the hunter at a spot the server has already recorded (e.g. thrown 2 km after a failed trial). */
      function placeAt(lng: number, lat: number) {
        traveller.pos = { lng, lat };
        traveller.v = 0;
        saved = { lng, lat };
        setTurn(0);
        network = null; // rebuilt around the new spot once its map tiles load
        onRoad = null;
        lastNetworkCheck = 0;
        actions.current?.follow();
      }

      huntActions.current = {
        async search(hunt) {
          traveller.v = 0;
          const { data, error } = await supabase.rpc("search_here", {
            p_hunt: hunt,
            p_lng: traveller.pos.lng,
            p_lat: traveller.pos.lat,
            p_mode: traveller.mode,
          });
          if (disposed || error || !data) return null;
          const result = data as SearchResult;
          if (result.ok) saved = { ...traveller.pos }; // searching also saved the position
          else if (result.reason === "position" || result.reason === "thrown") placeAt(result.lng, result.lat);
          return result;
        },
        placeAt,
        setFrozen(value) {
          frozen = value;
          if (value) traveller.v = 0;
        },
        say,
      };

      // Look around: drag sideways to turn the view around the hunter, up or
      // down to tilt it. Moving off brings the view
      // back behind the hunter. A short tap gives directions to that spot.
      //
      // On touch screens the lower part of the screen steers instead: press and
      // hold to walk, swipe left or right to turn, swipe down to turn back.
      const pointers = new Set<number>();
      let drag: { x: number; y: number; offset: number; pitch: number; moved: boolean } | null = null;
      let steer: { id: number; x: number; y: number; turned: boolean; back: boolean; timer: number } | null = null;
      let touchGo = false;
      const STEER_ZONE = 0.55; // touches below this share of the screen height steer
      const stopSteering = () => {
        if (steer) window.clearTimeout(steer.timer);
        steer = null;
        touchGo = false;
      };
      const lookStart = (e: PointerEvent) => {
        pointers.add(e.pointerId);
        if (pointers.size > 1 || e.button !== 0) {
          drag = null;
          dragging = false;
          stopSteering(); // two fingers: not a steer or a look
          return;
        }
        if (e.pointerType === "touch" && e.clientY > window.innerHeight * STEER_ZONE) {
          // Walk once the press is held (a quick swipe only turns).
          const timer = window.setTimeout(() => {
            if (steer) touchGo = true;
          }, 120);
          steer = { id: e.pointerId, x: e.clientX, y: e.clientY, turned: false, back: false, timer };
          return;
        }
        drag = { x: e.clientX, y: e.clientY, offset: lookOffset, pitch: map.getPitch(), moved: false };
      };
      const lookMove = (e: PointerEvent) => {
        if (steer && e.pointerId === steer.id) {
          const dx = e.clientX - steer.x;
          const dy = e.clientY - steer.y;
          if (!steer.turned && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
            steer.turned = true;
            actions.current?.turn(dx > 0 ? 1 : -1);
          } else if (!steer.back && dy > 60 && dy > Math.abs(dx)) {
            steer.back = true;
            if (actions.current?.turnAround() === false) {
              // Not allowed (one-way street in a vehicle): don't carry on forward either.
              window.clearTimeout(steer.timer);
              touchGo = false;
            }
          }
          return;
        }
        if (!drag || !pointers.has(e.pointerId)) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        drag.moved = true;
        dragging = true;
        lookOffset = drag.offset - dx * 0.3;
        map.setPitch(Math.max(25, Math.min(70, drag.pitch - dy * 0.2)));
      };
      let lookedAt = 0; // when the last drag or steering touch ended: the map reports it as a tap too
      const lookEnd = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (steer && e.pointerId === steer.id) {
          stopSteering();
          lookedAt = performance.now(); // steering touches never set a destination
        }
        if (pointers.size) return;
        if (drag?.moved) lookedAt = performance.now();
        drag = null;
        dragging = false;
      };
      const lookArea = map.getCanvasContainer();
      lookArea.style.touchAction = "none"; // swipes steer and look around; the browser must not scroll or cancel them
      lookArea.addEventListener("pointerdown", lookStart);
      window.addEventListener("pointermove", lookMove);
      window.addEventListener("pointerup", lookEnd);
      window.addEventListener("pointercancel", lookEnd);
      map.on("click", (e) => {
        if (performance.now() - lookedAt < 400) return; // the end of a drag, not a tap
        void planDirections({ lng: e.lngLat.lng, lat: e.lngLat.lat }, "the marked spot");
      });
      map.on("error", (e) => {
        if (/style|Failed to fetch/i.test(String(e.error?.message))) say("Couldn't load the map. Check your connection.", true);
      });

      // ---- Relics: using them, radar, and rain ------------------------------
      let radarUntil = 0;
      let radarSeen: { relic: Pointer | null; key: Pointer | null } = { relic: null, key: null };
      let lastRadarPing = 0;
      let lastEffects = 0;
      const effectsSeen = new Set<string>(); // effects already explained to the player

      async function useRelic(id: string): Promise<string> {
        await savePosition(); // rain falls where the server last saw the hunter
        const { data, error } = await supabase.rpc("use_relic", { p_relic: id });
        const r = data as { ok: boolean; reason?: string; relic?: RelicId; energy?: number | null; fuel?: number | null; until?: string | null } | null;
        if (error || !r) return "Couldn't use that relic. Please try again.";
        countRelics();
        if (!r.ok) {
          return (
            {
              passive: "Shields work by themselves: the next rain or traffic effect that would slow you uses one up instead.",
              not_yet: "Fast Pass is for bus waits and check-in queues, which are coming soon. Keep it until then.",
              no_vehicle: "Jerry Can fills your own motorbike or car. Get on it first (Vehicles), then use the can.",
              gone: "That relic has no uses left.",
              position: "Move a little first, then try again.",
              no_hunt: "The Lockdown Orb works during a live hunt you've joined: it locks the area of your current key.",
              final_key: "The Lockdown Orb can't be used on a hunt's final key.",
              dome_up: "A dome is already up in this hunt. Only one at a time.",
            }[r.reason ?? ""] ?? "Couldn't use that relic."
          );
        }
        if (r.relic === "lockdown_orb") {
          lastDomes = 0;
          return "Dome raised over your key area for 20 minutes! Hunters outside can't get in unless enough of them attack it together. The Orb now hides somewhere new.";
        }
        if (r.relic === "second_wind") {
          traveller.energy = Math.min(100, traveller.energy + (r.energy ?? 50));
          return "Second Wind: +50 energy.";
        }
        if (r.relic === "jerry_can" && r.fuel != null) {
          onFuel(r.fuel);
          return `Jerry Can: your tank is at ${Math.round(r.fuel)}%.`;
        }
        if (r.relic === "radar" && r.until) {
          radarUntil = new Date(r.until).getTime();
          lastRadarPing = 0;
          return "Radar on for 5 minutes: follow the arrow to the nearest relic (and, on a hunt's final approach, to the key).";
        }
        if (r.relic === "rain_charm") {
          lastEffects = 0;
          return "Rain Charm: rain over 5 km for 10 minutes. Walkers and bikes in it are slowed (Shields protect them).";
        }
        return "Used.";
      }

      async function pingRadar() {
        const { data } = await supabase.rpc("radar_ping");
        const p = data as { active: boolean; until?: string; relic?: Pointer | null; key?: Pointer | null } | null;
        if (!p || disposed) return;
        if (!p.active) {
          radarUntil = 0;
          return;
        }
        if (p.until) radarUntil = new Date(p.until).getTime();
        radarSeen = { relic: p.relic ?? null, key: p.key ?? null };
      }

      async function checkEffects() {
        await savePosition();
        const { data } = await supabase.rpc("my_effects");
        const effects = (data ?? []) as { id: string; kind: "rain"; endsAt: string; outcome: "slowed" | "shielded" | "limit" | "exempt"; mine: boolean }[];
        if (disposed) return;
        const rain = effects.filter((e) => e.kind === "rain");
        if (rain.some((e) => e.outcome === "shielded" && !effectsSeen.has(e.id))) countRelics(); // a Shield was used up
        const slowed = rain.some((e) => e.outcome === "slowed");
        weatherFactor = slowed ? 0.8 : 1;
        applySpeed();
        setHud((h) => ({ ...h, rain: rain.length ? { slowed } : null }));
        for (const e of rain) {
          if (effectsSeen.has(e.id)) continue;
          effectsSeen.add(e.id);
          const minutes = Math.max(1, Math.round((new Date(e.endsAt).getTime() - Date.now()) / 60000));
          const who = e.mine ? "Your Rain Charm" : "Someone's Rain Charm";
          if (e.outcome === "slowed") say(`${who}: rain here for ${minutes} more min. Walkers and bikes are 20% slower in it.`, true);
          else if (e.outcome === "shielded") say(`${who}: rain here, but your Shield kept you at full speed (it's used up).`, true);
          else if (e.outcome === "limit") say("Rain here, but you've been slowed enough this hour: full speed for you.");
          else say("Rain here, but effects don't apply near a hunt key: full speed.");
        }
      }

      // Lockdown domes near the hunter (fetched every 10 s).
      type Dome = {
        id: string;
        lng: number;
        lat: number;
        radiusM: number;
        endsAt: string;
        needed: number;
        key: number;
        inside: boolean;
        mine: boolean;
        attackers: number;
        entity: import("@/game/ThreeMapLayer").MapEntity;
      };
      const domes = new Map<string, Dome>();
      let lastDomes = 0;
      let lastDomeWarning = 0;
      let lastSiegeHit = 0;

      async function refreshDomes() {
        const { data } = await supabase.rpc("domes_near");
        const list = (data ?? []) as Omit<Dome, "entity">[];
        if (disposed) return;
        if (container.current) container.current.dataset.domes = String(list.length); // for checking
        const seen = new Set(list.map((d) => d.id));
        for (const [id, d] of domes) {
          if (seen.has(id)) continue;
          layer.remove(d.entity);
          domes.delete(id);
          say("A Lockdown dome has come down.");
        }
        for (const d of list) {
          const known = domes.get(d.id);
          if (known) Object.assign(known, d);
          else domes.set(d.id, { ...d, entity: layer.add({ object: models.makeDome(d.radiusM), lng: d.lng, lat: d.lat, scale: 1 }) });
        }
      }

      /** Would moving from `a` to `b` take an outsider into a dome? */
      function domeInTheWay(a: LngLat, b: LngLat) {
        for (const d of domes.values()) {
          if (d.inside || new Date(d.endsAt).getTime() < Date.now()) continue;
          const before = geo.distanceM([a.lng, a.lat], [d.lng, d.lat]);
          const after = geo.distanceM([b.lng, b.lat], [d.lng, d.lat]);
          if (after <= d.radiusM && before > d.radiusM) return d;
        }
        return null;
      }

      /** The dome the hunter is nearest, for the display: inside it, or close enough to its edge to attack. */
      function domeStatus(): Hud["dome"] {
        let best: Dome | null = null;
        let bestGap = Infinity;
        for (const d of domes.values()) {
          const gap = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [d.lng, d.lat]) - d.radiusM;
          if (gap < bestGap) {
            bestGap = gap;
            best = d;
          }
        }
        if (!best || bestGap > 1500) return null;
        const minutesLeft = Math.max(0, Math.ceil((new Date(best.endsAt).getTime() - Date.now()) / 60000));
        const atEdge = !best.inside && bestGap > -5 && bestGap <= 200;
        return {
          minutesLeft,
          key: best.key,
          inside: best.inside,
          mine: best.mine,
          siege: atEdge ? { attackers: best.attackers, needed: best.needed } : null,
        };
      }

      async function attackDome() {
        const now = performance.now();
        if (now - lastSiegeHit < 1000) return;
        lastSiegeHit = now;
        let target: Dome | null = null;
        for (const d of domes.values()) {
          const gap = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [d.lng, d.lat]) - d.radiusM;
          if (!d.inside && gap <= 200) target = d;
        }
        if (!target) return;
        await savePosition(); // the server checks the attacker is at the edge
        const { data } = await supabase.rpc("siege_hit", { p_dome: target.id });
        const r = data as { ok: boolean; reason?: string; broken?: boolean; attackers?: number; needed?: number } | null;
        if (!r || disposed) return;
        if (!r.ok) {
          say(r.reason === "far" ? "Get to the edge of the dome to attack it." : "That dome is already down.");
          if (r.reason === "gone") void refreshDomes();
          return;
        }
        target.attackers = r.attackers ?? target.attackers;
        if (r.broken) {
          say("The dome is broken! The key area is open again.", true);
          void refreshDomes();
        } else {
          say(`Attacking the dome: ${r.attackers} of ${r.needed} hunters attacking together. Keep at it and call others over!`);
        }
      }

      /** Radar, weather and domes, checked now and then. */
      function relicTick(now: number) {
        if (now - lastDomes > 10000) {
          lastDomes = now;
          void refreshDomes();
        }
        if (radarUntil > Date.now() && now - lastRadarPing > 5000) {
          lastRadarPing = now;
          void pingRadar();
        }
        if (now - lastEffects > 20000) {
          lastEffects = now;
          void checkEffects();
        }
      }
      void pingRadar(); // a radar used earlier may still be running

      // ---- Other hunters, live --------------------------------------------
      // Each hunter announces where they are to their area's channel (about
      // once a second while moving, every 8 s standing still) and listens to
      // the areas around them. Positions shown here are for display only; the
      // server still checks every saved move.
      type OtherHunter = {
        entity: import("@/game/ThreeMapLayer").MapEntity;
        avatar: ReturnType<typeof models.buildAvatar>;
        to: { lng: number; lat: number; heading: number };
        mode: Mode;
        moving: boolean;
        seen: number;
      };
      const others = new Map<string, OtherHunter>();
      const areaChannels = new Map<string, import("@supabase/supabase-js").RealtimeChannel>();
      let myArea = "";
      let lastAnnounce = 0;
      const MAX_SHOWN = 25;
      // Hunters in a hunt also announce on the hunt's own channel, which the live
      // show's broadcast screen listens to (a hunt covers a whole city: too many areas).
      const huntChannel = huntId ? supabase.channel(`hunt:${huntId}`, { config: { broadcast: { self: false } } }) : null;
      huntChannel?.subscribe();

      function joinAreas(ax: number, ay: number) {
        const want = new Set<string>();
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) want.add(`${ax + dx}_${ay + dy}`);
        for (const [key, channel] of areaChannels) {
          if (want.has(key)) continue;
          void supabase.removeChannel(channel);
          areaChannels.delete(key);
        }
        for (const key of want) {
          if (areaChannels.has(key)) continue;
          const channel = supabase.channel(`hunters:${key}`, { config: { broadcast: { self: false } } });
          channel.on("broadcast", { event: "pos" }, ({ payload }) => seeHunter(payload as HunterUpdate));
          channel.on("broadcast", { event: "bye" }, ({ payload }) => dropHunter(String((payload as { id: string }).id)));
          // Once connected, announce straight away (the first announcement may have gone out too early).
          channel.subscribe((status) => {
            if (status === "SUBSCRIBED" && key === myArea) lastAnnounce = 0;
          });
          areaChannels.set(key, channel);
        }
      }

      function seeHunter(u: HunterUpdate) {
        if (disposed || u.id === playerId || typeof u.lng !== "number" || typeof u.lat !== "number") return;
        const now = performance.now();
        const known = others.get(u.id);
        if (known) {
          known.to = { lng: u.lng, lat: u.lat, heading: u.heading };
          known.mode = u.mode;
          known.moving = u.moving;
          known.seen = now;
          return;
        }
        if (others.size >= MAX_SHOWN) return;
        lastAnnounce = 0; // a newcomer: let them see us straight away too
        const avatar = models.buildAvatar(u.look);
        avatar.root.add(layer.billboard(models.makeNameplate(String(u.name).slice(0, 20), "#5B6475")));
        const entity = layer.add({ object: avatar.root, lng: u.lng, lat: u.lat, heading: u.heading });
        others.set(u.id, { entity, avatar, to: { lng: u.lng, lat: u.lat, heading: u.heading }, mode: u.mode, moving: u.moving, seen: now });
      }

      function dropHunter(id: string) {
        const o = others.get(id);
        if (!o) return;
        layer.remove(o.entity);
        others.delete(id);
      }

      function announce(now: number) {
        const moving = traveller.v > 0.5;
        if (now - lastAnnounce < (moving ? 1000 : 8000)) return;
        lastAnnounce = now;
        const { ax, ay } = liveArea(traveller.pos.lng, traveller.pos.lat);
        const key = `${ax}_${ay}`;
        if (key !== myArea) {
          myArea = key;
          joinAreas(ax, ay);
        }
        const update: HunterUpdate = {
          id: playerId,
          name: username,
          look: JSON.parse(lookKey) as AvatarLook,
          lng: traveller.pos.lng,
          lat: traveller.pos.lat,
          heading: traveller.heading,
          mode: traveller.mode,
          moving,
        };
        void areaChannels.get(key)?.send({ type: "broadcast", event: "pos", payload: update });
        void huntChannel?.send({ type: "broadcast", event: "pos", payload: update });
      }

      // Closing the tab or leaving the app: tell the others straight away (otherwise
      // they drop us after 15 s of silence). Coming back re-announces.
      const sayBye = () => void areaChannels.get(myArea)?.send({ type: "broadcast", event: "bye", payload: { id: playerId } });
      const leaving = () => {
        if (document.visibilityState === "hidden") sayBye();
        else lastAnnounce = 0;
      };
      window.addEventListener("pagehide", sayBye);
      document.addEventListener("visibilitychange", leaving);

      /** Glide other hunters towards their latest announced spot; drop ones gone quiet. */
      function moveOthers(now: number, dt: number, t: number) {
        const k = Math.min(1, 3 * dt);
        for (const [id, o] of others) {
          if (now - o.seen > 15000) {
            dropHunter(id);
            continue;
          }
          const before = { lng: o.entity.lng, lat: o.entity.lat };
          o.entity.lng += (o.to.lng - o.entity.lng) * k;
          o.entity.lat += (o.to.lat - o.entity.lat) * k;
          o.entity.heading = geo.turnTowards(o.entity.heading ?? o.to.heading, o.to.heading, Math.min(1, 6 * dt));
          const moved = geo.distanceM([before.lng, before.lat], [o.entity.lng, o.entity.lat]);
          models.animateAvatar(
            o.avatar,
            { mode: o.mode, phase: "idle", moving: o.moving ? 1 : 0, distance: moved / layer.enlargement() },
            dt,
            t,
          );
        }
      }

      // ---- Bus, train and plane --------------------------------------------
      // A trip is paid for on the server (start_trip), which also decides when it
      // leaves and arrives. Until it leaves, the hunter waits at the stop (and can
      // cancel); on the way the vehicle carries them along its path and the player
      // can't steer; at the end finish_trip puts them at the destination, on foot.
      /** A bus stop the bus passes, and what happens there (seeded by the trip, so a reload plays it the same). */
      type WayStop = {
        name: string;
        s: number; // metres along the path
        on: number; // passengers getting on
        off: number; // and off
        dwell: number; // ms stopped (0: drives straight past)
        at: number; // ms after leaving when the bus pulls in
        spawned: boolean;
      };
      /** Someone getting on or off at a stop. */
      type Rider = {
        entity: import("@/game/ThreeMapLayer").MapEntity;
        avatar: ReturnType<typeof models.buildAvatar>;
        from: LngLat;
        to: LngLat;
        walkFrom: number; // ms after leaving: walking between these times
        walkTo: number;
        gone: number; // removed after this
        hideAtEnd: boolean; // got on the bus
      };
      type Ride = {
        trip: TransitTrip;
        label: string; // where the player asked to go (a bus drops them at the stop nearest it)
        then: Place | null; // where they're headed after getting off: directions are mapped again on arrival
        way: { stops: WayStop[]; speed: number /* m per ms between stops */ } | null; // a bus's stops, once loaded
        riders: Rider[];
        cum: number[];
        offset: number; // the server's clock minus this device's, in ms
        departs: number; // server-clock ms
        arrives: number;
        s: number; // metres along the path
        parts: import("@/game/ThreeMapLayer").MapEntity[]; // the bus, the train's carriages, or the plane
        plane: ReturnType<typeof models.makePlane> | null;
        finishing: boolean;
        lastTry: number;
      };
      let ride: Ride | null = null;
      const TRAIN_SCALE = 0.8;
      const PLANE_GROUND_SCALE = 0.45; // at the gate and on the runway, next to the hunter
      const PLANE_AIR_SCALE = 1.4; // at cruising height, seen from far above

      function showRide(status: string, canCancel: boolean) {
        if (!ride) return;
        const info = TRANSIT[ride.trip.mode];
        const title = `${info.label} ${ride.trip.mode === "bus" ? "towards" : "to"} ${ride.label}`;
        setHud((h) =>
          h.ride?.status === status && h.ride.canCancel === canCancel && h.ride.title === title
            ? h
            : { ...h, ride: { icon: info.icon, title, status, canCancel } },
        );
      }

      // Where the player was really headed (a bus drops them at the stop nearest it), kept per trip
      // on this device so a reload mid-ride still maps the rest of the way when they get off.
      const rideNoteKey = (tripId: string) => `loota:ride:${tripId}`;
      function rememberRide(tripId: string, label: string, then: Place | null) {
        try {
          localStorage.setItem(rideNoteKey(tripId), JSON.stringify({ label, then }));
        } catch {
          // private window or storage blocked: only a reload mid-ride loses the way on
        }
      }
      function recallRide(tripId: string): { label: string; then: Place | null } | null {
        try {
          const note = localStorage.getItem(rideNoteKey(tripId));
          return note ? (JSON.parse(note) as { label: string; then: Place | null }) : null;
        } catch {
          return null;
        }
      }
      function forgetRide(tripId: string) {
        try {
          localStorage.removeItem(rideNoteKey(tripId));
        } catch {
          // nothing to tidy
        }
      }

      function startRide(next: TransitTrip, label = next.to, then: Place | null = null) {
        endRide();
        // Resuming after a reload: what this device remembered about the trip.
        const note = then ? null : recallRide(next.id);
        if (note) {
          label = note.label;
          then = note.then;
        } else {
          rememberRide(next.id, label, then);
        }
        const at = { lng: next.path[0][0], lat: next.path[0][1] };
        const parts: import("@/game/ThreeMapLayer").MapEntity[] = [];
        let plane: Ride["plane"] = null;
        if (next.mode === "bus") parts.push(layer.add({ object: models.makeBus(), ...at, heading: 0 }));
        else if (next.mode === "taxi") parts.push(layer.add({ object: models.makeTaxi(), ...at, heading: 0 }));
        else if (next.mode === "train") {
          for (let i = 0; i < TRAIN_CARS; i++) parts.push(layer.add({ object: models.makeTrainCar(i === 0), ...at, heading: 0, scaleBy: TRAIN_SCALE }));
        } else {
          plane = models.makePlane();
          parts.push(layer.add({ object: plane.group, ...at, heading: 0, scaleBy: PLANE_GROUND_SCALE }));
        }
        for (const p of parts) p.object.visible = false;
        ride = {
          trip: next,
          label,
          then,
          way: null,
          riders: [],
          cum: cumulativeOf(next.path),
          offset: Date.parse(next.now) - Date.now(),
          departs: Date.parse(next.departsAt),
          arrives: Date.parse(next.arrivesAt),
          s: 0,
          parts,
          plane,
          finishing: false,
          lastTry: 0,
        };
        traveller.v = 0;
        controls.current.go = false;
        touchGo = false;
        setHud((h) => (h.stopHere ? { ...h, stopHere: null } : h));
        if (next.mode === "bus" && next.metres <= BUS_RANGE_M) void planBusStops(ride); // long-distance buses run express
      }

      // ---- The bus stops on the way: some passengers get off, others get on.
      /** A repeatable random sequence for one trip. */
      function seededRandom(text: string) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
        return () => {
          h = Math.imul(h ^ (h >>> 15), 2246822507);
          h = Math.imul(h ^ (h >>> 13), 3266489909);
          h ^= h >>> 16;
          return (h >>> 0) / 4294967296;
        };
      }

      /** Bus stops within 30 m of the bus's path (not the first or last 150 m), in order. */
      async function planBusStops(r: Ride) {
        const path = r.trip.path;
        const lngs = path.map((p) => p[0]);
        const lats = path.map((p) => p[1]);
        const pad = 0.001;
        const { data } = await supabase
          .from("transit_stops")
          .select("name, lng, lat")
          .eq("kind", "bus")
          .gte("lng", Math.min(...lngs) - pad)
          .lte("lng", Math.max(...lngs) + pad)
          .gte("lat", Math.min(...lats) - pad)
          .lte("lat", Math.max(...lats) + pad)
          .limit(2000);
        if (disposed || ride !== r || !data) return;
        const total = r.cum[r.cum.length - 1];
        const k = 111320 * Math.cos((path[0][1] * Math.PI) / 180);
        const found: { name: string; s: number }[] = [];
        for (const st of data as { name: string; lng: number; lat: number }[]) {
          let best = { off: Infinity, s: 0 };
          for (let i = 1; i < path.length; i++) {
            const ax = path[i - 1][0] * k, ay = path[i - 1][1] * 110574;
            const bx = path[i][0] * k, by = path[i][1] * 110574;
            const px = st.lng * k, py = st.lat * 110574;
            const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9;
            const f = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
            const off = Math.hypot(ax + f * (bx - ax) - px, ay + f * (by - ay) - py);
            if (off < best.off) best = { off, s: r.cum[i - 1] + f * (r.cum[i] - r.cum[i - 1]) };
          }
          if (best.off < 30 && best.s > 150 && best.s < total - 150) found.push({ name: st.name, s: best.s });
        }
        found.sort((a, b) => a.s - b.s);
        const stops: WayStop[] = [];
        const random = seededRandom(r.trip.id);
        const crowd = [0, 0, 1, 1, 1, 2, 2, 3];
        for (const st of found) {
          if (stops.length && st.s - stops[stops.length - 1].s < 150) continue; // the same stop on both sides of the road
          const on = crowd[Math.floor(random() * crowd.length)];
          const off = crowd[Math.floor(random() * crowd.length)];
          stops.push({ name: st.name, s: st.s, on, off, dwell: on + off ? 2500 + 700 * (on + off) : 0, at: 0, spawned: false });
        }
        // Stopping takes at most a third of the ride (the server fixed when it arrives): skip some stops if needed.
        const rideMs = r.arrives - r.departs;
        let stopped = stops.reduce((sum, st) => sum + st.dwell, 0);
        for (const st of [...stops].sort(() => random() - 0.5)) {
          if (stopped <= rideMs / 3) break;
          stopped -= st.dwell;
          st.dwell = 0;
          st.on = st.off = 0;
        }
        const speed = total / Math.max(1, rideMs - stopped);
        let waited = 0;
        for (const st of stops) {
          st.at = st.s / speed + waited;
          waited += st.dwell;
        }
        r.way = { stops, speed };
      }

      /** Where the bus is `elapsed` ms after leaving, and the stop it's standing at, if any. */
      function busAt(r: Ride, elapsed: number): { s: number; at: WayStop | null; next: WayStop | null } {
        const way = r.way!;
        const total = r.cum[r.cum.length - 1];
        let waited = 0;
        for (const st of way.stops) {
          if (!st.dwell) continue;
          if (elapsed < st.at) return { s: Math.min(total, (elapsed - waited) * way.speed), at: null, next: st };
          if (elapsed < st.at + st.dwell) return { s: st.s, at: st, next: st };
          waited += st.dwell;
        }
        return { s: Math.min(total, (elapsed - waited) * way.speed), at: null, next: null };
      }

      /** A point `right` metres to the bus's right (the kerb) and `ahead` metres forward of `p`. */
      function besideBus(p: LngLat, heading: number, right: number, ahead: number): LngLat {
        const east = -Math.cos(heading) * right + Math.sin(heading) * ahead;
        const north = -Math.sin(heading) * right - Math.cos(heading) * ahead;
        return { lng: p.lng + east / (111320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat + north / 110574 };
      }

      /** Passengers waiting at the kerb walk to the door and get on; those getting off walk away. */
      function moveRiders(r: Ride, elapsed: number, dt: number, t: number) {
        const way = r.way;
        if (!way) return;
        const enlarge = layer.enlargement();
        const path = r.trip.path;
        for (const st of way.stops) {
          if (!st.dwell || st.spawned || elapsed < st.at - 8000) continue;
          st.spawned = true;
          const { pos, segment } = alongPath(path, r.cum, st.s);
          const heading = geo.headingOf(path[segment - 1], path[segment]);
          const stop = { lng: pos[0], lat: pos[1] };
          const door = besideBus(stop, heading, 1.6 * enlarge, 1.5 * enlarge);
          const add = (look: string, from: LngLat, to: LngLat, walkFrom: number, walkTo: number, gone: number, hideAtEnd: boolean) => {
            const avatar = models.buildAvatar(lookForId(look));
            const entity = layer.add({ object: avatar.root, lng: from.lng, lat: from.lat, heading: geo.headingOf([from.lng, from.lat], [to.lng, to.lat]) });
            r.riders.push({ entity, avatar, from, to, walkFrom, walkTo, gone, hideAtEnd });
          };
          for (let i = 0; i < st.on; i++) {
            const kerb = besideBus(stop, heading, (3.2 + 0.9 * (i % 2)) * enlarge, (i - 1) * 1.4 * enlarge);
            const go = st.at + 300 + i * 500;
            add(`${r.trip.id}:${st.s}:on${i}`, kerb, door, go, go + Math.min(st.dwell * 0.6, 1800), go + Math.min(st.dwell * 0.6, 1800), true);
          }
          for (let i = 0; i < st.off; i++) {
            const away = besideBus(stop, heading, (5 + 1.2 * i) * enlarge, (i % 2 ? 2.5 : -2.5) * (1 + i) * enlarge);
            const go = st.at + 400 + i * 450;
            add(`${r.trip.id}:${st.s}:off${i}`, door, away, go, go + 2600, st.at + st.dwell + 6000, false);
          }
        }
        r.riders = r.riders.filter((rider) => {
          if (elapsed > rider.gone) {
            layer.remove(rider.entity);
            return false;
          }
          const f = Math.max(0, Math.min(1, (elapsed - rider.walkFrom) / Math.max(1, rider.walkTo - rider.walkFrom)));
          const walking = f > 0 && f < 1;
          const before = { lng: rider.entity.lng, lat: rider.entity.lat };
          rider.entity.lng = rider.from.lng + (rider.to.lng - rider.from.lng) * f;
          rider.entity.lat = rider.from.lat + (rider.to.lat - rider.from.lat) * f;
          // Those getting off only appear as they step out of the door.
          rider.entity.object.visible = rider.hideAtEnd ? f < 1 : elapsed >= rider.walkFrom;
          const stepM = geo.distanceM([before.lng, before.lat], [rider.entity.lng, rider.entity.lat]);
          models.animateAvatar(rider.avatar, { mode: "walk", phase: "idle", moving: walking ? 1 : 0, distance: stepM / enlarge }, dt, t);
          return true;
        });
      }

      function endRide() {
        if (!ride) return;
        for (const p of ride.parts) layer.remove(p);
        for (const rider of ride.riders) layer.remove(rider.entity);
        ride = null;
        me.object.visible = true;
        map.setMinZoom(GAME_ZOOM); // back to the one zoom players play at
        setHud((h) => ({ ...h, ride: null }));
      }

      /** Put the vehicle (each carriage of a train) `s` metres along its path. */
      function placeRide(r: Ride, s: number, dt: number, jump: boolean) {
        const path = r.trip.path;
        const spacing = models.TRAIN_CAR_SPACING * layer.enlargement() * TRAIN_SCALE;
        r.parts.forEach((part, i) => {
          const { pos, segment } = alongPath(path, r.cum, Math.max(0, s - i * spacing));
          const heading = geo.headingOf(path[segment - 1], path[segment]);
          part.lng = pos[0];
          part.lat = pos[1];
          part.heading = jump || part.heading === undefined ? heading : geo.turnTowards(part.heading, heading, Math.min(1, 6 * dt));
        });
      }

      /** One frame of a trip. True while the vehicle is on its way (the hunter is aboard). */
      function rideStep(now: number, dt: number) {
        const r = ride!;
        const info = TRANSIT[r.trip.mode];
        const serverNow = Date.now() + r.offset;
        const total = r.cum[r.cum.length - 1];
        if (serverNow < r.departs) {
          // Waiting at the stop (or checking in). The bus or train pulls in for the last few seconds; the plane waits at the gate.
          const left = (r.departs - serverNow) / 1000;
          placeRide(r, 0, dt, true);
          // The bus or train pulls in for the last few seconds; the plane is at the gate for the last 20 (boarding).
          for (const p of r.parts) p.object.visible = left < (r.trip.mode === "plane" ? 20 : 6);
          showRide(`${r.trip.mode === "plane" ? "Check-in and boarding" : info.wait} · leaves in ${clock(left)}`, true);
          return false;
        }
        if (r.s === 0) {
          // Leaving: the camera may pull back for a fast trip (the player still can't zoom), and street names stop.
          map.setMinZoom(8);
          setHud((h) => ({ ...h, street: null, services: { fuel: null, food: null } }));
        }
        const f = Math.min(1, (serverNow - r.departs) / Math.max(1, r.arrives - r.departs));
        const bus = r.way ? busAt(r, serverNow - r.departs) : null;
        r.s = Math.max(1e-6, bus ? bus.s : f * total);
        if (bus) moveRiders(r, serverNow - r.departs, dt, now / 1000);
        placeRide(r, r.s, dt, false);
        for (const p of r.parts) p.object.visible = true;
        me.object.visible = false;
        const lead = r.parts[0];
        traveller.pos = { lng: lead.lng, lat: lead.lat };
        traveller.heading = lead.heading ?? traveller.heading;
        if (r.plane) {
          // Climb after take-off and descend to land, nose up then down.
          const edge = Math.min(r.s, total - r.s);
          const height = Math.min(1, edge / 20000);
          r.plane.body.position.y = 1.6 + 8 * height * height * (3 - 2 * height);
          // Bigger as the camera pulls back, so it stays easy to see.
          const k = Math.min(1, edge / 40000);
          lead.scaleBy = PLANE_GROUND_SCALE + (PLANE_AIR_SCALE - PLANE_GROUND_SCALE) * k * k * (3 - 2 * k);
          r.plane.body.rotation.x = height < 1 ? (r.s < total / 2 ? -0.12 : 0.1) : 0;
        }
        const left = clock((r.arrives - serverNow) / 1000);
        if (bus?.at) {
          const { name, off, on } = bus.at;
          showRide(`Stopped at ${name} · ${off} getting off, ${on} getting on`, false);
        } else if (r.trip.mode === "bus") {
          showRide(`${bus?.next ? `Next stop: ${bus.next.name} · ` : ""}you get off at ${r.trip.to} in ${left}`, false);
        } else {
          showRide(`${r.trip.mode === "plane" ? "Lands" : "Arrives"} in ${left} · ${geo.formatDistance(total - r.s)} to go`, false);
        }
        if (f >= 1 && !r.finishing && now - r.lastTry > 2000) void finishRide(now);
        return true;
      }

      /** How close the camera is during a trip: as in play for a bus, further back for a train, high above for a flight. */
      function rideZoom() {
        if (!ride || ride.s === 0) return GAME_ZOOM;
        if (ride.trip.mode === "bus") return ride.trip.metres > BUS_RANGE_M ? GAME_ZOOM - 1 : GAME_ZOOM;
        if (ride.trip.mode === "taxi") return GAME_ZOOM;
        if (ride.trip.mode === "train") return GAME_ZOOM - 1;
        const total = ride.cum[ride.cum.length - 1];
        const k = Math.min(1, Math.min(ride.s, total - ride.s) / 40000);
        return GAME_ZOOM - 7 * k * k * (3 - 2 * k);
      }

      async function finishRide(now: number) {
        const r = ride;
        if (!r) return;
        r.finishing = true;
        r.lastTry = now;
        const { data } = await supabase.rpc("finish_trip");
        if (disposed || ride !== r) return;
        const result = data as { ok: boolean; reason?: string; lng?: number; lat?: number; name?: string } | null;
        if (result?.ok) arrive(result.lng!, result.lat!, result.name!, r.trip.mode, r.then);
        else if (result?.reason === "no_trip") arrive(r.trip.toLng, r.trip.toLat, r.trip.to, r.trip.mode, r.then); // ended elsewhere (another tab)
        else r.finishing = false; // not quite yet (clocks differ) or a network hiccup: try again shortly
      }

      function arrive(lng: number, lat: number, name: string, mode: TransitTrip["mode"], then: Place | null) {
        if (ride) forgetRide(ride.trip.id);
        endRide();
        traveller.pos = { lng, lat };
        traveller.v = 0;
        saved = { lng, lat };
        // (The server allows the hop from the stop onto the nearest road: save_position, trip_arrival_hop.)
        // New surroundings: their roads, finds and stops.
        network = null;
        onRoad = null;
        builtFrom = "";
        lastNetworkCheck = 0;
        if (mode === "plane") snapReachM = 3000; // the server allows this hop too (save_position)
        buildRoads();
        lastSync = performance.now();
        void syncWorld();
        void refreshNear();
        const getOff = `${mode === "plane" ? "Landed" : mode === "bus" ? "Off the bus" : "You've arrived"} at ${name}.`;
        const onFoot = then ? geo.distanceM([lng, lat], [then.lng, then.lat]) : 0;
        if (then && onFoot > 30) {
          // The rest of the way, on foot: mapped again from here.
          say(`${getOff} ${then.name} is ${geo.formatDistance(onFoot)} away on foot: follow the blue line.`);
          void planDirections({ lng: then.lng, lat: then.lat }, then.name, true);
        } else {
          say(`${getOff} You're on foot again.`);
        }
      }

      async function resumeTrip() {
        const { data } = await supabase.rpc("my_trip");
        if (!disposed && data && !ride) startRide(data as TransitTrip);
      }
      void resumeTrip();

      async function cancelTrip() {
        if (!ride) return;
        const { data } = await supabase.rpc("cancel_trip");
        const result = data as { ok: boolean; reason?: string; balance?: number } | null;
        if (disposed || !result) return;
        if (result.ok) {
          endRide();
          setHud((h) => ({ ...h, coins: result.balance ?? h.coins }));
          say("Trip cancelled. Your fare has been refunded.");
          void refreshNear();
        } else if (result.reason === "left") {
          say("Too late: it has already left.");
        } else if (result.reason === "no_trip") {
          endRide();
        }
      }

      // Stops near the hunter: what the Transport button offers, refreshed as they move.
      let near: TransitNear | null = null;
      let nearAt = -Infinity;
      let nearFrom: LngLat | null = null;
      async function refreshNear(): Promise<TransitNear | null> {
        const from = { ...traveller.pos };
        nearAt = performance.now();
        nearFrom = from;
        const [{ data }, { data: parks }, { data: stations }] = await Promise.all([
          supabase.rpc("transit_near", { p_lng: from.lng, p_lat: from.lat }),
          supabase
            .from("transit_stops")
            .select("id, kind, name, lng, lat, line_id, code, park, city, country")
            .eq("kind", "bus")
            .eq("park", true)
            .gte("lng", from.lng - 0.5)
            .lte("lng", from.lng + 0.5)
            .gte("lat", from.lat - 0.5)
            .lte("lat", from.lat + 0.5),
          supabase.rpc("stops_near", { p_kind: "train", p_lng: from.lng, p_lat: from.lat, p_limit: 20 }),
        ]);
        if (disposed || !data) return near;
        near = data as TransitNear;
        const here: [number, number] = [from.lng, from.lat];
        const withMetres = ((parks ?? []) as Omit<TransitStop, "metres" | "line">[]).map((p) => ({ ...p, line: null, metres: Math.round(geo.distanceM(here, [p.lng, p.lat])) }));
        near.park = withMetres.sort((a, b) => a.metres - b.metres)[0] ?? null;
        const lines = new Map<string, TransitStop>();
        for (const st of (stations ?? []) as TransitStop[]) if (st.line_id && st.metres < 100_000 && !lines.has(st.line_id)) lines.set(st.line_id, st);
        near.lines = [...lines.values()];
        const at = (["plane", "train", "bus"] as const).map((k) => near!.here.find((st) => st.kind === k)).find(Boolean);
        const stopHere = at ? { icon: TRANSIT[at.kind].icon, label: at.kind === "plane" ? "Fly from here" : `Take a ${at.kind}` } : null;
        setHud((h) => (ride || JSON.stringify(h.stopHere) === JSON.stringify(stopHere) ? h : { ...h, stopHere }));
        return near;
      }
      function nearTick(now: number) {
        if (ride || now - nearAt < 3000) return;
        const moved = nearFrom ? geo.distanceM([nearFrom.lng, nearFrom.lat], [traveller.pos.lng, traveller.pos.lat]) : Infinity;
        if (moved > 20 || now - nearAt > 30000) void refreshNear();
      }

      const stopTitle = (st: TransitStop) => (st.kind === "plane" ? `${st.name} (${st.code})` : st.kind === "train" ? `${st.name} station` : st.name);

      /** A bus from this stop to the bus stop nearest a place, along the roads a car would take. */
      async function quoteBus(from: TransitStop, place: Place): Promise<TransitQuote | string> {
        const far = geo.distanceM([from.lng, from.lat], [place.lng, place.lat]) > BUS_RANGE_M;
        let to: TransitStop | undefined;
        if (!far) {
          const { data } = await supabase.rpc("stops_near", { p_kind: "bus", p_lng: place.lng, p_lat: place.lat, p_limit: 1 });
          to = (data as TransitStop[] | null)?.[0];
          if (!to || to.metres > 2000) return `There's no bus stop within 2 km of ${place.name}.`;
        } else {
          // Another city: a long-distance bus, motor park to motor park.
          if (!from.park) {
            const park = near?.park;
            return `Buses to other cities leave from motor parks.${park ? ` The nearest is ${park.name}, ${geo.formatDistance(park.metres)} away (Directions in this panel).` : ""}`;
          }
          const { data } = await supabase
            .from("transit_stops")
            .select("id, kind, name, lng, lat, line_id, code, park")
            .eq("kind", "bus")
            .eq("park", true)
            .gte("lng", place.lng - 0.25)
            .lte("lng", place.lng + 0.25)
            .gte("lat", place.lat - 0.25)
            .lte("lat", place.lat + 0.25);
          to = ((data ?? []) as Omit<TransitStop, "metres" | "line">[])
            .map((p) => ({ ...p, line: null, metres: Math.round(geo.distanceM([place.lng, place.lat], [p.lng, p.lat])) }))
            .sort((a, b) => a.metres - b.metres)[0];
          if (!to) return `There's no motor park within 25 km of ${place.name}, so no long-distance bus goes there.`;
        }
        const straight = geo.distanceM([from.lng, from.lat], [to.lng, to.lat]);
        if (to.id === from.id || straight < 300) return `${place.name} is within walking distance of this stop.`;
        if (straight > COACH_RANGE_M) return "That's too far for a bus. Take a plane.";
        // City trips on our own roads, long ones on our main-road network; the routing service if those fail.
        let path: import("@/game/geo").Coord[] | null = null;
        if (far) {
          const highways = await loadHighways(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public`);
          path = highways ? highwayRoute(highways, [from.lng, from.lat], [to.lng, to.lat]) : null;
        } else {
          path = (await routeOnOwnRoads({ lng: from.lng, lat: from.lat }, { lng: to.lng, lat: to.lat }, "car"))?.path ?? null;
        }
        if (!path) {
          const { route, fallback } = await fetchRoute(from, to, "car");
          if (!fallback) path = route.coords;
        }
        if (!path) return "Couldn't work out the bus's way there just now. Try again in a moment.";
        const full = thinPath([[from.lng, from.lat], ...path, [to.lng, to.lat]], far ? 25 : 4);
        const metres = Math.max(cumulativeOf(full).at(-1)!, straight);
        const wait = transitWaitS("bus", false);
        return {
          mode: "bus",
          from,
          to: { id: to.id, name: to.name, code: null },
          label: place.name,
          then: place,
          walkAfter: to.metres,
          metres,
          fare: transitFare("bus", metres),
          seconds: wait + metres / transitSpeedFor("bus", metres),
          waitSeconds: wait,
          path: full,
        };
      }

      /** A train along the line to another station, or a flight to another airport. */
      async function quoteTo(from: TransitStop, to: import("@/game/transit").TransitDestination): Promise<TransitQuote | string> {
        let path: import("@/game/geo").Coord[];
        if (from.kind === "train") {
          const [{ data: line }, { data: stops }] = await Promise.all([
            supabase.from("transit_lines").select("path").eq("id", from.line_id ?? "").single(),
            supabase.from("transit_stops").select("id, along_m").in("id", [from.id, to.id]),
          ]);
          const along = new Map(((stops ?? []) as { id: number; along_m: number }[]).map((st) => [st.id, st.along_m]));
          if (!line || along.size < 2) return "Couldn't load the line just now. Try again in a moment.";
          path = sliceLine(line.path as import("@/game/geo").Coord[], along.get(from.id)!, along.get(to.id)!);
        } else {
          path = flightPath([from.lng, from.lat], [to.lng, to.lat]);
        }
        return { mode: from.kind, from, to: { id: to.id, name: to.name, code: to.code }, label: to.name, metres: to.metres, fare: to.fare, seconds: to.seconds, waitSeconds: transitWaitS(from.kind, false), path: thinPath(path, 2) };
      }

      async function board(quote: TransitQuote, fastPass: boolean): Promise<string | null> {
        if (ride) return "You're already on a trip.";
        if (traveller.mode !== "walk") return "Get off your vehicle first (tap Walk), then board.";
        await savePosition(); // the server checks you're at the stop
        const { data, error } = await supabase.rpc("start_trip", { p_from: quote.from.id, p_to: quote.to.id, p_path: quote.path, p_fast_pass: fastPass });
        if (error || !data) return fastPass ? "Your Fast Pass couldn't be used. Try again without it." : "Something went wrong. Try again.";
        const result = data as { ok: boolean; reason?: string; fare?: number; balance?: number; trip?: TransitTrip };
        if (!result.ok) {
          const why: Record<string, string> = {
            coins: `You need ${result.fare ?? quote.fare} coins for this fare.`,
            far: `Get to ${stopTitle(quote.from)} first: you need to be at the stop.`,
            vehicle: "Get off your vehicle first (tap Walk), then board.",
            dome: "A Lockdown dome covers that stop. Pick somewhere else.",
            path: "Couldn't plan that route. Try another stop.",
            route: "Nothing goes there from here.",
            on_trip: "You're already on a trip.",
          };
          return why[result.reason ?? ""] ?? "Couldn't board just now. Try again.";
        }
        setHud((h) => ({ ...h, coins: result.balance ?? h.coins }));
        // Where to after getting off: the bus's place, or (a train or plane) wherever the player's directions led,
        // unless they only led to this station or airport.
        const fromStop: [number, number] = [quote.from.lng, quote.from.lat];
        const headed = trip && geo.distanceM(fromStop, [trip.to.lng, trip.to.lat]) > 300 ? { name: trip.name, detail: "", lng: trip.to.lng, lat: trip.to.lat } : null;
        endDirections(); // the old route is done with: the bus, train or plane takes over
        startRide(result.trip!, quote.label, quote.then ?? headed);
        if (fastPass) countRelics();
        say(
          quote.mode === "plane"
            ? `Ticket booked to ${quote.to.name}. Check-in and boarding take ${clock(transitWaitS("plane", fastPass))}.`
            : `Fare paid. You're on your way to ${quote.label}; sit back, the ${quote.mode} does the driving.`,
        );
        return null;
      }

      setTransitActions({
        near: refreshNear,
        destinations: async (stop) => {
          const { data } = await supabase.rpc("transit_destinations", { p_stop: stop.id });
          return (data ?? []) as import("@/game/transit").TransitDestination[];
        },
        searchAirports: async (from, query) => {
          const { data } = await supabase.rpc("search_airports", { p_query: query, p_from: from.id });
          return (data ?? []) as import("@/game/transit").TransitDestination[];
        },
        quoteTaxi,
        callTaxi,
        quoteBus,
        quoteTo,
        board,
        directionsTo: (stop) => void planDirections({ lng: stop.lng, lat: stop.lat }, stopTitle(stop)),
        heading: () => (trip ? { name: trip.name, detail: "", lng: trip.to.lng, lat: trip.to.lat } : null),
        fastPasses: async () => {
          const { data } = await supabase.from("player_relics").select("charges, expires_at").eq("relic", "fast_pass").gt("charges", 0);
          const now = Date.now();
          return ((data ?? []) as { charges: number; expires_at: string }[]).filter((r) => Date.parse(r.expires_at) > now).reduce((n, r) => n + r.charges, 0);
        },
        where: () => ({ ...traveller.pos }),
      });

      // ---- Limits: energy, fuel, tyres, engines; fainting and the ambulance --------
      // The server keeps the truth (save_position counts energy and wear; see the
      // travel_restraints migration). The game warns early, points to the nearest
      // place that helps, and offers what can be done where the player stands.
      type Spot = { id: number; kind: "fuel" | "hospital" | "eat" | "rest" | "tyres" | "mechanic"; name: string; lng: number; lat: number; metres: number };
      const SPOT_HERE_M = 60; // the server allows 80
      let spots: Spot[] = [];
      let spotsAt = -Infinity;
      let spotsFrom: LngLat | null = null;
      let keg: { fuel: number; usesLeft: number } | null = null;
      const warned = { energy: 100, fuel: 100, tyre: 100, engine: 100 }; // the level last warned at (100: not warned)
      let advicePlace: { name: string; lng: number; lat: number } | null = null;
      let adviceKey = "";

      /** The places around the hunter (for "you're at a petrol station" and the like). */
      async function refreshSpots() {
        const from = { ...traveller.pos };
        spotsAt = performance.now();
        spotsFrom = from;
        const { data } = await supabase.rpc("places_near", {
          p_kinds: ["fuel", "eat", "rest", "tyres", "mechanic", "hospital"],
          p_lng: from.lng,
          p_lat: from.lat,
          p_limit: 20,
        });
        if (disposed || !data) return;
        spots = data as Spot[];
        computeActions();
      }
      function spotsTick(now: number) {
        if (ride || visit || now - spotsAt < 3000) return;
        const moved = spotsFrom ? geo.distanceM([spotsFrom.lng, spotsFrom.lat], [traveller.pos.lng, traveller.pos.lat]) : Infinity;
        if (moved > 25 || now - spotsAt > 30000) void refreshSpots();
      }
      /** The place of these kinds the hunter is at, if any. */
      function spotHere(kinds: Spot["kind"][]) {
        const at: [number, number] = [traveller.pos.lng, traveller.pos.lat];
        let best: Spot | null = null;
        let bestM = SPOT_HERE_M;
        for (const sp of spots) {
          if (!kinds.includes(sp.kind)) continue;
          const m = geo.distanceM(at, [sp.lng, sp.lat]);
          if (m < bestM) {
            bestM = m;
            best = sp;
          }
        }
        return best;
      }
      /**
       * The nearest place of these kinds ahead of the hunter (never one they've passed):
       * along their directions if they have some, otherwise in front of them. `behind`
       * when nothing is ahead and the nearest one overall is offered instead.
       */
      /** How far along a route the point nearest `p` is, and how far `p` is from it (the whole route searched). */
      function whereOnRoute(route: import("@/game/geo").Route, p: LngLat) {
        const k = 111320 * Math.cos((p.lat * Math.PI) / 180);
        let best = { s: 0, off: Infinity };
        for (let i = 0; i < route.coords.length - 1; i++) {
          const ax = (route.coords[i][0] - p.lng) * k, ay = (route.coords[i][1] - p.lat) * 110574;
          const bx = (route.coords[i + 1][0] - p.lng) * k, by = (route.coords[i + 1][1] - p.lat) * 110574;
          const dx = bx - ax, dy = by - ay;
          const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-9)));
          const off = Math.hypot(ax + dx * t, ay + dy * t);
          if (off < best.off) best = { s: route.cum[i] + t * (route.cum[i + 1] - route.cum[i]), off };
        }
        return best;
      }

      async function spotAhead(kinds: Spot["kind"][]): Promise<{ spot: Spot; behind: boolean } | null> {
        const at = { ...traveller.pos };
        const route = trip?.route ?? null;
        const k = 111320 * Math.cos((at.lat * Math.PI) / 180);
        // Look around the hunter and further on, so places ahead are found even where many lie behind.
        const forward = { x: Math.sin(traveller.heading), y: -Math.cos(traveller.heading) }; // east, north
        const nowS = route ? directions.progressOn(route, at, trip!.segment).s : 0;
        const onAhead = (m: number) => {
          if (route) {
            const { pos } = alongPath(route.coords, route.cum, Math.min(route.total, nowS + m));
            return { lng: pos[0], lat: pos[1] };
          }
          return { lng: at.lng + (forward.x * m) / k, lat: at.lat + (forward.y * m) / 110574 };
        };
        const searches = [at, onAhead(1000), onAhead(2500)].map((p) =>
          supabase.rpc("places_near", { p_kinds: kinds, p_lng: p.lng, p_lat: p.lat, p_limit: 20 }).then(({ data }) => (data ?? []) as Spot[]),
        );
        const found = new Map<number, Spot>();
        for (const list of await Promise.all(searches)) for (const sp of list) found.set(sp.id, sp);
        if (disposed || !found.size) return null;
        const spots = [...found.values()].map((sp) => ({ ...sp, metres: Math.round(geo.distanceM([at.lng, at.lat], [sp.lng, sp.lat])) }));
        let best: { spot: Spot; cost: number } | null = null;
        for (const sp of spots) {
          let cost: number;
          if (route) {
            // Along the way: further on the route, and not far off it (a detour counts double).
            const on = whereOnRoute(route, sp);
            if (on.s < nowS + 20 || on.off > 400) continue;
            cost = on.s - nowS + 2 * on.off;
          } else {
            // In front: within 70° of the way the hunter faces.
            const dx = (sp.lng - at.lng) * k;
            const dy = (sp.lat - at.lat) * 110574;
            const len = Math.hypot(dx, dy) || 1;
            if ((dx * forward.x + dy * forward.y) / len < Math.cos((70 * Math.PI) / 180)) continue;
            cost = sp.metres;
          }
          if (!best || cost < best.cost) best = { spot: sp, cost };
        }
        if (best) return { spot: best.spot, behind: false };
        const nearest = spots.sort((a, b) => a.metres - b.metres)[0];
        return { spot: nearest, behind: true };
      }

      /** Show a warning with directions to the nearest place of these kinds. */
      async function advise(key: string, text: string, kinds: Spot["kind"][] | null) {
        const found = kinds ? await spotAhead(kinds) : null;
        if (disposed) return;
        const spot = found?.spot ?? null;
        const full = found
          ? `${text} ${found.behind ? "None ahead; the nearest is back the way you came" : trip ? "Next on your way" : "Next ahead"}: ${found.spot.name}, ${geo.formatDistance(found.spot.metres)}.`
          : text;
        adviceKey = key;
        advicePlace = spot ? { name: spot.name, lng: spot.lng, lat: spot.lat } : null;
        setHud((h) => ({ ...h, advice: { key, text: full, place: advicePlace } }));
        say(full, true);
      }
      function clearAdvice(key: string) {
        if (adviceKey !== key) return;
        adviceKey = "";
        advicePlace = null;
        setHud((h) => (h.advice?.key === key ? { ...h, advice: null } : h));
      }

      /** Warnings as energy, fuel, tyres and engines run down (once per level, again after recovering). */
      function checkLimits() {
        if (visit || ride) return;
        const energy = traveller.energy;
        if (traveller.mode === "walk" || traveller.mode === "bicycle") {
          if (energy < 25 && warned.energy > 25) {
            warned.energy = 25;
            void advise("energy", "You're exhausted! Rest now or you'll faint and need an ambulance: sit down at a park or a place to eat, or have a meal.", ["rest", "eat"]);
          } else if (energy < 50 && warned.energy > 50) {
            warned.energy = 50;
            void advise("energy", "You're getting tired. Take a break at a chill spot (a park or a place to eat): energy comes back fast there.", ["rest", "eat"]);
          }
        }
        if (energy > 60 && warned.energy < 100) {
          warned.energy = 100;
          clearAdvice("energy");
        }
        const mine = ownInUse();
        if (mine && mine.kind !== "bicycle") {
          if (mine.fuel < 10 && warned.fuel > 10) {
            warned.fuel = 10;
            void advise("fuel", `Fuel almost gone! If the tank runs dry your ${vehicleName(mine.kind)} stops, and you'll have to carry fuel to it in a keg.`, ["fuel"]);
          } else if (mine.fuel < 25 && warned.fuel > 25) {
            warned.fuel = 25;
            void advise("fuel", "Fuel is getting low. Fill up at a petrol station.", ["fuel"]);
          }
          if (mine.fuel > 40 && warned.fuel < 100) {
            warned.fuel = 100;
            clearAdvice("fuel");
          }
          if (mine.engine < 30 && warned.engine > 30) {
            warned.engine = 30;
            void advise("engine", `Your ${vehicleName(mine.kind)}'s engine needs a service: worn engines break down. A mechanic can service it (60 coins).`, ["mechanic"]);
          }
          if (mine.engine > 50 && warned.engine < 100) {
            warned.engine = 100;
            clearAdvice("engine");
          }
        }
        if (mine?.kind === "bicycle") {
          if (mine.tyre <= 0 && warned.tyre > 0) {
            warned.tyre = 0;
            void advise("tyre", "Flat tyre! You're pushing your bicycle at walking pace. A vulcanizer or petrol station can fix it (20 coins).", ["tyres", "fuel"]);
          } else if (mine.tyre < 40 && warned.tyre > 40) {
            warned.tyre = 40;
            void advise("tyre", "Your tyres are getting soft. Pump them at a vulcanizer or petrol station (5 coins).", ["tyres", "fuel"]);
          }
          if (mine.tyre > 60 && warned.tyre < 100) {
            warned.tyre = 100;
            clearAdvice("tyre");
          }
        }
      }

      /** What can be done here: by the place the hunter is at, and the vehicles next to them. */
      function computeActions() {
        const list: { id: LimitAction; label: string }[] = [];
        if (!visit && !ride && traveller.phase === "idle") {
          const at: [number, number] = [traveller.pos.lng, traveller.pos.lat];
          const mine = ownInUse();
          const parkedNear = (want: (v: VehicleRow) => boolean) =>
            owned.find((v) => !v.in_use && want(v) && geo.distanceM(at, [v.lng, v.lat]) < 30) ?? null;
          const eatSpot = spotHere(["eat"]);
          if (eatSpot && traveller.energy < 95) list.push({ id: "eat", label: `🍲 Eat at ${eatSpot.name} · ${MEAL_PRICE} coins` });
          const chill = spotHere(["rest", "eat"]);
          if (chill && traveller.mode === "walk" && traveller.energy < 90 && !traveller.resting) list.push({ id: "rest", label: `🪑 Rest at ${chill.name}` });
          const station = spotHere(["fuel"]);
          if (station && mine && mine.kind !== "bicycle" && mine.fuel < 99) list.push({ id: "refuel", label: `⛽ Refuel at ${station.name}` });
          if (station && !keg && owned.some((v) => v.kind !== "bicycle")) list.push({ id: "buy_keg", label: "🛢 Buy a fuel keg · 25 coins" });
          if (station && keg && keg.fuel < 30) list.push({ id: "fill_keg", label: `🛢 Fill your keg · ${2 * (30 - Math.floor(keg.fuel))} coins` });
          const dry = parkedNear((v) => v.kind !== "bicycle" && v.fuel < 100);
          if (keg && keg.fuel > 0 && dry) list.push({ id: "pour_keg", label: `🛢 Pour the keg into your ${vehicleName(dry.kind)}` });
          const bike = mine?.kind === "bicycle" ? mine : parkedNear((v) => v.kind === "bicycle");
          if (spotHere(["tyres", "fuel"]) && bike && bike.tyre < 95) {
            list.push({ id: "pump", label: bike.tyre <= 0 ? "🛞 Fix the flat · 20 coins" : "🛞 Pump the tyres · 5 coins" });
          }
          const motor = mine && mine.kind !== "bicycle" ? mine : parkedNear((v) => v.kind !== "bicycle");
          if (spotHere(["mechanic"]) && motor && (motor.engine < 90 || motor.broken_at)) {
            list.push({ id: "service", label: `🔧 Service your ${vehicleName(motor.kind)} · 60 coins` });
          }
          const broken = parkedNear((v) => !!v.broken_at && !v.repair_ready_at);
          if (broken) list.push({ id: "mechanic", label: `🔧 Call a mechanic for your ${vehicleName(broken.kind)} · ${broken.kind === "bicycle" ? 30 : 80} coins` });
        }
        setHud((h) => (JSON.stringify(h.actions) === JSON.stringify(list) ? h : { ...h, actions: list }));
      }

      const showKeg = () => setHud((h) => ({ ...h, keg: keg ? { ...keg } : null }));

      async function act(id: LimitAction) {
        if (busy) return;
        if (id === "eat") {
          const place = spotHere(["eat"]);
          if (place) await eatHere(place.name);
          computeActions();
          return;
        }
        if (id === "refuel") {
          await refuelHere();
          computeActions();
          return;
        }
        setBusy(true);
        try {
          await savePosition(); // the server checks where the player is
          const rpc: Record<Exclude<LimitAction, "eat" | "refuel">, string> = {
            rest: "start_rest",
            buy_keg: "buy_keg",
            fill_keg: "fill_keg",
            pour_keg: "pour_keg",
            pump: "pump_tyres",
            service: "service_vehicle",
            mechanic: "call_mechanic",
          };
          const { data } = await supabase.rpc(rpc[id]);
          const r = data as {
            ok: boolean;
            reason?: string;
            balance?: number;
            place?: string;
            fuel?: number;
            cost?: number;
            usesLeft?: number;
            spoilt?: boolean;
            kind?: VehicleKind;
          } | null;
          if (disposed) return;
          if (!r?.ok) {
            const why: Record<string, string> = {
              not_here: "You need to be right at the place for that.",
              coins: "Not enough coins for that.",
              have_one: "You already have a keg.",
              full: "It's already full.",
              no_vehicle: "Your vehicle needs to be right here.",
              no_keg: "Buy a keg first.",
              empty: "Your keg is empty: fill it at a petrol station.",
            };
            say(why[r?.reason ?? ""] ?? "Couldn't do that just now.", true);
            return;
          }
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          if (id === "rest") {
            traveller.resting = true;
            say(`Resting at ${r.place}. Energy comes back fast; walk on when you're ready.`);
          } else if (id === "buy_keg") {
            keg = { fuel: 0, usesLeft: r.usesLeft ?? 50 };
            say("You bought a fuel keg (good for 50 trips). Fill it here, carry it to your vehicle and pour it in.");
          } else if (id === "fill_keg") {
            keg = { fuel: r.fuel ?? 30, usesLeft: keg?.usesLeft ?? 50 };
            say(`Keg filled: ${Math.round(r.fuel ?? 30)}% of a tank for ${r.cost} coins. Carry it to your vehicle and pour it in.`);
          } else if (id === "pour_keg") {
            keg = r.spoilt ? null : { fuel: 0, usesLeft: r.usesLeft ?? 0 };
            await refreshVehicles();
            const name = r.kind ? vehicleName(r.kind) : "vehicle";
            say(`Poured: your ${name} has ${Math.round(r.fuel ?? 0)}% fuel.${r.spoilt ? " That was your keg's last use: it's worn out." : ` Your keg has ${r.usesLeft} uses left.`} Get on it from Vehicles.`);
            clearAdvice("fuel");
          } else if (id === "pump") {
            await refreshVehicles();
            say(r.cost === 20 ? "Flat fixed: your tyres are as good as new." : "Tyres pumped up.");
            warned.tyre = 100;
            clearAdvice("tyre");
          } else if (id === "service") {
            await refreshVehicles();
            say(`Serviced: your ${r.kind ? vehicleName(r.kind) : "vehicle"} runs like new.`);
            warned.engine = 100;
            clearAdvice("engine");
          } else if (id === "mechanic") {
            await refreshVehicles();
            say(`A mechanic is on the way: your ${r.kind ? vehicleName(r.kind) : "vehicle"} will be ready again in about 45 seconds. Then get on it from Vehicles.`);
            clearAdvice("engine");
            clearAdvice("bike");
          }
          showKeg();
        } finally {
          setBusy(false);
          computeActions();
        }
      }

      /** After a save: the server's energy, wear, and whether the vehicle stopped or the hunter fainted. */
      function onSaved(result: SaveResult) {
        if (typeof result.energy === "number") {
          traveller.energy = result.energy;
          if (traveller.phase === "fainted" && !result.fainted && result.energy > 0 && !visit) {
            traveller.phase = "idle"; // the server counted a little more energy than this device: still on your feet, just
            say("You're about to collapse: rest now!", true);
          }
        }
        const mine = ownInUse();
        if (mine) {
          if (typeof result.fuel === "number") mine.fuel = result.fuel;
          if (typeof result.tyre === "number") mine.tyre = result.tyre;
          if (typeof result.engine === "number") mine.engine = result.engine;
          showVehicle();
        }
        if (result.stopped) vehicleStopped(result.stopped);
        if (result.fainted) faint();
      }

      /** An empty tank or a breakdown: the vehicle stays where it stopped; the hunter is on foot. */
      function vehicleStopped(why: "fuel" | "broken") {
        const kind = traveller.mode === "walk" ? null : (traveller.mode as VehicleKind);
        traveller.mode = "walk";
        traveller.v = 0;
        void refreshVehicles().then(() => {
          afterModeChange();
          computeActions();
        });
        const name = kind ? vehicleName(kind) : "vehicle";
        if (why === "fuel") {
          void advise(
            "fuel",
            `Out of fuel! Your ${name} has stopped and is parked here. Walk to a petrol station, ${keg ? "fill your keg" : "buy a keg (25 coins) and fill it"}, then bring it back and pour it in.`,
            ["fuel"],
          );
        } else {
          void advise("engine", `Your ${name} has broken down and is parked here. Call a mechanic (80 coins, button below) to get it going.`, null);
        }
      }

      // ---- Fainting, the ambulance and the hospital
      type VisitJson = {
        hospital: string;
        lng: number;
        lat: number;
        approach: import("@/game/geo").Coord[] | null;
        route: import("@/game/geo").Coord[] | null;
        bill: number;
        calledAt: string;
        pickedAt: string;
        arrivesAt: string;
        dischargedAt: string;
        now: string;
      };
      type Visit = {
        v: VisitJson;
        offset: number; // the server's clock minus this device's, in ms
        called: number;
        picked: number;
        arrives: number;
        discharged: number;
        approachCum: number[] | null;
        routeCum: number[] | null;
        van: import("@/game/ThreeMapLayer").MapEntity;
        light: import("three").Object3D;
        leaving: boolean;
        lastTry: number;
      };
      let visit: Visit | null = null;
      let fainting = false;
      let damagedBike: LngLat | null = null; // their own bicycle, damaged where they collapsed

      function showCare(icon: string, title: string, status: string) {
        setHud((h) => (h.care?.title === title && h.care.status === status ? h : { ...h, care: { icon, title, status } }));
      }

      /** Collapsed: lie down where you are, and call the ambulance (once the server agrees). */
      function faint() {
        if (visit || fainting) return;
        fainting = true;
        traveller.phase = "fainted";
        traveller.phaseUntil = Infinity;
        traveller.v = 0;
        traveller.energy = 0;
        traveller.resting = false;
        controls.current.go = false;
        touchGo = false;
        say("You fainted from exhaustion! An ambulance is on its way.", true);
        void callAmbulance().finally(() => {
          fainting = false;
        });
      }

      /** The nearest hospital (within 15 km) by road; with none, paramedics treat the hunter where they fell. */
      async function callAmbulance() {
        const at = { ...traveller.pos };
        const { data: near } = await supabase.rpc("places_near", { p_kinds: ["hospital"], p_lng: at.lng, p_lat: at.lat, p_limit: 3 });
        const hospital = ((near ?? []) as Spot[]).find((h) => h.metres <= 15000) ?? null;
        let route: import("@/game/geo").Coord[] | null = null;
        let approach: import("@/game/geo").Coord[] | null = null;
        if (hospital) {
          const way = (await routeOnOwnRoads(at, hospital, "car"))?.path ?? null;
          if (way) route = thinPath([[at.lng, at.lat], ...way, [hospital.lng, hospital.lat]]);
          // The ambulance comes from 1–2 km away, along the roads.
          for (let i = 0; i < 4 && route && !approach; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const m = 1000 + Math.random() * 1000;
            const start = {
              lng: at.lng + (Math.sin(angle) * m) / (111320 * Math.cos((at.lat * Math.PI) / 180)),
              lat: at.lat + (Math.cos(angle) * m) / 110574,
            };
            const found = (await routeOnOwnRoads(start, at, "car"))?.path ?? null;
            if (found && cumulativeOf(found).at(-1)! > 300) approach = thinPath([...found, [at.lng, at.lat]]);
          }
        }
        let { data } = await supabase.rpc("call_ambulance", {
          p_hospital: hospital?.name ?? null,
          p_lng: hospital?.lng ?? null,
          p_lat: hospital?.lat ?? null,
          p_approach: route ? approach : null,
          p_route: route,
        });
        if ((data as { reason?: string } | null)?.reason === "route") {
          // The hospital or the way there wasn't accepted: paramedics come instead.
          ({ data } = await supabase.rpc("call_ambulance", { p_hospital: null, p_lng: null, p_lat: null, p_approach: null, p_route: null }));
        }
        if (disposed) return;
        const r = data as {
          ok: boolean;
          reason?: string;
          visit?: VisitJson;
          rentedLost?: { kind: VehicleKind; paid: number } | null;
          damaged?: VehicleKind | null;
        } | null;
        if (r?.ok && r.visit) {
          startVisit(r.visit);
          const paid = r.visit.bill + (r.rentedLost?.paid ?? 0);
          setHud((h) => ({ ...h, coins: Math.max(0, h.coins - paid) }));
          if (r.rentedLost) {
            say(
              `You collapsed on the rented ${vehicleName(r.rentedLost.kind)}: it was damaged in the fall and stolen while you were out, so you've paid ${r.rentedLost.paid} coins for it.`,
              true,
            );
          } else if (r.damaged === "bicycle") {
            damagedBike = at;
            say("You collapsed on your bicycle: it's damaged and stays where you fell. A mechanic can repair it there (30 coins).", true);
          }
        } else if (r?.reason === "not_fainted") {
          traveller.phase = "idle";
        }
      }

      function startVisit(v: VisitJson) {
        endVisit();
        const ambulance = models.makeAmbulance();
        const first = v.approach?.[0] ?? v.route?.[0] ?? [traveller.pos.lng, traveller.pos.lat];
        const van = layer.add({ object: ambulance.group, lng: first[0], lat: first[1], heading: 0 });
        van.object.visible = !!v.approach;
        visit = {
          v,
          offset: Date.parse(v.now) - Date.now(),
          called: Date.parse(v.calledAt),
          picked: Date.parse(v.pickedAt),
          arrives: Date.parse(v.arrivesAt),
          discharged: Date.parse(v.dischargedAt),
          approachCum: v.approach ? cumulativeOf(v.approach) : null,
          routeCum: v.route ? cumulativeOf(v.route) : null,
          van,
          light: ambulance.light,
          leaving: false,
          lastTry: 0,
        };
        traveller.phase = "fainted";
        traveller.phaseUntil = Infinity;
        traveller.v = 0;
        traveller.mode = "walk"; // off whatever they were riding (the server says so too)
        controls.current.go = false;
        touchGo = false;
        clearAdvice("energy");
        void refreshVehicles();
        computeActions();
      }

      function endVisit() {
        if (!visit) return;
        layer.remove(visit.van);
        visit = null;
        me.object.visible = true;
        setHud((h) => ({ ...h, care: null }));
      }

      /** Move the ambulance \`f\` (0–1) of the way along a path. */
      function placeVan(vs: Visit, path: import("@/game/geo").Coord[], cum: number[], f: number, dt: number) {
        const { pos, segment } = alongPath(path, cum, f * cum[cum.length - 1]);
        const heading = geo.headingOf(path[segment - 1], path[segment]);
        vs.van.lng = pos[0];
        vs.van.lat = pos[1];
        vs.van.heading = vs.van.heading === undefined ? heading : geo.turnTowards(vs.van.heading, heading, Math.min(1, 6 * dt));
      }

      /** One frame of a hospital visit. True while the hunter is in the ambulance or the hospital. */
      function visitStep(now: number, dt: number) {
        const vs = visit!;
        const serverNow = Date.now() + vs.offset;
        vs.light.visible = Math.floor(now / 250) % 2 === 0; // the flashing light
        const left = (until: number) => clock((until - serverNow) / 1000);
        if (serverNow < vs.picked) {
          // Lying where they fell while the ambulance (or the paramedics) come.
          if (vs.v.approach && vs.approachCum) {
            vs.van.object.visible = true;
            placeVan(vs, vs.v.approach, vs.approachCum, Math.max(0, (serverNow - vs.called) / Math.max(1, vs.picked - vs.called)), dt);
          }
          showCare("🚑", vs.v.route ? "Ambulance on its way" : "Paramedics on their way", `You fainted. Help arrives in ${left(vs.picked)}`);
          return false;
        }
        if (vs.v.route && vs.routeCum && serverNow < vs.arrives) {
          // In the ambulance, on the way to hospital.
          vs.van.object.visible = true;
          placeVan(vs, vs.v.route, vs.routeCum, (serverNow - vs.picked) / Math.max(1, vs.arrives - vs.picked), dt);
          me.object.visible = false;
          traveller.pos = { lng: vs.van.lng, lat: vs.van.lat };
          traveller.heading = vs.van.heading ?? traveller.heading;
          setHud((h) => (h.street ? { ...h, street: null } : h)); // no street names from inside the ambulance
          showCare("🚑", `To ${vs.v.hospital}`, `Arrives in ${left(vs.arrives)}`);
          return true;
        }
        if (serverNow < vs.discharged) {
          if (vs.v.route) {
            me.object.visible = false; // inside, being treated
            traveller.pos = { lng: vs.van.lng, lat: vs.van.lat };
          } else {
            vs.van.object.visible = false;
          }
          showCare("🏥", vs.v.route ? `Being treated at ${vs.v.hospital}` : "Paramedics are treating you", `Out in ${left(vs.discharged)} · bill ${vs.v.bill} coins`);
          return !!vs.v.route;
        }
        if (!vs.leaving && now - vs.lastTry > 2000) void leaveHospital(now);
        return !!vs.v.route;
      }

      async function leaveHospital(now: number) {
        const vs = visit;
        if (!vs) return;
        vs.leaving = true;
        vs.lastTry = now;
        const { data } = await supabase.rpc("leave_hospital");
        if (disposed || visit !== vs) return;
        const r = data as { ok: boolean; reason?: string; lng?: number; lat?: number; hospital?: string; energy?: number } | null;
        if (!r?.ok && r?.reason !== "no_visit") {
          vs.leaving = false; // not quite yet (clocks differ): again shortly
          return;
        }
        const lng = r.lng ?? vs.v.lng;
        const lat = r.lat ?? vs.v.lat;
        endVisit();
        traveller.pos = { lng, lat };
        traveller.v = 0;
        traveller.energy = r.energy ?? 70;
        traveller.phase = "idle";
        warned.energy = 100;
        saved = { lng, lat };
        lastSave = performance.now() + 6000; // a moment before the first save: the hop from the hospital onto the road
        network = null;
        onRoad = null;
        builtFrom = "";
        lastNetworkCheck = 0;
        snapReachM = 1500;
        buildRoads();
        await refreshVehicles();
        void refreshSpots();
        say(`Discharged from ${r.hospital ?? vs.v.hospital}. You've got ${Math.round(traveller.energy)} energy: pace yourself, and rest before it runs low.`, true);
        if (damagedBike) {
          // Back to the bicycle: it waits, damaged, where they fell.
          const bike = damagedBike;
          damagedBike = null;
          adviceKey = "bike";
          advicePlace = { name: "your bicycle", lng: bike.lng, lat: bike.lat };
          setHud((h) => ({
            ...h,
            advice: { key: "bike", text: "Your bicycle is damaged where you collapsed. Go back to it and call a mechanic to repair it (30 coins).", place: advicePlace },
          }));
        }
      }

      /** On loading: energy, the keg, and a faint or hospital visit in progress. */
      async function loadCondition() {
        const { data } = await supabase.rpc("my_condition");
        if (disposed || !data) return;
        const c = data as { energy: number; fainted: boolean; resting: boolean; keg: { fuel: number; usesLeft: number } | null; hospital: VisitJson | null };
        traveller.energy = c.energy;
        traveller.resting = c.resting;
        keg = c.keg;
        showKeg();
        if (c.hospital) startVisit(c.hospital);
        else if (c.fainted) faint();
      }
      void loadCondition();
      void refreshSpots();

      // ---- Rentals and taxis come to the player --------------------------------
      // A bicycle or motorbike renter waits at the nearest bus stop with the bike;
      // a taxi driver drives to a pickup point on the nearest road and waits there.
      // The server times it all (request_pickup, board_taxi, start_vehicle).
      type PickupJson = {
        kind: "bicycle" | "motorbike" | "taxi";
        name: string;
        lng: number;
        lat: number;
        driverPath: import("@/game/geo").Coord[] | null;
        toName: string | null;
        fare: number | null;
        tripMetres: number | null;
        requestedAt: string;
        readyAt: string;
        expiresAt: string;
        now: string;
      };
      type Pickup = {
        p: PickupJson;
        offset: number; // the server's clock minus this device's, in ms
        requested: number;
        ready: number;
        expires: number;
        cum: number[] | null;
        entities: import("@/game/ThreeMapLayer").MapEntity[];
        renter: ReturnType<typeof models.buildAvatar> | null;
        car: import("@/game/ThreeMapLayer").MapEntity | null;
        then: Place | null; // a taxi: where the player asked to go
      };
      let pickup: Pickup | null = null;
      const PICKUP_AT_M = 30; // the server allows 35

      function showPickup(icon: string, title: string, status: string, action: string | null) {
        setHud((h) =>
          h.pickup?.title === title && h.pickup.status === status && h.pickup.action === action
            ? h
            : { ...h, pickup: { icon, title, status, action } },
        );
      }

      function startPickup(p: PickupJson, then: Place | null = null) {
        endPickup();
        const entities: import("@/game/ThreeMapLayer").MapEntity[] = [];
        let renter: Pickup["renter"] = null;
        let car: Pickup["car"] = null;
        if (p.kind === "taxi") {
          const first = p.driverPath?.[0] ?? [p.lng, p.lat];
          car = layer.add({ object: models.makeTaxi(), lng: first[0], lat: first[1], heading: 0 });
          entities.push(car);
        } else {
          renter = models.buildAvatar(lookForId(`renter:${p.requestedAt}`));
          renter.root.add(layer.billboard(models.makeNameplate(p.kind === "bicycle" ? "BICYCLE HIRE" : "OKADA HIRE", "#1E9E62")));
          entities.push(layer.add({ object: renter.root, lng: p.lng, lat: p.lat, heading: 0 }));
          // The bike stands beside the renter.
          const k = 1.6 * layer.enlargement();
          entities.push(layer.add({ object: models.makeVehicleModel(p.kind), lng: p.lng + k / (111320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat, heading: 0 }));
        }
        pickup = {
          p,
          offset: Date.parse(p.now) - Date.now(),
          requested: Date.parse(p.requestedAt),
          ready: Date.parse(p.readyAt),
          expires: Date.parse(p.expiresAt),
          cum: p.driverPath ? cumulativeOf(p.driverPath) : null,
          entities,
          renter,
          car,
          then,
        };
      }

      function endPickup() {
        if (!pickup) return;
        for (const e of pickup.entities) layer.remove(e);
        pickup = null;
        setHud((h) => (h.pickup ? { ...h, pickup: null } : h));
      }

      /** One frame: the taxi drives in, the renter waits; the banner says how far the player has to go. */
      function pickupTick(now: number, dt: number, t: number) {
        const pk = pickup!;
        const serverNow = Date.now() + pk.offset;
        if (serverNow > pk.expires) {
          void supabase.rpc("cancel_pickup");
          const who = pk.p.kind === "taxi" ? "The taxi driver" : "The renter";
          endPickup();
          say(`${who} waited 15 minutes and left.`, true);
          return;
        }
        const away = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [pk.p.lng, pk.p.lat]);
        const there = away <= PICKUP_AT_M;
        const far = there ? "you're there" : `${geo.formatDistance(away)} away: walk there`;
        if (pk.p.kind === "taxi") {
          if (pk.car && pk.p.driverPath && pk.cum) {
            const f = Math.max(0, Math.min(1, (serverNow - pk.requested) / Math.max(1, pk.ready - pk.requested)));
            const { pos, segment } = alongPath(pk.p.driverPath, pk.cum, f * pk.cum[pk.cum.length - 1]);
            const heading = geo.headingOf(pk.p.driverPath[segment - 1], pk.p.driverPath[segment]);
            pk.car.lng = pos[0];
            pk.car.lat = pos[1];
            pk.car.heading = pk.car.heading === undefined ? heading : geo.turnTowards(pk.car.heading, heading, Math.min(1, 6 * dt));
          }
          const arrived = serverNow >= pk.ready;
          showPickup(
            "🚕",
            `Taxi to ${pk.p.toName} · ${pk.p.fare} coins`,
            arrived ? (there ? "Your taxi is here" : `Your taxi is waiting at the pickup point, ${geo.formatDistance(away)} away`) : `Arrives in ${clock((pk.ready - serverNow) / 1000)} · ${far}`,
            arrived && there ? `Get in · ${pk.p.fare} coins` : null,
          );
        } else {
          if (pk.renter) {
            // The renter turns to watch the player come.
            const e = pk.entities[0];
            e.heading = geo.headingOf([e.lng, e.lat], [traveller.pos.lng, traveller.pos.lat]);
            models.animateAvatar(pk.renter, { mode: "walk", phase: "idle", moving: 0, distance: 0 }, dt, t);
          }
          const kind = pk.p.kind as VehicleKind;
          showPickup(
            kind === "bicycle" ? "🚲" : "🏍",
            `${VEHICLES[kind].name} hire at ${pk.p.name}`,
            there ? "The renter is here with your ride" : far,
            there ? `Rent it · ${VEHICLES[kind].ratePerMinute} coins a minute` : null,
          );
        }
      }

      /** Ask for a bicycle or motorbike: a renter brings one to the nearest bus stop. */
      async function requestBikePickup(kind: "bicycle" | "motorbike") {
        if (traveller.mode !== "walk") {
          say("Get off first (tap Walk), then ask for a rental.", true);
          return;
        }
        await savePosition();
        const at = { ...traveller.pos };
        const { data } = await supabase.rpc("stops_near", { p_kind: "bus", p_lng: at.lng, p_lat: at.lat, p_limit: 1 });
        const stop = (data as TransitStop[] | null)?.[0];
        const spot = stop && stop.metres <= 2000 ? { name: stop.name, lng: stop.lng, lat: stop.lat, metres: stop.metres } : { name: "where you are", ...at, metres: 0 };
        const { data: res } = await supabase.rpc("request_pickup", { p_kind: kind, p_lng: spot.lng, p_lat: spot.lat, p_name: spot.name });
        const r = res as { ok: boolean; reason?: string; pickup?: PickupJson } | null;
        if (disposed) return;
        if (!r?.ok || !r.pickup) {
          say(r?.reason === "vehicle" ? "Get off first (tap Walk), then ask for a rental." : "Couldn't arrange a rental just now. Try again.", true);
          return;
        }
        startPickup(r.pickup);
        if (spot.metres > PICKUP_AT_M) void planDirections({ lng: spot.lng, lat: spot.lat }, spot.name, true);
        say(
          spot.metres > PICKUP_AT_M
            ? `A ${vehicleName(kind)} renter will meet you at ${spot.name}, ${geo.formatDistance(spot.metres)} away. Walk there: the meter starts when you ride off.`
            : `The ${vehicleName(kind)} renter is right here.`,
        );
      }

      /** A random point `m` metres from `p`. */
      const somewhereNear = (p: LngLat, m: number) => {
        const angle = Math.random() * 2 * Math.PI;
        return { lng: p.lng + (Math.sin(angle) * m) / (111320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat + (Math.cos(angle) * m) / 110574 };
      };

      /** A taxi to a place: the driver's way to the nearest road a car can reach, and the trip from there. */
      async function quoteTaxi(place: Place): Promise<TaxiQuote | string> {
        const at = { ...traveller.pos };
        if (geo.distanceM([at.lng, at.lat], [place.lng, place.lat]) > BUS_RANGE_M) return "Taxis go up to 40 km. For further, take a long-distance bus or a plane.";
        let driverPath: import("@/game/geo").Coord[] | null = null;
        for (let i = 0; i < 5 && !driverPath; i++) {
          const found = (await routeOnOwnRoads(somewhereNear(at, 1200 + Math.random() * 1300), at, "car"))?.path ?? null;
          if (found && cumulativeOf(found).at(-1)! > 300) driverPath = thinPath(found);
        }
        if (!driverPath) return "No taxi can reach you here just now. Try from a bigger road.";
        const kerb = driverPath[driverPath.length - 1];
        const pickupAt = { lng: kerb[0], lat: kerb[1] };
        let trip = (await routeOnOwnRoads(pickupAt, place, "car"))?.path ?? null;
        if (!trip) {
          const { route, fallback } = await fetchRoute(pickupAt, place, "car");
          if (!fallback) trip = [[pickupAt.lng, pickupAt.lat], ...route.coords];
        }
        if (!trip) return "Couldn't work out the way there just now. Try again in a moment.";
        const tripPath = thinPath(trip);
        const end = tripPath[tripPath.length - 1];
        const metres = Math.max(cumulativeOf(tripPath).at(-1)!, geo.distanceM(kerb, end));
        if (metres < 300) return `${place.name} is within walking distance.`;
        return {
          place,
          pickup: { name: "the pickup point", lng: pickupAt.lng, lat: pickupAt.lat, walkM: geo.distanceM([at.lng, at.lat], kerb) },
          driverPath,
          tripPath,
          to: { lng: end[0], lat: end[1] },
          metres,
          fare: transitFare("taxi", metres),
          driverSeconds: Math.max(15, cumulativeOf(driverPath).at(-1)! / DRIVER_SPEED),
          rideSeconds: metres / transitSpeedFor("taxi", metres),
        };
      }

      async function callTaxi(q: TaxiQuote): Promise<string | null> {
        if (traveller.mode !== "walk") return "Get off your vehicle first (tap Walk), then call a taxi.";
        await savePosition();
        const { data } = await supabase.rpc("request_pickup", {
          p_kind: "taxi",
          p_lng: q.pickup.lng,
          p_lat: q.pickup.lat,
          p_name: "Pickup point",
          p_driver_path: q.driverPath,
          p_trip_path: q.tripPath,
          p_to_name: q.place.name,
          p_to_lng: q.to.lng,
          p_to_lat: q.to.lat,
        });
        const r = data as { ok: boolean; reason?: string; fare?: number; pickup?: PickupJson } | null;
        if (!r?.ok || !r.pickup) {
          const why: Record<string, string> = {
            coins: `You need ${r?.fare ?? q.fare} coins for this taxi.`,
            vehicle: "Get off your vehicle first (tap Walk), then call a taxi.",
            on_trip: "You're already on a trip.",
            route: "Taxis go up to 40 km.",
            far: "That pickup point is too far from you.",
            path: "Couldn't plan that taxi ride. Try again.",
          };
          return why[r?.reason ?? ""] ?? "Couldn't call a taxi just now. Try again.";
        }
        startPickup(r.pickup, q.place);
        if (q.pickup.walkM > PICKUP_AT_M) void planDirections({ lng: q.pickup.lng, lat: q.pickup.lat }, "the pickup point", true);
        say(
          q.pickup.walkM > PICKUP_AT_M
            ? `Taxi called. Walk to the pickup point (${geo.formatDistance(q.pickup.walkM)}, blue line); the driver will be there in about ${clock(q.driverSeconds)}.`
            : `Taxi called: the driver will be here in about ${clock(q.driverSeconds)}.`,
        );
        return null;
      }

      /** The banner's button: get in the taxi, or ride off on the rented bike. */
      async function pickupAction() {
        const pk = pickup;
        if (!pk || busy) return;
        if (pk.p.kind !== "taxi") {
          await chooseVehicle(pk.p.kind, "rent");
          return;
        }
        setBusy(true);
        try {
          await savePosition();
          const { data } = await supabase.rpc("board_taxi");
          const r = data as { ok: boolean; reason?: string; fare?: number; balance?: number; trip?: TransitTrip } | null;
          if (disposed) return;
          if (!r?.ok || !r.trip) {
            const why: Record<string, string> = {
              far_pickup: "Walk to the taxi first: it's at the pickup point.",
              not_ready: "The taxi isn't there yet.",
              coins: `You need ${r?.fare ?? pk.p.fare} coins for the fare.`,
              dome: "A Lockdown dome covers that place.",
              pickup: "The taxi has gone.",
            };
            say(why[r?.reason ?? ""] ?? "Couldn't get in just now. Try again.", true);
            if (r?.reason === "pickup") endPickup();
            return;
          }
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          const then = pk.then;
          endPickup();
          endDirections();
          startRide(r.trip, pk.p.toName ?? r.trip.to, then);
          say(`You're in. The taxi takes you to ${pk.p.toName}.`);
        } finally {
          setBusy(false);
        }
      }

      async function cancelPickup() {
        const pk = pickup;
        if (!pk) return;
        await supabase.rpc("cancel_pickup");
        endPickup();
        endDirections();
        say(pk.p.kind === "taxi" ? "Taxi cancelled: nothing to pay." : "Rental cancelled.");
      }

      void supabase.rpc("my_pickup").then(({ data }) => {
        if (!disposed && data && !pickup) startPickup(data as PickupJson);
      });

      // ---- Landmarks: visit famous places and answer a question for coins and intel ----
      let landmarks: Landmark[] = [];
      let landmarksAt = -Infinity;
      let landmarksFrom: LngLat | null = null;
      const landmarkMarkers = new Map<number, { entity: import("@/game/ThreeMapLayer").MapEntity; star: import("three").Object3D }>();
      const LANDMARK_SHOWN_M = 6000;

      async function refreshLandmarks(): Promise<Landmark[]> {
        const from = { ...traveller.pos };
        landmarksAt = performance.now();
        landmarksFrom = from;
        const { data } = await supabase.rpc("landmarks_near", { p_lng: from.lng, p_lat: from.lat, p_limit: 8 });
        if (disposed || !data) return landmarks;
        const now = Date.now();
        landmarks = (data as Landmark[]).map((l) => ({ ...l, canTry: !(l.nextAt && Date.parse(l.nextAt) > now) }));
        // A monument with its name at each landmark nearby.
        const shown = new Set<number>();
        for (const lm of landmarks) {
          if (lm.metres > LANDMARK_SHOWN_M) continue;
          shown.add(lm.id);
          if (landmarkMarkers.has(lm.id)) continue;
          const marker = models.makeLandmarkMarker();
          marker.group.add(layer.billboard(models.makeNameplate(lm.name.toUpperCase(), "#8A5A00")));
          landmarkMarkers.set(lm.id, { entity: layer.add({ object: marker.group, lng: lm.lng, lat: lm.lat, heading: 0 }), star: marker.star });
        }
        for (const [id, m] of landmarkMarkers) {
          if (shown.has(id)) continue;
          layer.remove(m.entity);
          landmarkMarkers.delete(id);
        }
        showLandmarkHere();
        return landmarks;
      }

      /** At a landmark? Then a Check in button (unless it was tried in the last day). */
      function showLandmarkHere() {
        const at: [number, number] = [traveller.pos.lng, traveller.pos.lat];
        const lm = ride || visit ? null : landmarks.find((l) => geo.distanceM(at, [l.lng, l.lat]) <= l.radiusM) ?? null;
        const canTry = !!lm && lm.canTry;
        setHud((h) =>
          h.landmarkHere?.landmark.id === lm?.id && h.landmarkHere?.canTry === canTry && h.landmarkHere?.landmark.reward === lm?.reward
            ? h
            : { ...h, landmarkHere: lm ? { landmark: lm, canTry } : null },
        );
      }

      function landmarkTick(now: number, dt: number) {
        for (const m of landmarkMarkers.values()) m.star.rotation.y += dt * 1.5;
        if (now - landmarksAt < 5000) return;
        const moved = landmarksFrom ? geo.distanceM([landmarksFrom.lng, landmarksFrom.lat], [traveller.pos.lng, traveller.pos.lat]) : Infinity;
        if (moved > 150 || now - landmarksAt > 60000) void refreshLandmarks();
        else if (now - landmarksAt > 1000) showLandmarkHere();
      }

      setLandmarkActions({
        near: refreshLandmarks,
        start: async (lm) => {
          await savePosition(); // the server checks the player is there
          const { data } = await supabase.rpc("start_checkin", { p_landmark: lm.id });
          const r = data as ({ ok: boolean; reason?: string; nextAt?: string; deadline?: string; now?: string } & Partial<CheckinQuestion>) | null;
          if (!r?.ok) {
            if (r?.reason === "far") return `Get to ${lm.name} first: you need to be there to check in.`;
            if (r?.reason === "tomorrow") return `You've already tried ${lm.name} today. Come back tomorrow.`;
            return "Couldn't check in just now. Try again.";
          }
          // The server's deadline, on this device's clock.
          const endsAt = Date.now() + (Date.parse(r.deadline!) - Date.parse(r.now!));
          return { checkinId: r.checkinId!, landmark: r.landmark!, question: r.question!, options: r.options!, seconds: r.seconds!, endsAt };
        },
        answer: async (checkinId, choice) => {
          const { data } = await supabase.rpc("answer_checkin", { p_checkin: checkinId, p_choice: choice });
          const r = data as ({ ok: boolean; reason?: string; balance?: number | null; lead?: { lng: number; lat: number } | null } & Omit<CheckinResult, "lead">) | null;
          if (!r?.ok) return "Couldn't send your answer. Try again.";
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          if (r.lead) {
            lastSync = performance.now();
            void syncWorld(); // the lead shows on the map
          }
          void refreshLandmarks();
          return { correct: r.correct, late: r.late, answer: r.answer, fact: r.fact, reward: r.reward, first: r.first, lead: !!r.lead };
        },
        directionsTo: (lm) => void planDirections({ lng: lm.lng, lat: lm.lat }, lm.name),
      });
      void refreshLandmarks();

      // ---- Game loop -------------------------------------------------------
      let frame = 0;
      let last = performance.now();
      let lastHud = 0;
      let lastServices = 0;
      let lastGuide = 0;

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t = now / 1000;
        const c = controls.current;
        // On a bus, train or plane, the vehicle moves the hunter (and the player can't).
        const riding = ride ? rideStep(now, dt) : visit ? visitStep(now, dt) : false;

        // Keep a road network around the player as they travel, and refresh it
        // as more map tiles load (the first build may only see one tile).
        const stale =
          !network ||
          now - lastNetworkCheck > 5000 ||
          geo.distanceM([network.centre.lng, network.centre.lat], [traveller.pos.lng, traveller.pos.lat]) > 300;
        if (!riding && stale && now - lastNetworkCheck > 1000) {
          lastNetworkCheck = now;
          buildRoads(true);
        }

        // The player moves only while holding a key or the screen.
        const canMove = !frozen && !ride && !visit && !!onRoad;
        const { distance, events } = movement.step(traveller, { go: c.go || touchGo, sprint: c.sprint }, dt, t, canMove);
        for (const event of events) {
          if (event === "fainted") void savePosition(true); // the server confirms (it counts energy too); then the ambulance
        }

        if (!riding && network && onRoad) {
          if (distance > 0) {
            // Straight on at junctions, unless the player asked to turn.
            const aim = roads.positionOf(network, onRoad).heading;
            const before = onRoad;
            const { position, deadEnd, turned, passed } = roads.advance(network, onRoad, distance, aim, pendingTurn);
            const blockedBy = domeInTheWay(traveller.pos, roads.positionOf(network, position));
            if (blockedBy) {
              // A Lockdown dome: outsiders stop at its edge.
              traveller.v = 0;
              if (now - lastDomeWarning > 6000) {
                lastDomeWarning = now;
                const left = Math.max(1, Math.ceil((new Date(blockedBy.endsAt).getTime() - Date.now()) / 60000));
                say(`A Lockdown dome blocks the way for ${left} more min. Attack it with other hunters to break it, or wait it out.`, true);
              }
            }
            if (turned && !blockedBy) setTurn(0);
            if (passed && !blockedBy) justPassed = passed;
            else if (justPassed && !blockedBy) justPassed.metresSince += distance;
            onRoad = blockedBy ? before : position;
            if (deadEnd && !blockedBy) {
              traveller.v = 0;
              if (now - lastDeadEndCheck > 2000) {
                // Often just the edge of what's loaded: reload the roads and keep going if they continue.
                lastDeadEndCheck = now;
                lastNetworkCheck = now;
                buildRoads();
              } else if (onRoad) {
                onRoad = roads.reverse(onRoad);
                say("This road ends here. Keep going to head back, or pick another way.");
              }
            }
          }
          if (network && onRoad) {
            // Face along the road, turning on the spot too (e.g. after ↓).
            const p = roads.positionOf(network, onRoad);
            traveller.pos = { lng: p.lng, lat: p.lat };
            traveller.heading = geo.turnTowards(traveller.heading, p.heading, Math.min(1, 8 * dt));
          }
        }
        relicTick(now);
        if (!riding && now - lastGuide > 250) {
          lastGuide = now;
          updateGuide();
        }

        models.animateAvatar(
          avatar,
          {
            mode: traveller.mode,
            phase: traveller.phase,
            moving: traveller.v / movement.baseSpeed(traveller.mode),
            distance: distance / layer.enlargement(),
          },
          dt,
          t,
        );
        me.lng = traveller.pos.lng;
        me.lat = traveller.pos.lat;
        me.heading = traveller.heading;
        marker.halo.scale.setScalar(1 + Math.sin(t * 4) * 0.1);

        // Spin the finds, and pick up anything within reach.
        for (const [id, { item, model }] of onMap) {
          model.spin.rotation.y += dt * 2;
          if (riding || picking.has(id) || (retryAfter.get(id) ?? 0) > now) continue;
          if (geo.distanceM([traveller.pos.lng, traveller.pos.lat], [item.lng, item.lat]) < PICKUP_RADIUS_M) void pickUp(id);
        }
        if (!riding && (now - lastSync > 15000 || (syncedAt && geo.distanceM([syncedAt.lng, syncedAt.lat], [traveller.pos.lng, traveller.pos.lat]) > 200))) {
          lastSync = now;
          void syncWorld();
        }

        // Chase camera: behind the hunter, turned by however far the player has
        // looked around. Moving off swings it back behind them.
        if (!dragging && traveller.v > 0.5 && lookOffset !== 0) {
          lookOffset *= Math.exp(-1.5 * dt);
          if (Math.abs(lookOffset) < 0.5) lookOffset = 0;
        }
        const want = geo.compassFromHeading(traveller.heading) + lookOffset;
        const diff = ((want - camBearing) % 360 + 540) % 360 - 180;
        camBearing += dragging ? diff : diff * Math.min(1, 2.5 * dt);
        map.jumpTo({ center: [traveller.pos.lng, traveller.pos.lat], bearing: camBearing, zoom: ride ? rideZoom() : undefined });

        if (!ride && !visit && now - lastSave > SAVE_EVERY_MS) {
          lastSave = now;
          void savePosition();
        }

        // The street you're on, petrol stations and food within reach, and the rental meter ticking.
        if (!riding && now - lastServices > 1000) {
          lastServices = now;
          scanStreet();
          if (rental) showVehicle();
          checkLimits();
          computeActions();
        }

        if (!riding) announce(now); // aboard, others just see the hunter leave (and arrive)
        moveOthers(now, dt, t);
        nearTick(now);
        spotsTick(now);
        if (pickup && !ride) pickupTick(now, dt, t);
        landmarkTick(now, dt);

        if (now - lastHud > 100) {
          lastHud = now;
          const energy = Math.round(traveller.energy);
          const hunters = others.size;
          const radarLeft = Math.max(0, Math.round((radarUntil - Date.now()) / 1000));
          const turnTo = (p: Pointer | null) => (p ? { bearing: Math.round(p.bearing - map.getBearing()), metres: p.metres } : null);
          const radar = radarLeft > 0 ? { secondsLeft: radarLeft, relic: turnTo(radarSeen.relic), key: turnTo(radarSeen.key) } : null;
          const dome = domeStatus();
          const speedKmh = Math.round((traveller.v / movement.TIME_SCALE) * 3.6);

          // Point to the closest find, relative to the screen (the camera turns with the hunter).
          const here: [number, number] = [traveller.pos.lng, traveller.pos.lat];
          let nearest: Hud["nearest"] = null;
          let closest = Infinity;
          for (const { item } of ride ? [] : onMap.values()) {
            const d = geo.distanceM(here, [item.lng, item.lat]);
            if (d < closest) {
              closest = d;
              const compass = geo.compassFromHeading(geo.headingOf(here, [item.lng, item.lat]));
              nearest = { metres: Math.round(d), angle: Math.round(compass - map.getBearing()) };
            }
          }

          // Only re-render the display when something visible changed.
          setHud((h) =>
            h.energy === energy &&
            h.speedKmh === speedKmh &&
            h.nearest?.metres === nearest?.metres &&
            h.nearest?.angle === nearest?.angle &&
            h.hunters === hunters &&
            JSON.stringify(h.radar) === JSON.stringify(radar) &&
            JSON.stringify(h.dome) === JSON.stringify(dome)
              ? h
              : { ...h, energy, speedKmh, nearest, hunters, radar, dome },
          );
        }
      };

      map.on("load", () => {
        map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        // Above every road, bridge and tunnel line (the style puts some labels before
        // the bridges, so "before the first label" would hide the route under bridges),
        // but below the labels that follow them.
        const styleLayers = map.getStyle().layers;
        let lastRoad = -1;
        styleLayers.forEach((l, i) => {
          if (l.type === "line" && /^(road|bridge|tunnel)_/.test(l.id)) lastRoad = i;
        });
        const firstSymbol = styleLayers.slice(lastRoad + 1).find((l) => l.type === "symbol")?.id;
        // The route: a blue line with a white edge, so it stands out from yellow main roads and coins.
        map.addLayer(
          {
            id: "route-edge",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 20, 20] },
          },
          firstSymbol,
        );
        map.addLayer(
          {
            id: "route-line",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#2F6FEB", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3.5, 20, 13] },
          },
          firstSymbol,
        );
        styleMapForGame(map);
        map.addLayer(layer);
        frame = requestAnimationFrame(loop);
      });

      // Keyboard: hold ↑ (W, Space) to move and Shift to sprint; hold ↓ (S) to
      // turn round and go back; tap ← → (A, D) to turn at the next junction.
      const holdKeys: Record<string, keyof typeof controls.current> = {
        ArrowUp: "go",
        KeyW: "go",
        Space: "go",
        ArrowDown: "go",
        KeyS: "go",
        ShiftLeft: "sprint",
        ShiftRight: "sprint",
      };
      const backKeys = new Set(["ArrowDown", "KeyS"]);
      const tapKeys: Record<string, () => void> = {
        ArrowLeft: () => actions.current?.turn(-1),
        KeyA: () => actions.current?.turn(-1),
        ArrowRight: () => actions.current?.turn(1),
        KeyD: () => actions.current?.turn(1),
      };
      const typing = (e: KeyboardEvent) =>
        e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      const keyDown = (e: KeyboardEvent) => {
        if (typing(e)) return;
        if (holdKeys[e.code]) {
          e.preventDefault();
          // ↓ turns round and goes back; if turning round isn't allowed, it doesn't move you forward either.
          if (backKeys.has(e.code) && !e.repeat && actions.current?.turnAround() === false) return;
          if (backKeys.has(e.code) && e.repeat && !controls.current.go) return;
          controls.current[holdKeys[e.code]] = true;
        } else if (tapKeys[e.code]) {
          e.preventDefault();
          if (!e.repeat) tapKeys[e.code]();
        }
      };
      const keyUp = (e: KeyboardEvent) => {
        if (!holdKeys[e.code]) return;
        if (!typing(e)) e.preventDefault();
        controls.current[holdKeys[e.code]] = false;
      };
      window.addEventListener("keydown", keyDown);
      window.addEventListener("keyup", keyUp);

      cleanup = () => {
        void savePosition();
        cancelAnimationFrame(frame);
        window.clearTimeout(hintTimer);
        window.removeEventListener("keydown", keyDown);
        window.removeEventListener("keyup", keyUp);
        lookArea.removeEventListener("pointerdown", lookStart);
        window.removeEventListener("pointermove", lookMove);
        window.removeEventListener("pointerup", lookEnd);
        window.removeEventListener("pointercancel", lookEnd);
        stopSteering();
        document.removeEventListener("visibilitychange", saveOnHide);
        actions.current = null;
        huntActions.current = null;
        sayBye();
        window.removeEventListener("pagehide", sayBye);
        document.removeEventListener("visibilitychange", leaving);
        for (const channel of areaChannels.values()) void supabase.removeChannel(channel);
        if (huntChannel) void supabase.removeChannel(huntChannel);
        areaChannels.clear();
        map.remove();
      };
    })().catch(() => setFailed(true));

    return () => {
      disposed = true;
      cleanup();
    };
  }, [startLng, startLat, startMode, lookKey, playerId, username, huntId]);

  if (failed) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="max-w-sm">This device couldn&apos;t start the 3D map. Try a recent version of Chrome, Edge or Safari.</p>
        <Link href="/lobby" className="text-gold">Back to the lobby</Link>
      </div>
    );
  }

  const energyColour = hud.energy < 20 ? "bg-danger" : hud.energy < 50 ? "bg-gold" : "bg-[#1E9E62]";
  const segment = (on: boolean) => `rounded-lg px-3 text-sm font-bold ${on ? "bg-gold text-ink" : "text-paper"}`;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-map">
      {/* MapLibre sets its container to position: relative, so it gets its own full-size box. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        {/* Row 1: status */}
        <div className="flex items-center gap-2">
        <Link href="/lobby" aria-label="Back to the lobby" className="pointer-events-auto flex size-11 items-center justify-center rounded-xl bg-ink text-paper">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div className="pointer-events-auto flex h-11 min-w-[110px] flex-1 items-center gap-2 rounded-xl bg-ink px-3 sm:max-w-xs" aria-label={`Energy ${hud.energy} of 100`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#1E9E62" aria-hidden="true">
            <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
          </svg>
          <div className="h-2 flex-1 overflow-hidden rounded bg-line">
            <div className={`h-full ${energyColour}`} style={{ width: `${hud.energy}%` }} />
          </div>
          <span className="w-7 text-right text-sm font-bold">{hud.energy}</span>
        </div>
        <span className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm font-bold" aria-label={`${hud.coins} coins`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2.4" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
          </svg>
          {hud.coins.toLocaleString("en-NG")}
        </span>
        <button
          type="button"
          onClick={() => setBagOpen(true)}
          className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm font-bold"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C3A6FF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" />
          </svg>
          Bag{hud.relics > 0 ? ` · ${hud.relics}` : ""}
          {hud.leads > 0 && <span className="rounded-md bg-[#C3A6FF] px-1.5 text-xs text-ink">{hud.leads} lead{hud.leads > 1 ? "s" : ""}</span>}
        </button>
        <button
          type="button"
          aria-label="How to move"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((o) => !o)}
          className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink text-lg font-extrabold"
        >
          ?
        </button>
        </div>

        {/* Row 2: how you travel, and what's nearby */}
        <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen((o) => !o)}
          className={`pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold ${searchOpen ? "bg-gold text-ink" : "bg-ink text-paper"}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2l9 9-9 9-9-9z" />
            <path d="M9 13v-2a1 1 0 0 1 1-1h4M12 8l2 2-2 2" />
          </svg>
          Directions
        </button>
        <div className="pointer-events-auto flex h-11 rounded-xl bg-ink p-1" role="group" aria-label="Travel mode">
          <button
            type="button"
            aria-pressed={hud.mode === "walk"}
            disabled={hud.busy}
            onClick={() => actions.current?.getOff()}
            className={segment(hud.mode === "walk")}
          >
            Walk
          </button>
          <button
            type="button"
            aria-pressed={hud.mode !== "walk"}
            onClick={() => setGarage(actions.current?.vehicles() ?? [])}
            className={`${segment(hud.mode !== "walk")} flex items-center gap-1.5`}
          >
            {hud.vehicle ? VEHICLES[hud.vehicle.kind].name : "Vehicles"}
            {hud.vehicle?.fuel != null && (
              <span className={`text-xs ${hud.vehicle.fuel < 15 ? "text-danger" : ""}`}>⛽ {Math.round(hud.vehicle.fuel)}%</span>
            )}
            {hud.vehicle?.tyre != null && (
              <span className={`text-xs ${hud.vehicle.tyre < 40 ? "text-danger" : ""}`}>{hud.vehicle.tyre <= 0 ? "flat tyre" : `🛞 ${Math.round(hud.vehicle.tyre)}%`}</span>
            )}
            {hud.vehicle?.engine != null && hud.vehicle.engine < 50 && (
              <span className={`text-xs ${hud.vehicle.engine < 30 ? "text-danger" : ""}`}>🔧 {Math.round(hud.vehicle.engine)}%</span>
            )}
            {hud.vehicle?.meter && <span className="text-xs font-semibold">· {hud.vehicle.meter}</span>}
          </button>
        </div>
        <button
          type="button"
          disabled={!!hud.ride}
          onClick={() => setTransitOpen(true)}
          className={`pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold disabled:opacity-50 ${
            hud.stopHere ? "bg-gold text-ink" : "bg-ink text-paper"
          }`}
        >
          <span aria-hidden="true">{hud.stopHere?.icon ?? "🚌"}</span>
          {hud.stopHere?.label ?? "Bus · Train · Plane"}
        </button>
        <button
          type="button"
          onClick={() => setLandmarksOpen({ quiz: null, message: null })}
          className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm font-bold text-paper"
        >
          <span aria-hidden="true">🏛</span>
          Landmarks
        </button>
        {hud.landmarkHere && !hud.ride && !hud.care && (
          <button
            type="button"
            disabled={!hud.landmarkHere.canTry || checkingIn}
            onClick={() => void checkIn(hud.landmarkHere!.landmark)}
            className="pointer-events-auto h-11 rounded-xl bg-gold px-3 text-sm font-bold text-ink disabled:opacity-50"
          >
            {hud.landmarkHere.canTry
              ? `🏛 Check in at ${hud.landmarkHere.landmark.name} · ${hud.landmarkHere.landmark.reward} coins`
              : `🏛 ${hud.landmarkHere.landmark.name}: back tomorrow`}
          </button>
        )}
        {hud.actions.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={hud.busy}
            onClick={() => actions.current?.act(a.id)}
            className="pointer-events-auto h-11 rounded-xl bg-gold px-3 text-sm font-bold text-ink disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
        {hud.keg && (
          <div className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm" aria-label="Your fuel keg">
            <span aria-hidden="true">🛢</span>
            <span className="font-bold">{hud.keg.fuel > 0 ? `Keg ${Math.round(hud.keg.fuel)}%` : "Empty keg"}</span>
            <span className="text-xs text-muted">{hud.keg.usesLeft} uses left</span>
          </div>
        )}
        {hud.nearest && (
          <div className="pointer-events-auto flex h-11 items-center gap-2 rounded-xl bg-ink px-3 text-sm" aria-label={`Nearest find ${hud.nearest.metres} metres away`}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="#F4B41A"
              aria-hidden="true"
              style={{ transform: `rotate(${hud.nearest.angle}deg)` }}
            >
              <path d="M12 2l6 18-6-4-6 4z" />
            </svg>
            <span className="text-muted">Nearest find</span>
            <span className="font-bold">{hud.nearest.metres >= 1000 ? `${(hud.nearest.metres / 1000).toFixed(1)} km` : `${hud.nearest.metres} m`}</span>
          </div>
        )}
        {hud.radar && (
          <div className="pointer-events-auto flex h-11 items-center gap-2 rounded-xl bg-[#3B2F0A] px-3 text-sm text-paper ring-1 ring-gold" aria-label="Radar">
            <span className="font-bold text-gold">Radar</span>
            {hud.radar.relic ? (
              <span className="flex items-center gap-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#F4B41A" aria-hidden="true" style={{ transform: `rotate(${hud.radar.relic.bearing}deg)` }}>
                  <path d="M12 2l6 18-6-4-6 4z" />
                </svg>
                relic {hud.radar.relic.metres >= 1000 ? `${(hud.radar.relic.metres / 1000).toFixed(1)} km` : `${hud.radar.relic.metres} m`}
              </span>
            ) : (
              <span className="text-paper/70">no relic within 3 km</span>
            )}
            {hud.radar.key && (
              <span className="flex items-center gap-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#3DD68C" aria-hidden="true" style={{ transform: `rotate(${hud.radar.key.bearing}deg)` }}>
                  <path d="M12 2l6 18-6-4-6 4z" />
                </svg>
                key {hud.radar.key.metres} m
              </span>
            )}
            <span className="text-xs text-paper/70">
              {Math.floor(hud.radar.secondsLeft / 60)}:{String(hud.radar.secondsLeft % 60).padStart(2, "0")}
            </span>
          </div>
        )}
        {hud.dome && (
          <div className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl bg-[#3A1E5C] px-3 text-sm ring-1 ring-[#C89BFF]" aria-label="Lockdown dome">
            <span aria-hidden="true">🔒</span>
            {hud.dome.inside
              ? `${hud.dome.mine ? "Your dome" : "Inside a dome"} over Key ${hud.dome.key} · ${hud.dome.minutesLeft} min`
              : `Dome over Key ${hud.dome.key} · ${hud.dome.minutesLeft} min`}
          </div>
        )}
        {hud.rain && (
          <div className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl bg-[#173B5C] px-3 text-sm" aria-label="Rain">
            <span aria-hidden="true">🌧</span>
            {hud.rain.slowed ? "Rain: 20% slower on foot or bike" : "Rain"}
          </div>
        )}
        {hud.hunters > 0 && (
          <div className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm" aria-label={`${hud.hunters} other hunters nearby`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7FB2FF" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.6-4.8-4-5.6" />
            </svg>
            <span className="font-bold">{hud.hunters}</span>
            <span className="text-muted">nearby</span>
          </div>
        )}
        {hud.turn !== 0 && (
          <button
            type="button"
            onClick={() => actions.current?.turn(hud.turn as -1 | 1)}
            className="pointer-events-auto flex h-11 items-center gap-2 rounded-xl bg-gold px-3 text-sm font-bold text-ink"
            aria-label={`Turning ${hud.turn === -1 ? "left" : "right"} at the next junction. Press to cancel.`}
          >
            <span aria-hidden="true">{hud.turn === -1 ? "↰" : "↱"}</span>
            Next junction: {hud.turn === -1 ? "left" : "right"}
            <span aria-hidden="true" className="text-ink/70">✕</span>
          </button>
        )}
        </div>

        {searchOpen && (
          <PlaceSearch
            near={() => actions.current?.where() ?? { lng: startLng, lat: startLat }}
            onPick={(place) => {
              actions.current?.goTo(place);
              setSearchOpen(false);
            }}
          />
        )}

        {/* Directions: the next turn. The player steers; this only guides. */}
        {hud.guide && (
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-[#1E9E62] p-3 text-paper" role="status" aria-label="Directions">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0" style={{ transform: `rotate(${hud.guide.arrow}deg)` }}>
              <path d="M12 2l7 9h-4.5v11h-5V11H5z" />
            </svg>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-display text-base font-extrabold leading-tight">{hud.guide.step}</span>
              <span className="truncate text-xs text-paper/80">{hud.guide.trip}</span>
            </div>
            <button type="button" onClick={() => actions.current?.endDirections()} className="shrink-0 rounded-lg bg-ink/30 px-2 py-1 text-xs font-bold">
              End
            </button>
          </div>
        )}

        {/* The ambulance, the hospital, a mechanic on the way. */}
        {hud.care && (
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-[#D62828] p-3 text-paper" role="status" aria-label="Being looked after">
            <span className="text-2xl" aria-hidden="true">
              {hud.care.icon}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-display text-base font-extrabold leading-tight">{hud.care.title}</span>
              <span className="truncate text-xs text-paper/85">{hud.care.status}</span>
            </div>
          </div>
        )}

        {/* A rental waiting at a bus stop, or a taxi on its way. */}
        {hud.pickup && !hud.ride && !hud.care && (
          <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2 rounded-2xl bg-[#1E9E62] p-3 text-paper" role="status" aria-label="Your pickup">
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">
                {hud.pickup.icon}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-display text-base font-extrabold leading-tight">{hud.pickup.title}</span>
                <span className="truncate text-xs text-paper/85">{hud.pickup.status}</span>
              </div>
              <button type="button" onClick={() => actions.current?.cancelPickup()} className="shrink-0 rounded-lg bg-ink/30 px-2 py-1 text-xs font-bold">
                Cancel
              </button>
            </div>
            {hud.pickup.action && (
              <button
                type="button"
                disabled={hud.busy}
                onClick={() => actions.current?.pickupAction()}
                className="h-11 rounded-xl bg-gold px-3 text-sm font-bold text-ink disabled:opacity-50"
              >
                {hud.pickup.action}
              </button>
            )}
          </div>
        )}

        {/* A warning: tired, fuel low, soft tyres, a worn engine; and the nearest place that helps. */}
        {hud.advice && !hud.care && (
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-[#3B2F0A] p-3 text-sm text-paper ring-1 ring-gold" role="alert">
            <span className="min-w-0 flex-1">{hud.advice.text}</span>
            {hud.advice.place && (
              <button type="button" onClick={() => actions.current?.followAdvice()} className="shrink-0 rounded-lg bg-gold px-2 py-1 text-xs font-bold text-ink">
                Directions
              </button>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => actions.current?.dismissAdvice()} className="shrink-0 rounded-lg px-1 text-xs font-bold text-paper/70">
              ✕
            </button>
          </div>
        )}

        {/* On a bus, train or plane: where to, and when it leaves or arrives. */}
        {hud.ride && (
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-[#2F6FEB] p-3 text-paper" role="status" aria-label="Your trip">
            <span className="text-2xl" aria-hidden="true">
              {hud.ride.icon}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-display text-base font-extrabold leading-tight">{hud.ride.title}</span>
              <span className="truncate text-xs text-paper/85">{hud.ride.status}</span>
            </div>
            {hud.ride.canCancel && (
              <button type="button" onClick={() => actions.current?.cancelTrip()} className="shrink-0 rounded-lg bg-ink/30 px-2 py-1 text-xs font-bold">
                Cancel
              </button>
            )}
          </div>
        )}

        {helpOpen && (
          <div className="pointer-events-auto flex max-w-md flex-col gap-2 rounded-2xl bg-ink p-4 text-sm" role="note">
            <p className="font-bold">How to move</p>
            <p>
              <b>Keyboard:</b> hold ↑ to go, ↓ to turn round and go back. Tap ← or → to turn left or right at the next junction (or
              the one you just passed). Hold Shift to sprint.
            </p>
            <p>
              <b>Touch:</b> press and hold the lower part of the screen to walk. Swipe left or right there to turn, and down to turn
              back. Hold SPRINT to run or pedal faster.
            </p>
            <p>
              <b>Look around:</b> drag the map (the upper part on a phone) left or right to turn the view, up or down to tilt it.
            </p>
            <p>
              <b>Directions:</b> search a place or address, or tap a spot on the map. A blue line and turn-by-turn directions
              show the way; you steer.
            </p>
            <p>
              <b>Bus, train or plane:</b> get to a bus stop, train station or airport (the button shows the nearest), pay the fare,
              and it carries you. Buses stop along main roads.
            </p>
            <button type="button" onClick={() => setHelpOpen(false)} className="self-start font-bold text-gold">
              Got it
            </button>
          </div>
        )}

        {/* Row 3: the hunt (riddle, keys, Search here) */}
        {huntId && <HuntPanel huntId={huntId} actions={huntActions} />}
      </div>

      {hud.street && (
        <div
          className="pointer-events-none absolute bottom-[112px] left-1/2 sm:bottom-[100px] flex max-w-[calc(100%-200px)] -translate-x-1/2 items-center gap-1.5 rounded-full bg-paper px-4 py-1.5 text-sm font-bold text-ink shadow sm:max-w-md"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
          aria-label={`You're on ${hud.street}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#2F6FEB" aria-hidden="true">
            <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
          </svg>
          <span className="truncate">{hud.street}</span>
        </div>
      )}

      <p
        role="status"
        className={`absolute bottom-9 left-3 right-[104px] rounded-2xl bg-ink px-4 py-3 text-sm sm:left-1/2 sm:right-auto sm:w-[min(520px,calc(100%-24px))] sm:-translate-x-1/2 sm:text-center ${
          hud.alert ? "ring-2 ring-gold" : ""
        } ${hud.hint ? "" : "invisible"}`}
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        {hud.hint}
      </p>

      {/* Rain from a Rain Charm: falling streaks over the map, a little darker. */}
      {hud.rain && <div className="loota-rain pointer-events-none absolute inset-0" aria-hidden="true" />}

      {bagOpen && (
        <BagPanel
          leads={hud.leads}
          onUse={(id) => actions.current?.useRelic(id) ?? Promise.resolve("The map isn't ready yet.")}
          onClose={() => setBagOpen(false)}
        />
      )}
      {garage && (
        <VehiclePanel
          owned={garage}
          riding={hud.vehicle ? { kind: hud.vehicle.kind, source: hud.vehicle.source } : null}
          coins={hud.coins}
          busy={hud.busy}
          onRide={(kind, how) => {
            actions.current?.ride(kind, how);
            setGarage(null);
          }}
          onWalkTo={(vehicle) => {
            actions.current?.walkTo(vehicle);
            setGarage(null);
          }}
          onGetOff={() => {
            actions.current?.getOff();
            setGarage(null);
          }}
          onTaxi={() => {
            setGarage(null);
            setTransitOpen(true);
          }}
          onClose={() => setGarage(null)}
        />
      )}

      {landmarksOpen && landmarkActions && (
        <LandmarkPanel actions={landmarkActions} quiz={landmarksOpen.quiz} message={landmarksOpen.message} onClose={() => setLandmarksOpen(null)} />
      )}

      {transitOpen && transitActions && (
        <TransitPanel actions={transitActions} coins={hud.coins} onClose={() => setTransitOpen(false)} />
      )}

      {/* The siege: at a dome's edge, hunters attack it together to break it. */}
      {hud.dome?.siege && (
        <button
          type="button"
          onClick={() => actions.current?.attackDome()}
          className="absolute bottom-[160px] left-1/2 flex -translate-x-1/2 flex-col items-center rounded-2xl bg-[#9B5DE5] px-6 py-3 font-display text-lg font-extrabold text-paper shadow-lg active:scale-95"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          ⚔ Attack the dome
          <span className="text-xs font-semibold text-paper/85">
            {hud.dome.siege.attackers} of {hud.dome.siege.needed} hunters attacking together
          </span>
        </button>
      )}

      {/* Running on foot or pedalling harder; motorbikes and cars have no sprint. */}
      {canSprint(hud.mode) && !hud.ride && !hud.care && (
        <div className="absolute bottom-9 right-5" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
          <HoldButton
            label={hud.mode === "walk" ? "Hold to run" : "Hold to pedal faster"}
            onHold={(down) => {
              controls.current.sprint = down;
            }}
            className="size-[76px] rounded-full border-[3px] border-gold bg-ink text-[13px] font-extrabold tracking-wide data-[down=true]:bg-gold data-[down=true]:text-ink"
          >
            SPRINT
          </HoldButton>
        </div>
      )}
    </div>
  );
}

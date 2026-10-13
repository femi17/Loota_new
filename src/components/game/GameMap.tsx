"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import type { AvatarLook } from "@/lib/avatar";
import type { LngLat } from "@/game/geo";
import { canSprint, type Mode } from "@/game/movement";
import { PICKUP_RADIUS_M, RELICS, type Lead, type RelicId, type WorldItem } from "@/game/items";
import { MEAL_ENERGY, MEAL_PRICE, SERVICE_RADIUS_M, VEHICLES, type VehicleKind } from "@/game/economy";
import { BagPanel } from "./BagPanel";
import { VehiclePanel, type OwnedVehicle } from "./VehiclePanel";
import { HuntPanel, type HuntActions } from "./HuntPanel";
import type { SearchResult } from "@/game/hunt";
import type { Place } from "@/game/places";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData, type RoadCellFile } from "@/game/roadData";
import { PlaceSearch } from "./PlaceSearch";

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
  /** What you're riding: fuel (motor vehicles you own) and the rental meter. */
  vehicle: { kind: VehicleKind; source: "owned" | "rented"; fuel: number | null; meter: string | null } | null;
  /** Names of the petrol station and place to eat within reach, if any. */
  services: { fuel: string | null; food: string | null };
  /** Name of the street the hunter is on, if it has one. */
  street: string | null;
  /** A purchase or vehicle change is on its way to the server. */
  busy: boolean;
  /** Turn-by-turn directions, while the player has a destination. */
  guide: Guide | null;
};

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
  look,
  start,
  startMode,
  initialCoins,
  huntId,
}: {
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
    follow: () => void;
    turn: (dir: -1 | 1) => void;
    /** False when not allowed (a motor vehicle on a one-way street). */
    turnAround: () => boolean;
    endDirections: () => void;
    where: () => LngLat;
    goTo: (place: Place) => void;
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
  });
  const [bagOpen, setBagOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [garage, setGarage] = useState<OwnedVehicle[] | null>(null); // the Vehicles panel, when open

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
        zoom: 20.5,
        pitch: small ? 55 : 60,
        bearing: geo.compassFromHeading(traveller.heading),
        maxPitch: 70,
        dragPan: false, // dragging looks around the hunter instead (see "Look around" below)
        dragRotate: false,
        touchPitch: false,
        // The chase camera re-centres every frame, which would cancel the map's own
        // smooth zooming; the wheel is handled below instead.
        scrollZoom: false,
        doubleClickZoom: false,
        minZoom: 14,
        maxZoom: 21.5,
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
        if (geo.distanceM([traveller.pos.lng, traveller.pos.lat], [p.lng, p.lat]) > 400) {
          // Only far-away roads loaded so far (e.g. just thrown out of a trial): wait for nearer tiles.
          onRoad = null;
          return false;
        }
        traveller.pos = { lng: p.lng, lat: p.lat };
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
        const net = roads.buildNetworkFromCells(cells, traveller.mode, centre, Infinity);
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

      async function savePosition() {
        if (saving || geo.distanceM([saved.lng, saved.lat], [traveller.pos.lng, traveller.pos.lat]) < 5) return;
        saving = true;
        const sent = { ...traveller.pos };
        const { data, error } = await supabase.rpc("save_position", { p_lng: sent.lng, p_lat: sent.lat, p_mode: traveller.mode });
        saving = false;
        if (disposed || error || !data) return;
        const result = data as { ok: boolean; lng: number; lat: number; reason?: string; mode?: Mode; fuel?: number | null };
        saved = { lng: result.lng, lat: result.lat };
        if (result.ok) {
          if (typeof result.fuel === "number") onFuel(result.fuel);
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
      type VehicleRow = { kind: VehicleKind; fuel: number; lng: number; lat: number; in_use: boolean };
      let owned: VehicleRow[] = [];
      let rental: { kind: VehicleKind; startedAt: number; rate: number } | null = null;
      let busy = false;
      let fuelWarning: "none" | "low" | "empty" = "none";
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

      /** Reflect what the player is riding in the display (and push an empty motorbike at walking pace). */
      function showVehicle() {
        const kind = traveller.mode === "walk" ? null : (traveller.mode as VehicleKind);
        const mine = ownInUse();
        const fuel = mine && mine.kind !== "bicycle" ? mine.fuel : null;
        traveller.speedFactor = mine && fuel !== null && fuel <= 0 ? movement.MODES.walk.kmh / movement.MODES[mine.kind].kmh : 1;
        setHud((h) => ({
          ...h,
          mode: traveller.mode,
          vehicle: kind ? { kind, source: rental ? "rented" : "owned", fuel, meter: meterText() } : null,
        }));
      }

      function onFuel(fuel: number) {
        const mine = ownInUse();
        if (!mine) return;
        mine.fuel = fuel;
        if (fuel <= 0 && fuelWarning !== "empty") {
          fuelWarning = "empty";
          say(`Out of fuel! You're pushing your ${vehicleName(mine.kind)} at walking pace. Find a petrol station.`, true);
        } else if (fuel > 0 && fuel < 15 && fuelWarning === "none") {
          fuelWarning = "low";
          say("Fuel is low. A Refuel button appears when you're at a petrol station.", true);
        }
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
          supabase.from("player_vehicles").select("kind, fuel, lng, lat, in_use"),
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
            else if (started?.reason === "fuel") say(`Your ${vehicleName(kind)} has no fuel. Rent one, or bring fuel later.`, true);
            else say("Couldn't get on. Please try again.", true);
            afterModeChange();
            return;
          }

          traveller.mode = kind;
          saved = { ...traveller.pos };
          fuelWarning = "none";
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
          fuelWarning = "none";
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
          const r = data as { ok: boolean; reason?: string; energy?: number; balance?: number } | null;
          if (!r?.ok) {
            say(`A meal costs ${MEAL_PRICE} coins. Pick up coins on the roads, or rest for free.`, true);
            return;
          }
          traveller.energy = Math.min(100, traveller.energy + (r.energy ?? MEAL_ENERGY));
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          say(`You ate at ${place}: +${r.energy ?? MEAL_ENERGY} energy.`);
        } finally {
          setBusy(false);
        }
      }

      let foodHere: string | null = null;

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
      function scanServices() {
        const here: [number, number] = [traveller.pos.lng, traveller.pos.lat];
        let fuel: string | null = null;
        let food: string | null = null;
        let fuelD = SERVICE_RADIUS_M;
        let foodD = SERVICE_RADIUS_M;
        for (const f of map.querySourceFeatures("openmaptiles", { sourceLayer: "poi" })) {
          if (f.geometry.type !== "Point") continue;
          const cls = String(f.properties?.class ?? "");
          const isFuel = cls === "fuel";
          const isFood = cls === "fast_food" || cls === "restaurant" || cls === "cafe";
          if (!isFuel && !isFood) continue;
          const [lng, lat] = f.geometry.coordinates as [number, number];
          const d = geo.distanceM(here, [lng, lat]);
          const name = f.properties?.name ? String(f.properties.name) : isFuel ? "the petrol station" : "this place";
          if (isFuel && d < fuelD) {
            fuelD = d;
            fuel = name;
          }
          if (isFood && d < foodD) {
            foodD = d;
            food = name;
          }
        }
        foodHere = food;
        foodHere = food;
        setHud((h) => (h.services.fuel === fuel && h.services.food === food ? h : { ...h, services: { fuel, food } }));
      }

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
            const entity = layer.add({ object: model.group, lng: item.lng, lat: item.lat, scaleBy: 1.7 });
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

      // Relics count for the bag button.
      void supabase
        .from("player_relics")
        .select("expires_at")
        .then(({ data }) => {
          if (disposed || !data) return;
          const now = Date.now();
          setHud((h) => ({ ...h, relics: data.filter((r) => new Date(r.expires_at).getTime() > now).length }));
        });

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
          if (foodHere) void eatHere(foodHere);
        },
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
      // down to tilt it. Two fingers pinch to zoom. Moving off brings the view
      // back behind the hunter. A short tap gives directions to that spot.
      //
      // On touch screens the lower part of the screen steers instead: press and
      // hold to walk, swipe left or right to turn, swipe down to turn back.
      map.touchZoomRotate.disableRotation();
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
          stopSteering(); // two fingers: pinch to zoom
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
      // Zoom with the mouse wheel or trackpad (pinch on touch screens works as usual).
      let zoomGoal: number | null = null;
      const wheelZoom = (e: WheelEvent) => {
        e.preventDefault();
        const step = e.deltaMode === 1 ? e.deltaY * 0.05 : e.deltaY * 0.0025;
        zoomGoal = Math.max(14, Math.min(21.5, (zoomGoal ?? map.getZoom()) - step));
      };
      lookArea.addEventListener("wheel", wheelZoom, { passive: false });
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

        // Keep a road network around the player as they travel, and refresh it
        // as more map tiles load (the first build may only see one tile).
        const stale =
          !network ||
          now - lastNetworkCheck > 5000 ||
          geo.distanceM([network.centre.lng, network.centre.lat], [traveller.pos.lng, traveller.pos.lat]) > 300;
        if (stale && now - lastNetworkCheck > 1000) {
          lastNetworkCheck = now;
          buildRoads(true);
        }

        // The player moves only while holding a key or the screen.
        const canMove = !frozen && !!onRoad;
        const { distance, events } = movement.step(traveller, { go: c.go || touchGo, sprint: c.sprint }, dt, t, canMove);
        for (const event of events) {
          if (event === "fainted") say("You fainted from exhaustion! Rest before your energy runs out. (In a hunt: ambulance and hospital bill.)", true);
          if (event === "recovered") say("Back on your feet.");
        }

        if (network && onRoad) {
          if (distance > 0) {
            // Straight on at junctions, unless the player asked to turn.
            const aim = roads.positionOf(network, onRoad).heading;
            const { position, deadEnd, turned, passed } = roads.advance(network, onRoad, distance, aim, pendingTurn);
            if (turned) setTurn(0);
            if (passed) justPassed = passed;
            else if (justPassed) justPassed.metresSince += distance;
            onRoad = position;
            if (deadEnd) {
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
        if (now - lastGuide > 250) {
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

        // Spin the finds, and pick up anything within reach. Zoomed far out they
        // would crowd the map (they keep their size on screen), so they hide.
        const showFinds = map.getZoom() >= 17;
        for (const [id, { item, model }] of onMap) {
          model.group.visible = showFinds;
          model.spin.rotation.y += dt * 2;
          if (picking.has(id) || (retryAfter.get(id) ?? 0) > now) continue;
          if (geo.distanceM([traveller.pos.lng, traveller.pos.lat], [item.lng, item.lat]) < PICKUP_RADIUS_M) void pickUp(id);
        }
        if (now - lastSync > 15000 || (syncedAt && geo.distanceM([syncedAt.lng, syncedAt.lat], [traveller.pos.lng, traveller.pos.lat]) > 200)) {
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
        let zoom: number | undefined;
        if (zoomGoal !== null) {
          const current = map.getZoom();
          zoom = current + (zoomGoal - current) * Math.min(1, 10 * dt);
          if (Math.abs(zoomGoal - zoom) < 0.01) {
            zoom = zoomGoal;
            zoomGoal = null;
          }
        }
        map.jumpTo({ center: [traveller.pos.lng, traveller.pos.lat], bearing: camBearing, zoom });

        if (now - lastSave > SAVE_EVERY_MS) {
          lastSave = now;
          void savePosition();
        }

        // The street you're on, petrol stations and food within reach, and the rental meter ticking.
        if (now - lastServices > 1000) {
          lastServices = now;
          scanStreet();
          scanServices();
          if (rental) showVehicle();
        }

        if (now - lastHud > 100) {
          lastHud = now;
          const energy = Math.round(traveller.energy);
          const speedKmh = Math.round((traveller.v / movement.TIME_SCALE) * 3.6);

          // Point to the closest find, relative to the screen (the camera turns with the hunter).
          const here: [number, number] = [traveller.pos.lng, traveller.pos.lat];
          let nearest: Hud["nearest"] = null;
          let closest = Infinity;
          for (const { item } of onMap.values()) {
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
            h.nearest?.angle === nearest?.angle
              ? h
              : { ...h, energy, speedKmh, nearest },
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
        lookArea.removeEventListener("wheel", wheelZoom);
        window.removeEventListener("pointermove", lookMove);
        window.removeEventListener("pointerup", lookEnd);
        window.removeEventListener("pointercancel", lookEnd);
        stopSteering();
        document.removeEventListener("visibilitychange", saveOnHide);
        actions.current = null;
        huntActions.current = null;
        map.remove();
      };
    })().catch(() => setFailed(true));

    return () => {
      disposed = true;
      cleanup();
    };
  }, [startLng, startLat, startMode, lookKey]);

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
            {hud.vehicle?.meter && <span className="text-xs font-semibold">· {hud.vehicle.meter}</span>}
          </button>
        </div>
        {hud.services.fuel && hud.vehicle?.fuel != null && hud.vehicle.fuel < 99 && (
          <button
            type="button"
            disabled={hud.busy}
            onClick={() => actions.current?.refuel()}
            className="pointer-events-auto h-11 rounded-xl bg-gold px-3 text-sm font-bold text-ink disabled:opacity-50"
          >
            ⛽ Refuel at {hud.services.fuel}
          </button>
        )}
        {hud.services.food && hud.energy < 95 && (
          <button
            type="button"
            disabled={hud.busy}
            onClick={() => actions.current?.eat()}
            className="pointer-events-auto h-11 rounded-xl bg-gold px-3 text-sm font-bold text-ink disabled:opacity-50"
          >
            Eat at {hud.services.food} · {MEAL_PRICE} coins
          </button>
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
              Pinch or scroll to zoom.
            </p>
            <p>
              <b>Directions:</b> search a place or address, or tap a spot on the map. A blue line and turn-by-turn directions
              show the way; you steer.
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

      {bagOpen && <BagPanel leads={hud.leads} onClose={() => setBagOpen(false)} />}
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
          onClose={() => setGarage(null)}
        />
      )}

      {/* Running on foot or pedalling harder; motorbikes and cars have no sprint. */}
      {canSprint(hud.mode) && (
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

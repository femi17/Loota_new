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
import { BackIcon, BagIcon, BusIcon, CloseIcon, DirectionsIcon, LampIcon, LandmarkIcon, VehicleIcon } from "./HudIcons";
import { JourneyPanel, legText } from "./JourneyPanel";
import { DjinnPanel, type ChamberResult, type DjinnActions, type DjinnChamber, type DjinnStage, type DjinnState, type GateVerdict } from "./DjinnPanel";
import { wonderOf } from "@/game/wonders";
import { LOCAL_M, coachPossible, flyingMakesSense, goLeg, inNigeria, journeyOf, rideLeg, type Journey } from "@/game/journey";
import { DETOUR_REACH_M, LampPanel, type LampActions, type LampDetour, type LampItem, type LampQuestion, type LampResult, type LampState } from "./LampPanel";
import { highwayRoute, loadHighways } from "@/game/highways";
import { NIGHT_BUS_WAIT, NIGHT_TAXI_FARE, clockText, daylight, isNight, jamOn, jamSpeed, trafficFactor, trafficLevel, type Jam } from "@/game/clock";
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
  /** At a bus stop, station or airport: what the transport button offers. */
  stopHere: { icon: string; label: string } | null;
  /** What can be done where the player stands: eat, rest, refuel, kegs, tyres, repairs. */
  actions: { id: LimitAction; icon: string; short: string; label: string }[];
  /** A warning that needs acting on (tired, fuel low, soft tyres, a worn engine), with the nearest place that helps. */
  advice: { key: string; title: string; text: string; where: string | null; place: { name: string; lng: number; lat: number } | null } | null;
  /** Being looked after: the ambulance, the hospital, a mechanic on the way. */
  care: { icon: string; title: string; status: string } | null;
  /** The fuel keg the player carries, if any. */
  keg: { fuel: number; usesLeft: number } | null;
  /** The Djinn's Wager, while one is on (design doc 7.6): where the player is in it, and whether they've seen the summons. */
  djinn: {
    stage: DjinnStage;
    wonder: string;
    endsAt: number;
    fresh: boolean;
    place: string | null;
    /** Other hunters who broke the same seal, and how close the nearest is to the place. */
    rivals: { count: number; nearest: number } | null;
  } | null;
  /** At the chosen seal's place: the "Enter the chamber" button. */
  djinnHere: { place: string } | null;
  /** A journey under way (design doc 7.8): where to, which step, and the Board button at a stop. */
  journey: { place: string; step: number; total: number; text: string; board: string | null } | null;
  /** The lamp: whether it holds something (one thing at a time), and whether the player has looked at it yet (it glows). */
  lamp: { has: boolean; unseen: boolean };
  /** At a Detour's place, not yet tried: the Claim button. */
  detourHere: LampDetour | null;
  /** The local time where the player is, whether it's night, and whether it's rush hour. */
  clock: { text: string; night: boolean; rush: boolean } | null;
  /** On a motorbike or in a car in a traffic jam: 1 slow, 2 at a standstill. */
  jam: Jam;
  /** At a landmark (within its check-in area): what checking in would pay. */
  landmarkHere: { landmark: Landmark; canTry: boolean } | null;
  /** A rental waiting at a bus stop, or a taxi on its way: where, how far, and the button once there. */
  pickup: { icon: string; title: string; status: string; action: string | null } | null;
  /**
   * The Djinn's Wonders at work (design doc 7.7): seconds left frozen by an Hourglass, in someone's sandstorm,
   * and with your Eye open (the hunters it sees: bearing relative to the view); under your Cloak; mirrored.
   */
  wonders: {
    frozen: number | null;
    sand: { seconds: number; by: string | null } | null;
    eye: { seconds: number; hunters: { name: string; keysHeld: number; metres: number; bearing: number }[] } | null;
    cloaked: boolean;
    mirrored: boolean;
  };
};

/** Things a player can do at a place or by their vehicle (see computeActions in GameMap). */
type LimitAction = "eat" | "rest" | "rest_here" | "refuel" | "buy_keg" | "fill_keg" | "pour_keg" | "pump" | "service" | "mechanic";

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
  huntHidden,
  huntAsked,
}: {
  playerId: string;
  username: string;
  look: AvatarLook;
  start: LngLat;
  startMode: Mode;
  initialCoins: number;
  /** The hunt the player has joined, if any. */
  huntId: string | null;
  /** The player hid that hunt's panel (a cookie); it shows again when asked for from the lobby. */
  huntHidden: boolean;
  /** Opened from the lobby's "Continue the hunt" (?hunt=…): show it even if it was hidden. */
  huntAsked: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef({ go: false, sprint: false });
  const actions = useRef<{
    vehicles: () => OwnedVehicle[];
    ride: (kind: VehicleKind, how: "own" | "rent" | "buy") => void;
    getOff: () => void;
    refuel: () => void;
    eat: () => void;
    /** Use a relic from the bag; resolves to a message for the bag. */
    useRelic: (id: string) => Promise<string>;
    /** Use a Wonder from the bag (`to`: where the Carpet of Kings flies); resolves to a message. */
    useWonder: (id: string, to?: LngLat) => Promise<string>;
    /** Attack the dome the hunter is standing at the edge of. */
    attackDome: () => void;
    follow: () => void;
    turn: (dir: -1 | 1) => void;
    /** False when not allowed (a motor vehicle on a one-way street). */
    turnAround: () => boolean;
    endDirections: () => void;
    where: () => LngLat;
    goTo: (place: Place) => void;
    /** The journey planner: go the chosen way, just the road, board at a stop, or give up the journey. */
    chooseJourney: (journey: Journey) => void;
    roadOnly: (place: Place) => void;
    boardJourney: () => void;
    endJourney: () => void;
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
    clock: null,
    jam: 0,
    lamp: { has: false, unseen: false },
    detourHere: null,
    journey: null,
    djinn: null,
    djinnHere: null,
    wonders: { frozen: null, sand: null, eye: null, cloaked: false, mirrored: false },
  });
  const [bagOpen, setBagOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [huntShown, setHuntShown] = useState(!huntHidden);
  // Asked for from the lobby: it isn't hidden any more.
  useEffect(() => {
    if (huntAsked) document.cookie = "loota_hidden_hunt=; path=/; max-age=0";
  }, [huntAsked]);
  /** Hide the hunt's panel (the hunt goes on; the lobby's "Continue the hunt" brings it back). */
  const hideHunt = () => {
    if (huntId) document.cookie = `loota_hidden_hunt=${huntId}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    setHuntShown(false);
  };
  const [journeyPlan, setJourneyPlan] = useState<{ place: Place; options: Journey[] | null; message: string | null } | null>(null);
  const [garage, setGarage] = useState<OwnedVehicle[] | null>(null); // the vehicle panel, when open
  const [transitOpen, setTransitOpen] = useState(false);
  const [transitActions, setTransitActions] = useState<TransitActions | null>(null); // set once the map is ready
  const [landmarkActions, setLandmarkActions] = useState<LandmarkActions | null>(null);
  const [landmarksOpen, setLandmarksOpen] = useState<{ quiz: CheckinQuestion | null; message: string | null } | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [lampActions, setLampActions] = useState<LampActions | null>(null);
  const [lampOpen, setLampOpen] = useState<{ quiz: LampQuestion | string | null } | null>(null);
  const [djinnActions, setDjinnActions] = useState<DjinnActions | null>(null);
  const [djinnOpen, setDjinnOpen] = useState<{ chamber: DjinnChamber | string | null } | null>(null);
  /** A whirlwind is carrying the player off (the chamber was failed). */
  const [whirlwind, setWhirlwind] = useState(false);
  /** A trap just sprang: a red flash. */
  const [trapFlash, setTrapFlash] = useState(false);
  /** News of a Wonder (everyone hears of every use); `flash`: a Cataclysm hit you. */
  const [wonderBanner, setWonderBanner] = useState<{ n: number; icon: string; text: string; hit: boolean; flash: boolean } | null>(null);
  /** The Carpet of Kings is ready: asking where to fly. */
  const [carpetFor, setCarpetFor] = useState<string | null>(null);
  /** "Enter the chamber" at the chosen place: ask for the rooms (once), then open the Djinn on them. */
  const enterChamber = async () => {
    if (!djinnActions || checkingIn) return;
    setCheckingIn(true);
    const chamber = await djinnActions.enterChamber();
    setCheckingIn(false);
    setDjinnOpen({ chamber });
  };
  /** The Claim button at a Detour's place: ask the question (once), then open the lamp on it. */
  const claimDetour = async (detour: LampDetour) => {
    if (!lampActions || checkingIn) return;
    setCheckingIn(true);
    const q = await lampActions.start(detour);
    setCheckingIn(false);
    setLampOpen({ quiz: q });
  };
  const [adviceOpen, setAdviceOpen] = useState(false);
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
        if (!disposed) {
          lastNetworkCheck = 0; // rebuild with it on the next frame
          lastSky = -Infinity; // and draw its traffic
        }
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
        // Never on a cut-off pocket of road (an airfield's paths, a fenced car park): it only goes in
        // circles. The nearest proper road instead, when it's near enough for the server to allow.
        if (onRoad && roads.cutOffEdges(network)[onRoad.edge]) {
          const main = roads.snapToNetwork(network, traveller.pos, facing, roads.cutOffEdges(network));
          const m = main ? roads.positionOf(network, main) : null;
          if (main && m && geo.distanceM([traveller.pos.lng, traveller.pos.lat], [m.lng, m.lat]) <= Math.max(snapReachM, 240)) onRoad = main;
        }
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
        // ~1 km around the straight line's box, for roads that bend outward; if that finds no way
        // (a fenced airport, a lagoon: the way round can be ten times the straight line), ~3 km.
        for (const [margin, maxSquares] of [[0.01, 30], [0.03, 49]]) {
          const x0 = Math.floor((Math.min(from.lng, to.lng) - margin) / ROAD_CELL_DEG);
          const x1 = Math.floor((Math.max(from.lng, to.lng) + margin) / ROAD_CELL_DEG);
          const y0 = Math.floor((Math.min(from.lat, to.lat) - margin) / ROAD_CELL_DEG);
          const y1 = Math.floor((Math.max(from.lat, to.lat) + margin) / ROAD_CELL_DEG);
          if ((x1 - x0 + 1) * (y1 - y0 + 1) > maxSquares) return null;
          const keys: string[] = [];
          for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) keys.push(roadCellKey(ix, iy));
          await Promise.all(keys.map(ensureSquare));
          const cells = keys.map((k) => roadSquares.get(k)).filter((c): c is RoadCellData => typeof c === "object");
          if (!cells.length || disposed) return null;
          await new Promise((r) => setTimeout(r, 30)); // let "Finding a route…" show before the search
          const centre = { lng: (from.lng + to.lng) / 2, lat: (from.lat + to.lat) / 2 };
          const net = roads.buildNetworkFromCells(cells, mode, centre, Infinity);
          // Not from a cut-off pocket of road (an airfield's paths): it leads nowhere.
          let start = roads.snapToNetwork(net, from, traveller.heading);
          if (start && roads.cutOffEdges(net)[start.edge]) start = roads.snapToNetwork(net, from, traveller.heading, roads.cutOffEdges(net)) ?? start;
          const path = start ? roads.findPath(net, start, to, 300) : null;
          if (path) return { path, forks: roads.findForks(net, path) };
        }
        return null;
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
        /** Frozen by the Hourglass of Ages until then. */
        until?: string;
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
        } else if (result.reason === "frozen") {
          freeze(result.until ? Date.parse(result.until) : Date.now() + 10_000);
          say("⌛ The Hourglass of Ages holds you fast: you can't move until its sand runs out.", true);
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
      let trafficSpeed = 1; // in a jam: cars crawl, motorbikes weave through (src/game/clock.ts)
      let sandFactor = 1; // in someone's sandstorm (the Sandstorm Crown): half speed, whatever you ride
      function applySpeed() {
        traveller.speedFactor =
          vehicleFactor * sandFactor * (traveller.mode === "walk" || traveller.mode === "bicycle" ? weatherFactor : trafficSpeed);
      }

      /** New fuel for the vehicle the player is on (a save, a refuel, a Jerry Can relic). */
      function onFuel(fuel: number) {
        const mine = ownInUse();
        if (!mine) return;
        mine.fuel = fuel;
        showVehicle();
      }

      // The pocket garage: your own vehicles go everywhere with you. Off one, it shrinks into your pocket;
      // taking it out, it grows back under you (like a gadget in Ready Player One).
      const POCKET_MS = 900;
      let pocketAnims: { kind: VehicleKind; out: boolean; start: number; entity: import("@/game/ThreeMapLayer").MapEntity | null }[] = [];
      function pocketAnim(kind: VehicleKind, out: boolean) {
        pocketAnims = pocketAnims.filter((a) => {
          if (a.kind !== kind) return true;
          if (a.entity) layer.remove(a.entity);
          return false;
        });
        const entity = out ? null : layer.add({ object: models.makeVehicleModel(kind), lng: traveller.pos.lng, lat: traveller.pos.lat, heading: traveller.heading });
        if (out) avatar.vehicles[kind].group.scale.setScalar(0.05);
        pocketAnims.push({ kind, out, start: performance.now(), entity });
      }
      function pocketTick(now: number) {
        if (!pocketAnims.length) return;
        pocketAnims = pocketAnims.filter((a) => {
          const k = Math.min(1, (now - a.start) / POCKET_MS);
          const ease = 1 - (1 - k) ** 3;
          if (a.out) avatar.vehicles[a.kind].group.scale.setScalar(Math.max(0.05, ease));
          else if (a.entity) {
            // Shrinking and spinning into the pocket, at the hunter's side.
            a.entity.scaleBy = Math.max(0.01, 1 - ease);
            a.entity.heading = traveller.heading + ease * Math.PI * 3;
            a.entity.lng = traveller.pos.lng;
            a.entity.lat = traveller.pos.lat;
          }
          if (k < 1) return true;
          if (a.entity) layer.remove(a.entity);
          if (a.out) avatar.vehicles[a.kind].group.scale.setScalar(1);
          return false;
        });
      }
      /** Another way to travel took over (a bus, train, plane, taxi, rental or the Carpet): your own vehicle is pocketed. */
      function pocketed() {
        if (traveller.mode === "walk" || rental) return;
        pocketAnim(traveller.mode as VehicleKind, false);
        traveller.mode = "walk";
        void refreshVehicles().then(afterModeChange);
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
            await savePosition();
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
            if (started?.reason === "coins") say(`Not enough coins to rent a ${vehicleName(kind)}.`, true);
            else if (started?.reason === "fuel")
              say(`Your ${vehicleName(kind)}'s tank is empty. Any petrol station fills it while it's in your pocket, or pour in fuel from a keg.`, true);
            else if (started?.reason === "far_pickup") say("Walk to the renter first: they're waiting at the bus stop.", true);
            else if (started?.reason === "pickup") say(`Ask for a ${vehicleName(kind)} first (Rent in Vehicles): a renter brings one to a bus stop near you.`, true);
            else if (started?.reason === "taxi") say("Cars come as taxis: call one from Taxi, bus, train or plane.", true);
            else if (started?.reason === "broken") say(`Your ${vehicleName(kind)} has broken down. Call a mechanic (the gold 🔧 button, or in Vehicles): they come to you.`, true);
            else if (started?.reason === "repairing") say(`The mechanic is still working on your ${vehicleName(kind)}. Try again in a moment.`, true);
            else say("Couldn't get on. Please try again.", true);
            afterModeChange();
            return;
          }

          if (traveller.mode !== "walk" && !rental && traveller.mode !== kind) pocketAnim(traveller.mode as VehicleKind, false); // swapping vehicles
          traveller.mode = kind;
          saved = { ...traveller.pos };
          if (started.source === "owned") pocketAnim(kind, true);
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
              : `Out of your pocket: you're ${kind === "car" ? "in" : "on"} your ${vehicleName(kind)}.`,
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
          if (!wasRental) pocketAnim(kind, false);
          traveller.mode = "walk";
          saved = { ...traveller.pos };
          setHud((h) => ({ ...h, coins: stopped.balance }));
          await refreshVehicles();
          afterModeChange();
          say(
            wasRental
              ? `Rental returned.${stopped.charged > 0 ? ` ${stopped.charged} more coins for the extra minutes.` : ""}`
              : `Your ${vehicleName(kind)} shrinks into your pocket. Take it out anywhere with the vehicle button.`,
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
          await refreshVehicles(); // the one ridden, or one in the pocket, was filled
          warned.fuel = 100;
          clearAdvice("fuel");
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
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
      const leadMarkers = new Map<string, { lng: number; lat: number }>(); // open leads (shown in the lamp, not on the map)
      let lampStale = false; // the lamp should look again (a whisper found, or proved a lie)
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
        if (!leadMarkers.has(id)) leadMarkers.set(id, { lng, lat });
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
          leadMarkers.clear();
          for (const lead of data.leads) addLead(lead.id, lead.lng, lead.lat);
          showLeadCount();
          if (data.decoysFound > 0) {
            say("Nothing here. The whisper was a lie.", true);
            lampStale = true;
          }
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
          if (geo.distanceM([marker.lng, marker.lat], [entry.item.lng, entry.item.lat]) < 5) leadMarkers.delete(leadId);
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
          say(`Intel scroll: a whisper about something hidden ${geo.formatDistance(metres)} ${direction}. It's in your lamp.`, true);
          lampStale = true;
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
            inUse: v.in_use,
            state: v.broken_at ? (v.repair_ready_at ? "repairing" : "broken") : v.kind !== "bicycle" && v.fuel <= 0 ? "empty" : "ready",
          })),
        ride: (kind, how) => void chooseVehicle(kind, how),
        getOff: () => void getOff(),
        refuel: () => void refuelHere(),
        eat() {
          void act("eat");
        },
        useRelic: (id) => useRelic(id),
        useWonder: (id, to) => useWonder(id, to),
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
          void routeTo(place);
        },
        chooseJourney: (j) => {
          setJourneyPlan(null);
          startJourney(j);
        },
        roadOnly: (place) => {
          setJourneyPlan(null);
          void planDirections({ lng: place.lng, lat: place.lat }, place.name);
        },
        boardJourney: () => void boardJourney(),
        endJourney: () => endJourney(),
      };

      // ---- Hunts: searching where you stand, trials and being thrown out ----
      let frozen = false; // standing still during a Key Trial
      let stuckUntil = 0; // held by a trap (quicksand, a dart wall), performance.now() time

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

      // The Phantom Cloak keeps the hunter off everyone's map; the Mirror of Many shows three copies (Date.now() times).
      let cloakedUntil = 0;
      let mirroredUntil = 0;

      function announce(now: number) {
        if (Date.now() < cloakedUntil) return;
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
        if (Date.now() < mirroredUntil) {
          // Three copies a few hundred metres off, doing as the hunter does: nobody knows which is real.
          for (let i = 1; i <= 3; i++) {
            const angle = (i * 2 * Math.PI) / 3 + 0.6;
            const metres = 180 + i * 90;
            const copy: HunterUpdate = {
              ...update,
              id: `${playerId}:m${i}`,
              lng: update.lng + (metres * Math.sin(angle)) / (111320 * Math.cos((update.lat * Math.PI) / 180)),
              lat: update.lat + (metres * Math.cos(angle)) / 110574,
            };
            void areaChannels.get(key)?.send({ type: "broadcast", event: "pos", payload: copy });
            void huntChannel?.send({ type: "broadcast", event: "pos", payload: copy });
          }
        }
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

      // Stops near the hunter: what the transport button offers, refreshed as they move.
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
        const night = isNight(Date.now(), from.lng, from.lat);
        const wait = transitWaitS("bus", false) * (night ? NIGHT_BUS_WAIT : 1);
        const slow = metres <= BUS_RANGE_M ? trafficFactor(Date.now(), from.lng, from.lat) : 1;
        return {
          mode: "bus",
          from,
          to: { id: to.id, name: to.name, code: null },
          label: place.name,
          then: place,
          walkAfter: to.metres,
          metres,
          fare: transitFare("bus", metres),
          seconds: wait + (metres / transitSpeedFor("bus", metres)) * slow,
          waitSeconds: wait,
          path: full,
          note: [night ? "🌙 Night: buses come less often." : "", slow >= 1.5 ? "🚦 Rush hour: the bus is slow in traffic." : ""].filter(Boolean).join(" ") || undefined,
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
        if (rental) return "Return your rental first (vehicle button, then Get off), then board.";
        await savePosition(); // the server checks you're at the stop
        const { data, error } = await supabase.rpc("start_trip", { p_from: quote.from.id, p_to: quote.to.id, p_path: quote.path, p_fast_pass: fastPass });
        if (error || !data) return fastPass ? "Your Fast Pass couldn't be used. Try again without it." : "Something went wrong. Try again.";
        const result = data as { ok: boolean; reason?: string; fare?: number; balance?: number; trip?: TransitTrip };
        if (!result.ok) {
          const why: Record<string, string> = {
            coins: `You need ${result.fare ?? quote.fare} coins for this fare.`,
            far: `Get to ${stopTitle(quote.from)} first: you need to be at the stop.`,
            vehicle: "Return your rental first (vehicle button, then Get off), then board.",
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
        pocketed();
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
      /**
       * `none`: what to say instead when no such place is within `maxM` (e.g. "rest where you are").
       */
      async function advise(key: string, title: string, text: string, kinds: Spot["kind"][] | null, maxM = Infinity, none?: { text: string; where: string }) {
        let found = kinds ? await spotAhead(kinds) : null;
        if (disposed) return;
        if (found && found.spot.metres > maxM) found = null;
        const spot = found?.spot ?? null;
        const full = found
          ? `${text} ${found.behind ? "None ahead; the nearest is back the way you came" : trip ? "Next on your way" : "Next ahead"}: ${found.spot.name}, ${geo.formatDistance(found.spot.metres)}.`
          : none?.text ?? text;
        adviceKey = key;
        advicePlace = spot ? { name: spot.name, lng: spot.lng, lat: spot.lat } : null;
        const where = found ? `${found.spot.name} · ${geo.formatDistance(found.spot.metres)}${found.behind ? " back" : ""}` : (none?.where ?? null);
        setHud((h) => ({ ...h, advice: { key, title, text: full, where, place: advicePlace } }));
        say(full, true);
      }
      function clearAdvice(key: string) {
        if (adviceKey !== key) return;
        adviceKey = "";
        advicePlace = null;
        setHud((h) => (h.advice?.key === key ? { ...h, advice: null } : h));
      }

      /**
       * How far it's worth going for a chill spot: under 40% of what the hunter's
       * energy would carry them, and no more than 800 m on foot (2 km by bicycle).
       */
      function chillReachM() {
        const perMetre = movement.MODES[traveller.mode].drain / movement.baseSpeed(traveller.mode);
        const cap = traveller.mode === "bicycle" ? 2000 : 800;
        return perMetre > 0 ? Math.min(cap, (0.4 * traveller.energy) / perMetre) : cap;
      }

      /** Warnings as energy, fuel, tyres and engines run down (once per level, again after recovering). */
      function checkLimits() {
        if (visit || ride) return;
        const energy = traveller.energy;
        if (traveller.mode === "walk" || traveller.mode === "bicycle") {
          if (energy < 25 && warned.energy > 25) {
            warned.energy = 25;
            void advise("energy", "Exhausted: rest now", "You're exhausted! Rest now or you'll faint and need an ambulance: sit down at a park or a place to eat, or have a meal.", ["rest", "eat"], chillReachM(), {
              text: "You're exhausted! There's no chill spot close by: sit down and rest right where you are (Rest here), or you'll faint and need an ambulance.",
              where: "No chill spot near: rest here",
            });
          } else if (energy < 50 && warned.energy > 50) {
            warned.energy = 50;
            void advise("energy", "Getting tired", "You're getting tired. Take a break at a chill spot (a park or a place to eat): energy comes back fast there.", ["rest", "eat"], chillReachM(), {
              text: "You're getting tired, and there's no chill spot close by. Take a break right where you are (Rest here): energy comes back while you sit.",
              where: "No chill spot near: rest here",
            });
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
            void advise("fuel", "Fuel almost gone", `Fuel almost gone! If the tank runs dry your ${vehicleName(mine.kind)} goes into your pocket until a petrol station or a keg fills it.`, ["fuel"]);
          } else if (mine.fuel < 25 && warned.fuel > 25) {
            warned.fuel = 25;
            void advise("fuel", "Fuel low", "Fuel is getting low. Fill up at a petrol station.", ["fuel"]);
          }
          if (mine.fuel > 40 && warned.fuel < 100) {
            warned.fuel = 100;
            clearAdvice("fuel");
          }
          if (mine.engine < 30 && warned.engine > 30) {
            warned.engine = 30;
            void advise("engine", "Engine needs a service", `Your ${vehicleName(mine.kind)}'s engine needs a service: worn engines break down. A mechanic can service it (60 coins).`, ["mechanic"]);
          }
          if (mine.engine > 50 && warned.engine < 100) {
            warned.engine = 100;
            clearAdvice("engine");
          }
        }
        if (mine?.kind === "bicycle") {
          if (mine.tyre <= 0 && warned.tyre > 0) {
            warned.tyre = 0;
            void advise("tyre", "Flat tyre", "Flat tyre! You're pushing your bicycle at walking pace. A vulcanizer or petrol station can fix it (20 coins).", ["tyres", "fuel"]);
          } else if (mine.tyre < 40 && warned.tyre > 40) {
            warned.tyre = 40;
            void advise("tyre", "Soft tyres", "Your tyres are getting soft. Pump them at a vulcanizer or petrol station (5 coins).", ["tyres", "fuel"]);
          }
          if (mine.tyre > 60 && warned.tyre < 100) {
            warned.tyre = 100;
            clearAdvice("tyre");
          }
        }
      }

      /** What can be done here: by the place the hunter is at, and the vehicles next to them. */
      function computeActions() {
        const list: { id: LimitAction; icon: string; short: string; label: string }[] = [];
        if (!visit && !ride && traveller.phase === "idle") {
          // The one being ridden first, else one in the pocket (the server picks the same way).
          const ownedFirst = (want: (v: VehicleRow) => boolean) => owned.filter(want).sort((a, b) => Number(b.in_use) - Number(a.in_use))[0] ?? null;
          const eatSpot = spotHere(["eat"]);
          if (eatSpot && traveller.energy < 95) list.push({ id: "eat", icon: "🍲", short: `Eat · ${MEAL_PRICE}`, label: `Eat at ${eatSpot.name} · ${MEAL_PRICE} coins` });
          const chill = spotHere(["rest", "eat"]);
          if (chill && traveller.mode === "walk" && traveller.energy < 90 && !traveller.resting) list.push({ id: "rest", icon: "🪑", short: "Rest", label: `Rest at ${chill.name}` });
          if (!chill && (traveller.mode === "walk" || traveller.mode === "bicycle") && traveller.energy < 60 && !traveller.resting) {
            list.push({ id: "rest_here", icon: "🧘", short: "Rest here", label: "Sit down and rest right here (slower than at a chill spot)" });
          }
          const station = spotHere(["fuel"]);
          const thirsty = ownedFirst((v) => v.kind !== "bicycle" && v.fuel < 99);
          if (station && thirsty) {
            list.push({
              id: "refuel",
              icon: "⛽",
              short: "Refuel",
              label: thirsty.in_use ? `Refuel at ${station.name}` : `Fill your ${vehicleName(thirsty.kind)}'s tank (in your pocket) at ${station.name}`,
            });
          }
          if (station && !keg && owned.some((v) => v.kind !== "bicycle")) list.push({ id: "buy_keg", icon: "🛢", short: "Buy keg · 25", label: "Buy a fuel keg · 25 coins" });
          if (station && keg && keg.fuel < 30) list.push({ id: "fill_keg", icon: "🛢", short: `Fill keg · ${2 * (30 - Math.floor(keg.fuel))}`, label: `Fill your keg · ${2 * (30 - Math.floor(keg.fuel))} coins` });
          const dry = ownedFirst((v) => v.kind !== "bicycle" && v.fuel <= 70); // a keg holds 30%
          if (keg && keg.fuel > 0 && dry) list.push({ id: "pour_keg", icon: "🛢", short: "Pour keg", label: `Pour the keg into your ${vehicleName(dry.kind)}` });
          const bike = ownedFirst((v) => v.kind === "bicycle");
          if (spotHere(["tyres", "fuel"]) && bike && bike.tyre < 95) {
            list.push(bike.tyre <= 0 ? { id: "pump", icon: "🛞", short: "Fix flat · 20", label: "Fix the flat · 20 coins" } : { id: "pump", icon: "🛞", short: "Pump · 5", label: "Pump the tyres · 5 coins" });
          }
          const motor = ownedFirst((v) => v.kind !== "bicycle" && (v.engine < 90 || !!v.broken_at));
          if (spotHere(["mechanic"]) && motor) {
            list.push({ id: "service", icon: "🔧", short: "Service · 60", label: `Service your ${vehicleName(motor.kind)} · 60 coins` });
          }
          const broken = owned.find((v) => !!v.broken_at && !v.repair_ready_at) ?? null; // the mechanic comes to you
          if (broken) {
            const fee = broken.kind === "bicycle" ? 30 : 80;
            list.push({ id: "mechanic", icon: "🔧", short: `Mechanic · ${fee}`, label: `Call a mechanic for your ${vehicleName(broken.kind)} · ${fee} coins` });
          }
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
            rest_here: "rest_here",
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
              no_vehicle: "None of your vehicles needs that.",
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
            traveller.restRate = movement.REST_REGEN;
            say(`Resting at ${r.place}. Energy comes back fast; walk on when you're ready.`);
          } else if (id === "rest_here") {
            traveller.resting = true;
            traveller.restRate = movement.ROADSIDE_REGEN;
            say(`You sit down ${traveller.mode === "bicycle" ? "by your bicycle" : "by the road"}. Energy comes back while you rest (faster at a park or a place to eat); move on when you're ready.`);
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
            say(`Poured: your ${name} has ${Math.round(r.fuel ?? 0)}% fuel.${r.spoilt ? " That was your keg's last use: it's worn out." : ` Your keg has ${r.usesLeft} uses left.`}`);
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
            say(`A mechanic is on the way to you: your ${r.kind ? vehicleName(r.kind) : "vehicle"} will be ready again in about 45 seconds. Then take it out with the vehicle button.`);
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
        if (kind) pocketAnim(kind, false);
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
            "Out of fuel",
            `Out of fuel! Your ${name} goes into your pocket. Any petrol station fills it there${keg && keg.fuel > 0 ? ", or pour in your keg right now" : ""}.`,
            ["fuel"],
          );
        } else {
          void advise("engine", "Broken down", `Your ${name} has broken down and goes into your pocket. Call a mechanic: the gold 🔧 button, or the vehicle button. They come to you, wherever you are.`, null);
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
            advice: { key: "bike", title: "Bicycle damaged", where: "Where you collapsed", text: "Your bicycle is damaged where you collapsed. Go back to it and call a mechanic to repair it (30 coins).", place: advicePlace },
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
        if (rental) {
          say("Return your rental first (vehicle button, then Get off), then ask for another.", true);
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
          say(r?.reason === "vehicle" ? "Return your rental first (vehicle button, then Get off), then ask for another." : "Couldn't arrange a rental just now. Try again.", true);
          return;
        }
        pocketed();
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
          const start = somewhereNear(at, 1200 + Math.random() * 1300);
          let found = (await routeOnOwnRoads(start, at, "car"))?.path ?? null;
          if (!found) {
            // Off our own roads (abroad): the routing service.
            const { route, fallback } = await fetchRoute(start, at, "car");
            if (!fallback) found = route.coords;
          }
          // The server takes drivers 200 m to 8 km away by road. A start across a lagoon or a rail line
          // can wind further: then the driver is already on the last 6 km of that way.
          const driven = found ? cumulativeOf(found).at(-1)! : 0;
          if (found && driven > 300) driverPath = thinPath(driven > 6000 ? sliceLine(found, driven - 6000, driven) : found);
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
        const night = isNight(Date.now(), pickupAt.lng, pickupAt.lat);
        const slow = trafficFactor(Date.now(), pickupAt.lng, pickupAt.lat);
        return {
          place,
          pickup: { name: "the pickup point", lng: pickupAt.lng, lat: pickupAt.lat, walkM: geo.distanceM([at.lng, at.lat], kerb) },
          driverPath,
          tripPath,
          to: { lng: end[0], lat: end[1] },
          metres,
          fare: Math.ceil(transitFare("taxi", metres) * (night ? NIGHT_TAXI_FARE : 1)),
          driverSeconds: Math.max(15, (cumulativeOf(driverPath).at(-1)! / DRIVER_SPEED) * slow),
          rideSeconds: (metres / transitSpeedFor("taxi", metres)) * slow,
          note: [night ? "🌙 Night fare (+30%)." : "", slow >= 1.5 ? "🚦 Rush hour: traffic makes it slower." : ""].filter(Boolean).join(" ") || undefined,
        };
      }

      async function callTaxi(q: TaxiQuote): Promise<string | null> {
        if (rental) return "Return your rental first (vehicle button, then Get off), then call a taxi.";
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
            vehicle: "Return your rental first (vehicle button, then Get off), then call a taxi.",
            on_trip: "You're already on a trip.",
            route: "Taxis go up to 40 km.",
            far: "That pickup point is too far from you.",
            path: "Couldn't plan that taxi ride. Try again.",
          };
          return why[r?.reason ?? ""] ?? "Couldn't call a taxi just now. Try again.";
        }
        pocketed();
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
          pocketed();
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

      // ---- Traffic and night and day (src/game/clock.ts) ----------------------
      // Jams build up on main roads in town at rush hour; they're the same for
      // every player (a stretch of road and a 15-minute window decide). Cars
      // crawl through them, motorbikes weave. Day and night follow the real sun.
      let lastTraffic = -Infinity;
      let lastSky = -Infinity;
      let jamHere: Jam = 0;
      let wasNight: boolean | null = null;
      let jamWarnedAt = -Infinity;
      const pointsOf = new WeakMap<RoadCellData, Map<number, { lng: number; lat: number }>>();
      const JAM_SHOWN_M = 2500;

      /** The jammed stretches around the hunter, drawn on the map (red: standstill, orange: slow). */
      function drawTraffic(now: number) {
        const src = map.getSource("traffic") as import("maplibre-gl").GeoJSONSource | undefined;
        if (!src) return;
        const { lng, lat } = traveller.pos;
        const level = trafficLevel(now, lng, lat);
        const features: GeoJSON.Feature[] = [];
        if (level > 0) {
          for (const key of squaresAround()) {
            const cell = roadSquares.get(key);
            if (typeof cell !== "object") continue;
            const urban = roads.cellUrban(cell);
            if (urban <= 0) continue;
            let pts = pointsOf.get(cell);
            if (!pts) {
              pts = new Map(cell.points.map((p) => [p.id, p]));
              pointsOf.set(cell, pts);
            }
            for (const way of cell.ways) {
              let line: [number, number][] = [];
              let lineJam: Jam = 0;
              const flush = () => {
                if (lineJam && line.length > 1) features.push({ type: "Feature", properties: { jam: lineJam }, geometry: { type: "LineString", coordinates: line } });
                line = [];
              };
              for (let i = 1; i < way.points.length; i++) {
                const jam = jamOn(way.cls, roads.jamStretch(way, i), urban, level, now);
                const a = pts.get(way.points[i - 1]);
                const b = pts.get(way.points[i]);
                if (!a || !b) continue;
                if (jam !== lineJam || !line.length) {
                  flush();
                  lineJam = jam;
                  if (jam && geo.distanceM([lng, lat], [a.lng, a.lat]) > JAM_SHOWN_M) lineJam = 0;
                  line = [[a.lng, a.lat]];
                }
                line.push([b.lng, b.lat]);
              }
              flush();
            }
          }
        }
        src.setData({ type: "FeatureCollection", features });
      }

      /** The jam (if any) where the hunter is: slows motorbikes and cars. */
      function trafficHere(now: number) {
        const here = network && onRoad ? roads.roadHere(network, onRoad) : null;
        const { lng, lat } = traveller.pos;
        const jam = here ? jamOn(here.cls, here.stretch, here.urban, trafficLevel(now, lng, lat), now) : 0;
        const motor = traveller.mode === "car" || traveller.mode === "motorbike";
        const speed = jamSpeed(traveller.mode, jam);
        if (speed !== trafficSpeed) {
          trafficSpeed = speed;
          applySpeed();
        }
        const shown: Jam = motor && !ride ? jam : 0;
        if (shown !== jamHere) {
          if (shown > jamHere && now - jamWarnedAt > 60_000) {
            jamWarnedAt = now;
            say(
              traveller.mode === "car"
                ? shown === 2
                  ? "Go-slow! The traffic has stopped: you're crawling. Side streets may be faster."
                  : "Slow traffic on this road."
                : shown === 2
                  ? "Go-slow! You weave your motorbike through the jam, slowly."
                  : "Slow traffic: you weave through on your motorbike.",
            );
          }
          jamHere = shown;
          setHud((h) => ({ ...h, jam: shown }));
        }
      }

      /** Light and dark: the map darkens at dusk (lit roads stay bright), the 3D figures too. */
      function updateSky(now: number) {
        const { lng, lat } = traveller.pos;
        const light = daylight(now, lng, lat);
        const dark = 1 - light;
        if (map.getLayer("night-ground")) {
          // Dusk and dawn are a deep purple; full night a dark blue.
          const tint = light > 0.15 ? "#2B2450" : "#0B1630";
          map.setPaintProperty("night-ground", "fill-color", tint);
          map.setPaintProperty("night-ground", "fill-opacity", 0.62 * dark);
          map.setPaintProperty("night-dim", "fill-opacity", 0.22 * dark);
        }
        layer.setDaylight(light);
        const night = isNight(now, lng, lat);
        const rush = trafficLevel(now, lng, lat) >= 0.8;
        const clock = { text: clockText(now, lng, lat), night, rush };
        setHud((h) => (JSON.stringify(h.clock) === JSON.stringify(clock) ? h : { ...h, clock }));
        if (wasNight !== null && night !== wasNight) {
          say(night ? "Night has fallen. Taxis charge a night fare and buses come less often." : "The sun is up. A new day!");
        }
        wasNight = night;
      }

      function skyAndTrafficTick(now: number) {
        const wall = Date.now();
        if (now - lastSky > 30_000) {
          lastSky = now;
          updateSky(wall);
          drawTraffic(wall);
        }
        if (now - lastTraffic > 1000) {
          lastTraffic = now;
          trafficHere(wall);
        }
      }

      // ---- The journey planner (design doc 7.8) ---------------------------
      // A place more than a city away: work out the ways there (fly, a long-distance
      // bus, a train, driving) as steps, then guide the player through them, drawing
      // only the current step. The journey is kept on this device across reloads.
      type ActiveJourney = { journey: Journey; step: number };
      const JOURNEY_KEY = "loota:journey";
      let journey: ActiveJourney | null = null;
      let journeyResumed = false;
      let lastJourneyTick = -Infinity;
      try {
        const saved = localStorage.getItem(JOURNEY_KEY);
        if (saved) journey = JSON.parse(saved) as ActiveJourney;
      } catch {
        journey = null;
      }
      const saveJourney = () => {
        try {
          if (journey) localStorage.setItem(JOURNEY_KEY, JSON.stringify(journey));
          else localStorage.removeItem(JOURNEY_KEY);
        } catch {
          // Not kept: fine.
        }
      };

      async function nearestStop(kind: "bus" | "train" | "plane", p: { lng: number; lat: number }) {
        const { data } = await supabase.rpc("stops_near", { p_kind: kind, p_lng: p.lng, p_lat: p.lat, p_limit: 1 });
        return ((data ?? []) as TransitStop[])[0] ?? null;
      }
      /** The motor park nearest a point, within `deg` degrees (long-distance buses leave from these). */
      async function nearestPark(p: { lng: number; lat: number }, deg: number) {
        const { data } = await supabase
          .from("transit_stops")
          .select("id, kind, name, lng, lat, line_id, code, park")
          .eq("kind", "bus")
          .eq("park", true)
          .gte("lng", p.lng - deg)
          .lte("lng", p.lng + deg)
          .gte("lat", p.lat - deg)
          .lte("lat", p.lat + deg);
        return (
          ((data ?? []) as Omit<TransitStop, "metres" | "line">[])
            .map((s) => ({ ...s, line: null, metres: Math.round(geo.distanceM([p.lng, p.lat], [s.lng, s.lat])) }))
            .sort((a, b) => a.metres - b.metres)[0] ?? null
        );
      }

      /** The ways to a far place, fastest first; null when it's near enough to just go. */
      async function journeyOptions(place: Place): Promise<Journey[] | null> {
        const from = { ...traveller.pos };
        if (geo.distanceM([from.lng, from.lat], [place.lng, place.lat]) <= LOCAL_M) return null;
        const options: Journey[] = [];
        const tries: Promise<void>[] = [];
        if (flyingMakesSense(from, place)) {
          tries.push(
            (async () => {
              const [a, b] = await Promise.all([nearestStop("plane", from), nearestStop("plane", place)]);
              if (!a || !b || a.id === b.id) return;
              const after = goLeg(b, place);
              options.push(
                journeyOf("fly", place, [goLeg(from, a), rideLeg("plane", a, b), after],
                  after.metres > 40_000 ? `The nearest airport is ${geo.formatDistance(after.metres)} from ${place.name} by road: a long way after landing.` : undefined),
              );
            })(),
          );
        }
        if (coachPossible(from, place)) {
          tries.push(
            (async () => {
              const [a, b] = await Promise.all([nearestPark(from, 0.6), nearestPark(place, 0.25)]);
              if (!a || !b || a.id === b.id) return;
              options.push(journeyOf("coach", place, [goLeg(from, a), rideLeg("bus", a, b), goLeg(b, place)]));
            })(),
          );
        }
        if (inNigeria(from) && inNigeria(place)) {
          tries.push(
            (async () => {
              const [a, b] = await Promise.all([nearestStop("train", from), nearestStop("train", place)]);
              if (!a || !b || a.id === b.id || !a.line_id || a.line_id !== b.line_id || a.metres > 40_000 || b.metres > 40_000) return;
              const { data } = await supabase.from("transit_stops").select("id, along_m").in("id", [a.id, b.id]);
              const along = new Map(((data ?? []) as { id: number; along_m: number }[]).map((s) => [s.id, s.along_m]));
              if (along.size < 2) return;
              options.push(journeyOf("train", place, [goLeg(from, a), rideLeg("train", a, b, Math.abs(along.get(a.id)! - along.get(b.id)!)), goLeg(b, place)]));
            })(),
          );
        }
        await Promise.all(tries);
        // Driving: your own motorbike or car, by road within Nigeria.
        const motor = owned.find((v) => v.kind !== "bicycle" && !v.broken_at);
        if (motor && coachPossible(from, place)) {
          const metres = Math.round(geo.distanceM([from.lng, from.lat], [place.lng, place.lat]) * 1.3);
          const fuel = (metres / 1000) * VEHICLES[motor.kind].fuelPerKm;
          options.push(
            journeyOf("drive", place, [{ kind: "go", to: place, metres, seconds: metres / movement.baseSpeed(motor.kind), fare: null, how: `Drive your ${vehicleName(motor.kind)}` }],
              fuel > motor.fuel ? `Needs about ${Math.round(fuel)}% of a tank: fill up on the way (you have ${Math.round(motor.fuel)}%).` : undefined),
          );
        }
        return options.sort((a, b) => a.seconds - b.seconds);
      }

      /** Directions to a place: straight there if it's near, otherwise the ways there to choose from. */
      async function routeTo(place: Place) {
        if (geo.distanceM([traveller.pos.lng, traveller.pos.lat], [place.lng, place.lat]) <= LOCAL_M) {
          void planDirections({ lng: place.lng, lat: place.lat }, place.name);
          return;
        }
        setJourneyPlan({ place, options: null, message: null });
        const options = await journeyOptions(place);
        if (disposed) return;
        if (!options) {
          setJourneyPlan(null);
          void planDirections({ lng: place.lng, lat: place.lat }, place.name);
          return;
        }
        setJourneyPlan({
          place,
          options,
          message: options.length ? null : "No bus, train or plane goes there from here. You can still take the road.",
        });
      }

      function startJourney(j: Journey) {
        journey = { journey: j, step: 0 };
        saveJourney();
        say(`Journey to ${j.place.name}: ${j.legs.length} steps. First: ${legText(j.legs[0])}.`, true);
        beginStep();
      }

      /** Draw the current step (only a step you go yourself has a route; a ride starts at its stop). */
      function beginStep() {
        if (!journey) return;
        const leg = journey.journey.legs[journey.step];
        if (leg.kind === "go") {
          const already = trip && geo.distanceM([trip.to.lng, trip.to.lat], [leg.to.lng, leg.to.lat]) < 60;
          if (!already) void planDirections({ lng: leg.to.lng, lat: leg.to.lat }, leg.to.name);
        }
        showJourney();
      }

      function endJourney(done = false) {
        if (!journey) return;
        if (done) say(`🧭 You've made it to ${journey.journey.place.name}. Journey complete!`, true);
        journey = null;
        saveJourney();
        showJourney();
      }

      function showJourney() {
        if (!journey) {
          setHud((h) => (h.journey ? { ...h, journey: null } : h));
          return;
        }
        const { legs } = journey.journey;
        const leg = legs[journey.step];
        const atStop = leg.kind === "ride" && !ride && geo.distanceM([traveller.pos.lng, traveller.pos.lat], [leg.from.lng, leg.from.lat]) <= TRANSIT[leg.mode].reachM;
        const view = {
          place: journey.journey.place.name,
          step: journey.step + 1,
          total: legs.length,
          text: leg.kind === "ride" && !atStop && !ride ? `Get to ${leg.from.name} to board` : legText(leg),
          board: atStop && leg.kind === "ride" ? `Board ${TRANSIT[leg.mode].icon} · about ${leg.fare.toLocaleString("en-NG")} coins` : null,
        };
        setHud((h) => (JSON.stringify(h.journey) === JSON.stringify(view) ? h : { ...h, journey: view }));
      }

      /** At the stop: price the ride exactly and board, with the place itself as where to go after. */
      async function boardJourney() {
        if (!journey) return;
        const leg = journey.journey.legs[journey.step];
        if (leg.kind !== "ride") return;
        const place = journey.journey.place;
        const quote =
          leg.mode === "bus"
            ? await quoteBus(leg.from, place)
            : await quoteTo(leg.from, { id: leg.to.id, name: leg.to.name, code: leg.to.code, lng: leg.to.lng, lat: leg.to.lat, metres: leg.metres, fare: leg.fare, seconds: leg.seconds });
        if (typeof quote === "string") {
          say(quote, true);
          return;
        }
        const problem = await board({ ...quote, then: place }, false);
        if (problem) say(problem, true);
        showJourney();
      }

      /** Move the journey on as the player gets places. */
      function journeyTick(now: number) {
        if (!journey || now - lastJourneyTick < 1000) return;
        lastJourneyTick = now;
        if (!journeyResumed) {
          journeyResumed = true;
          if (!ride) beginStep(); // after a reload: draw the current step again
        }
        const { legs } = journey.journey;
        const leg = legs[journey.step];
        const here: [number, number] = [traveller.pos.lng, traveller.pos.lat];
        if (leg.kind === "go") {
          const next = legs[journey.step + 1];
          const reach = next?.kind === "ride" ? TRANSIT[next.mode].reachM + 20 : 60;
          if (geo.distanceM(here, [leg.to.lng, leg.to.lat]) <= reach) {
            if (!next) return endJourney(true);
            journey.step++;
            saveJourney();
            say(`🧭 Step ${journey.step + 1} of ${legs.length}: you're at ${next.kind === "ride" ? next.from.name : leg.to.name}. ${next.kind === "ride" ? "Board when you're ready." : ""}`, true);
            beginStep();
            return;
          }
        } else if (!ride && geo.distanceM(here, [leg.to.lng, leg.to.lat]) <= 5000 && geo.distanceM(here, [leg.from.lng, leg.from.lat]) > 5000) {
          // Off the bus, train or plane at the far end: on to the last step (the ride already mapped it).
          journey.step++;
          saveJourney();
          if (journey.step >= legs.length) return endJourney(true);
          beginStep();
          return;
        }
        showJourney();
      }

      // ---- The lamp: Detours, whispers and the Orb (design doc 7.4, 7.5) -------
      // Nothing hidden is drawn on the map; the lamp holds it, one thing at a time,
      // with the way there drawn only when the player asks. It glows while what it
      // holds is new to the player.
      let lamp: LampState | null = null;
      let lampAt = -Infinity;
      let lampShownAt = -Infinity;
      const LAMP_SEEN_KEY = "loota:lamp-seen";
      const seenLamp = new Set<string>();
      try {
        for (const id of JSON.parse(localStorage.getItem(LAMP_SEEN_KEY) ?? "[]") as string[]) seenLamp.add(id);
      } catch {
        // Private browsing: everything counts as new this visit.
      }

      async function refreshLamp(): Promise<LampState> {
        lampAt = performance.now();
        await savePosition(); // the lamp looks around where the server last saw the player
        const { data } = await supabase.rpc("lamp_state");
        type RawItem =
          | ({ type: "detour" } & Omit<LampDetour, "endsAt"> & { endsAt: string })
          | { type: "whisper"; id: string; lng: number; lat: number; metres: number; endsAt: string }
          | { type: "orb"; id: string; lng: number; lat: number; metres: number; endsAt: string };
        const raw = data as { now: string; current: RawItem | null; hunt?: boolean } | null;
        if (disposed || !raw) return lamp ?? { current: null };
        const skew = Date.now() - Date.parse(raw.now);
        const here: [number, number] = [traveller.pos.lng, traveller.pos.lat];
        const before = lamp?.current?.id ?? null;
        const c = raw.current;
        const current: LampItem | null = !c
          ? null
          : c.type === "whisper"
            ? { ...c, endsAt: Date.parse(c.endsAt) + skew, direction: compassWord(geo.compassFromHeading(geo.headingOf(here, [c.lng, c.lat]))) }
            : { ...c, endsAt: Date.parse(c.endsAt) + skew };
        lamp = { current, inHunt: raw.hunt !== false };
        // Something new: say so (the lamp glows too).
        if (current && current.id !== before && !seenLamp.has(current.id)) {
          say(
            current.type === "detour"
              ? `🪔 The lamp glows: ${current.title}. Open it to see.`
              : current.type === "orb"
                ? "🪔 The lamp burns purple: the Lockdown Orb has surfaced."
                : "🪔 The lamp whispers: something is hidden nearby.",
          );
        }
        showLamp();
        return lamp;
      }

      function showLamp() {
        if (!lamp) return;
        const item = lamp.current;
        const at: [number, number] = [traveller.pos.lng, traveller.pos.lat];
        const detourHere =
          item?.type === "detour" &&
          !ride &&
          !visit &&
          !item.mine &&
          item.endsAt > Date.now() &&
          !(item.capacity !== null && item.claimed >= item.capacity) &&
          geo.distanceM(at, [item.lng, item.lat]) <= DETOUR_REACH_M
            ? item
            : null;
        const view = { has: !!item, unseen: !!item && !seenLamp.has(item.id) };
        setHud((h) =>
          h.lamp.has === view.has && h.lamp.unseen === view.unseen && h.detourHere?.id === detourHere?.id ? h : { ...h, lamp: view, detourHere },
        );
      }

      function lampSeen() {
        if (!lamp?.current) return;
        seenLamp.add(lamp.current.id);
        try {
          localStorage.setItem(LAMP_SEEN_KEY, JSON.stringify([...seenLamp].slice(-300)));
        } catch {
          // Not saved: fine.
        }
        showLamp();
      }

      function lampTick(now: number) {
        if (lampStale || now - lampAt > 30_000) {
          lampStale = false;
          void refreshLamp();
        } else if (now - lampShownAt > 1000) {
          lampShownAt = now;
          showLamp();
        }
      }

      setLampActions({
        refresh: async () => {
          const s = await refreshLamp();
          lampSeen();
          return s;
        },
        start: async (d) => {
          await savePosition(); // the server checks the player is there
          const { data } = await supabase.rpc("start_detour", { p_detour: d.id });
          const r = data as { ok: boolean; reason?: string; title?: string; question?: string; options?: string[]; seconds?: number; deadline?: string; now?: string } | null;
          if (!r?.ok) {
            const why: Record<string, string> = {
              far: `Get to ${d.place} first: you need to be right there.`,
              full: "Too late: others claimed them all.",
              over: "This one's gone.",
              tried: "You've already tried this one.",
            };
            return why[r?.reason ?? ""] ?? "Couldn't claim it just now. Try again.";
          }
          return {
            detourId: d.id,
            title: r.title!,
            question: r.question!,
            options: r.options!,
            seconds: r.seconds!,
            endsAt: Date.now() + (Date.parse(r.deadline!) - Date.parse(r.now!)),
          };
        },
        answer: async (detourId, choice) => {
          const { data } = await supabase.rpc("answer_detour", { p_detour: detourId, p_choice: choice });
          const r = data as ({ ok: boolean; balance?: number | null } & LampResult) | null;
          if (!r?.ok) return "Couldn't send your answer. Try again.";
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          if (r.outcome === "won" && r.relic) countRelics();
          lampStale = true; // done with: the next one comes
          return { outcome: r.outcome, answer: r.answer, coins: r.coins, relic: r.relic };
        },
        showWay: (to) => void routeTo({ name: to.name, detail: "", lng: to.lng, lat: to.lat }),
        dismiss: async (item) => {
          await supabase.rpc("lamp_dismiss", { p_kind: item.type, p_id: item.id });
          const s = await refreshLamp();
          lampSeen();
          return s;
        },
      });
      void refreshLamp();

      // ---- The Djinn's Wager (design doc 7.6) -------------------------------
      // Once a week the Djinn summons everyone at once through the lamp: his gate
      // puzzle, then his map of eight seals (one real). The way to the chosen seal
      // is drawn only when the player asks, through the journey planner.
      let djinn: DjinnState | null = null;
      let djinnAt = -Infinity;
      const noDjinn: DjinnState = { wager: null, stage: "over", gate: null, retryAt: null, favour: 0, riddle: null, seals: null, chosen: null };
      const djinnSeenKey = (id: string) => `loota:djinn-seen:${id}`;
      const djinnSeen = (id: string) => {
        try {
          return localStorage.getItem(djinnSeenKey(id)) === "1";
        } catch {
          return false;
        }
      };

      async function refreshDjinn(): Promise<DjinnState> {
        djinnAt = performance.now();
        const { data } = await supabase.rpc("djinn_state");
        type Raw = {
          now: string;
          wager: { id: string; wonder: string; extraWonder: string | null; startsAt: string; endsAt: string; claimedBy: string | null } | null;
          stage?: DjinnStage;
          gate?: (Omit<NonNullable<DjinnState["gate"]>, "deadline"> & { deadline: string }) | null;
          retryAt?: string | null;
          favour?: number | null;
          riddle?: string | null;
          seals?: DjinnState["seals"];
          chosen?: DjinnState["chosen"];
        };
        const raw = data as Raw | null;
        if (disposed || !raw) return djinn ?? noDjinn;
        const skew = Date.now() - Date.parse(raw.now);
        const at = (iso: string) => Date.parse(iso) + skew;
        const before = djinn?.wager?.id ?? null;
        const takenBefore = djinn?.wager?.claimedBy ?? null;
        djinn = {
          wager: raw.wager ? { ...raw.wager, extraWonder: raw.wager.extraWonder ?? null, startsAt: at(raw.wager.startsAt), endsAt: at(raw.wager.endsAt) } : null,
          stage: raw.stage ?? "over",
          gate: raw.gate ? { ...raw.gate, deadline: at(raw.gate.deadline) } : null,
          retryAt: raw.retryAt ? at(raw.retryAt) : null,
          favour: raw.favour ?? 0,
          riddle: raw.riddle ?? null,
          seals: raw.seals ?? null,
          chosen: raw.chosen ?? null,
        };
        if (djinn.wager && djinn.stage === "summoned" && djinn.wager.id !== before && !djinnSeen(djinn.wager.id)) {
          say("🧞 The lamp shakes and smokes purple: the Djinn has woken! Open the lamp.", true);
        }
        const taken = djinn.wager?.claimedBy;
        if (taken && !takenBefore && before === djinn.wager?.id && djinn.stage === "over") {
          say(`🧞 ${taken} has mastered the chamber and taken ${wonderOf(djinn.wager!.wonder).name}. The Wager is over.`, true);
        }
        showDjinn();
        return djinn;
      }

      function showDjinn() {
        const w = djinn?.wager;
        const view =
          w && djinn
            ? {
                stage: djinn.stage,
                wonder: w.wonder,
                endsAt: w.endsAt,
                fresh: djinn.stage === "summoned" && !djinnSeen(w.id),
                place: djinn.chosen?.name ?? null,
                rivals: djinnRivals,
              }
            : null;
        setHud((h) => (JSON.stringify(h.djinn) === JSON.stringify(view) ? h : { ...h, djinn: view }));
      }

      function djinnTick(now: number) {
        if (now - djinnAt > 60_000) void refreshDjinn();
        djinnApproachTick(now);
      }

      // ---- The approach to the chosen seal: traps, rivals, the chamber ----
      // Hidden traps lie on two rings around the place (the server springs them);
      // other hunters who broke the same seal are reported as they close in; at the
      // place, the chamber.
      let approachAt = -Infinity;
      let rivalsAt = -Infinity;
      let rivalBand = Infinity;
      let djinnRivals: { count: number; nearest: number } | null = null;
      const TRAPS: Record<string, string> = {
        quicksand: "Quicksand! You're stuck, sinking slowly. Hold still… (25 s)",
        dart_wall: "A dart wall! You dive for cover: stuck 15 s, and 10 energy lost.",
        snake_pit: "A snake pit! You scramble out, bitten and shaken: 25 energy lost.",
        collapsing_bridge: "The bridge collapses under you! You're swept back 300 m.",
      };

      function djinnApproachTick(now: number) {
        const site = djinn?.stage === "chosen" && !ride && !visit ? djinn.chosen : null;
        const d = site ? geo.distanceM([traveller.pos.lng, traveller.pos.lat], [site.lng, site.lat]) : Infinity;
        const here = site && d <= 55 ? { place: site.name } : null;
        setHud((h) => (h.djinnHere?.place === here?.place ? h : { ...h, djinnHere: here }));
        if (!site) return;
        if (d < 1300 && now - approachAt > 3000) {
          approachAt = now;
          void approach();
        }
        if (now - rivalsAt > 60_000) {
          rivalsAt = now;
          void watchRivals(site.name);
        }
      }

      async function approach() {
        await savePosition(); // the server checks the rings against where it last saw the player
        const { data } = await supabase.rpc("djinn_approach");
        const r = data as { quest: boolean; energy?: number; trap?: { kind: string; stuck?: number; lng?: number; lat?: number } | null } | null;
        const trap = r?.trap;
        if (disposed || !trap) return;
        if (r.energy != null) traveller.energy = r.energy;
        if (trap.stuck) {
          stuckUntil = performance.now() + trap.stuck * 1000;
          traveller.v = 0;
        }
        if (trap.lng != null && trap.lat != null) placeAt(trap.lng, trap.lat);
        setTrapFlash(true);
        window.setTimeout(() => setTrapFlash(false), 1400);
        say(TRAPS[trap.kind] ?? "A trap!", true);
      }

      async function watchRivals(place: string) {
        const { data } = await supabase.rpc("djinn_rivals");
        const r = data as { count: number; nearest: number | null } | null;
        djinnRivals = r && r.count > 0 && r.nearest != null ? { count: r.count, nearest: r.nearest } : null;
        showDjinn();
        if (!djinnRivals) return;
        const band = [500, 2000, 5000].find((b) => djinnRivals!.nearest <= b);
        if (band && band < rivalBand) {
          rivalBand = band;
          say(`⚠ A rival hunter is within ${geo.formatDistance(band)} of ${place}. Hurry!`, true);
        }
      }

      setDjinnActions({
        state: async () => {
          const s = await refreshDjinn();
          if (s.wager) {
            try {
              localStorage.setItem(djinnSeenKey(s.wager.id), "1");
            } catch {
              // Not kept: the summons shows again next time.
            }
            showDjinn();
          }
          return s;
        },
        startGate: async () => {
          const { data } = await supabase.rpc("djinn_start_gate");
          const r = data as { ok: boolean; reason?: string } | null;
          if (!r?.ok) {
            return r?.reason === "turned_away"
              ? "The Djinn will not see you yet."
              : r?.reason === "passed"
                ? "You've already passed his gate."
                : "The Djinn has gone back into the lamp.";
          }
          return refreshDjinn();
        },
        answerGate: async (cipher, path, weights) => {
          const { data } = await supabase.rpc("djinn_answer_gate", { p_cipher: cipher, p_path: path, p_weights: weights });
          const r = data as ({ ok: boolean } & GateVerdict) | null;
          if (!r?.ok) return "The Djinn didn't hear you. Try again.";
          void refreshDjinn();
          return { score: r.score, favour: r.favour, rooms: r.rooms };
        },
        choose: async (siteId) => {
          const { data } = await supabase.rpc("djinn_choose", { p_site: siteId });
          const r = data as { ok: boolean; reason?: string } | null;
          if (!r?.ok) return r?.reason === "chosen" ? "You've already broken a seal." : "That seal won't break.";
          return refreshDjinn();
        },
        showWay: (site) => void routeTo({ name: site.name, detail: site.country, lng: site.lng, lat: site.lat }),
        enterChamber: async () => {
          await savePosition(); // the server checks the player is at the place
          const { data } = await supabase.rpc("djinn_enter_chamber");
          type Raw = Omit<DjinnChamber, "id" | "deadline"> & { ok: boolean; reason?: string; chamber: string; deadline: string; now: string };
          const r = data as Raw | null;
          if (!r?.ok) {
            return r?.reason === "far" ? "The chamber's door is right at the place: get closer." : "The Djinn's Wager is over.";
          }
          return {
            id: r.chamber,
            place: r.place,
            seconds: r.seconds,
            deadline: Date.now() + (Date.parse(r.deadline) - Date.parse(r.now)),
            cipher: r.cipher,
            floor: r.floor,
            scales: r.scales,
          };
        },
        answerChamber: async (chamberId, cipher, path, weights) => {
          const { data } = await supabase.rpc("djinn_answer_chamber", { p_chamber: chamberId, p_cipher: cipher, p_path: path, p_weights: weights });
          const r = data as ({ ok: boolean } & ChamberResult) | null;
          if (!r?.ok) return "The chamber is silent. Try again.";
          const place = djinn?.chosen;
          if (r.outcome === "whirlwind" && r.dropAt) {
            const drop = r.dropAt;
            setWhirlwind(true);
            window.setTimeout(() => {
              if (disposed) return;
              snapReachM = 3000; // dropped on the airfield: onto its nearest road
              placeAt(drop.lng, drop.lat);
              setWhirlwind(false);
              const far = place ? geo.formatDistance(geo.distanceM([drop.lng, drop.lat], [place.lng, place.lat])) : "far";
              say(`🌪 The whirlwind spits you out at ${drop.name}, ${far} from ${place?.name ?? "the place"}. Come back and face the chamber again.`, true);
            }, 2500);
          } else if (r.outcome === "won") {
            say(`🧞 ${wonderOf(r.wonder).name.replace(/^the /, "The ")} is yours! It's in your bag, and only you know.`, true);
          } else if (r.outcome === "coin") {
            say("🪙 Your Djinn's Coin glowed and crumbled to dust: the whirlwind died at your feet. Face the chamber again.", true);
          }
          void refreshDjinn();
          return { outcome: r.outcome, rooms: r.rooms, wonder: r.wonder, extraWonder: r.extraWonder, dropAt: r.dropAt };
        },
      });
      void refreshDjinn();

      // ---- The Djinn's Wonders (design doc 7.7): using one, and hearing of every use ----
      type WonderEvent = { id: number; wonder: string; message: string; at: string; mine: boolean; hitMe: boolean; savedMe: boolean };
      type WonderNews = {
        now: string;
        latest: number;
        events: WonderEvent[];
        position: LngLat | null;
        frozenUntil: string | null;
        sandstorm: { until: string; by: string } | null;
        eyeUntil: string | null;
        cloakUntil: string | null;
        mirrorUntil: string | null;
      };
      type EyeHunter = { name: string; lng: number; lat: number; keysHeld: number; chasing: { key: number; lng: number; lat: number; radiusM: number } | null };
      const WONDER_POLL_MS = 8000;
      /** Wonders that move whoever they hit, and ones that take or give keys. */
      const MOVES = new Set(["cataclysm_orb", "orb_of_return", "djinns_bargain"]);
      const CHANGES_KEYS = new Set(["cataclysm_orb", "orb_of_oblivion", "thiefs_hand", "master_key"]);
      /** What a Wonder did to you, after the news of it. */
      const HIT_YOU: Record<string, string> = {
        cataclysm_orb: "Your keys are gone, and you're back home.",
        orb_of_oblivion: "Your keys are gone.",
        orb_of_return: "You're back home. Your keys are safe.",
        hourglass_of_ages: "You can't move until the sand runs out.",
        thiefs_hand: "One of your keys was stolen.",
        djinns_bargain: "You were in the lead: now you stand where they stood.",
      };
      const WONDER_REFUSED: Record<string, string> = {
        gone: "That Wonder has faded.",
        passive: "The Djinn's Coin works by itself: once, it spares you a wipe, a throw-back or the whirlwind.",
        no_hunt: "Its power wakes only in a live hunt you've joined. Keep it secret until then.",
        where: "Pick a place for the carpet first.",
        trip: "Get off the bus, train or plane first.",
        no_map: "The Seer's Seal works on the Djinn's map: pass his gate while a Wager is on, then break it before you choose a seal.",
        not_at_key: "The Master Key turns only at your next key's spot. Find it, stand on it, then turn the Key. It stays in your bag.",
        nobody_near: "No hunter holding a key is within 1 km. The Hand stays in your bag.",
        no_leader: "There's no other hunter on the map to bargain with. The Bargain stays in your bag.",
        position: "Move a little first, then try again.",
      };
      let wondersAt = -Infinity;
      let wonderSince = -1; // the last Wonder news heard on this device (-1: never looked)
      try {
        wonderSince = Number(localStorage.getItem("loota:wonder-seen") ?? -1);
      } catch {
        wonderSince = -1;
      }
      let frozenUntil = 0; // Date.now() times (frozenUntil: the Hourglass of Ages)
      let sandUntil = 0;
      let sandBy: string | null = null;
      let eyeUntil = 0;
      let eyeAt = -Infinity;
      let eyeSeen: EyeHunter[] = [];
      let lastWonderHud = 0;
      const banners: { icon: string; text: string; hit: boolean; flash: boolean }[] = [];
      let bannerN = 0;
      let bannerTimer = 0;

      /** A banner for each piece of news, one after another. */
      function showWonder(wonder: string, text: string, hit: boolean) {
        banners.push({ icon: wonderOf(wonder).icon, text, hit, flash: hit && wonder === "cataclysm_orb" });
        if (!bannerTimer) nextBanner();
      }
      function nextBanner() {
        if (disposed) return;
        const b = banners.shift();
        setWonderBanner(b ? { ...b, n: ++bannerN } : null);
        bannerTimer = b ? window.setTimeout(nextBanner, 6000) : 0;
      }

      /** Frozen by the Hourglass of Ages until then (the server says when; the loop holds the player till then). */
      function freeze(until: number) {
        frozenUntil = until;
        if (until > Date.now()) traveller.v = 0;
      }

      /** Where the server has the player now (after a Wonder moved them). */
      async function landWhereServerSays() {
        const { data } = await supabase.from("player_positions").select("lng, lat").eq("user_id", playerId).maybeSingle();
        if (disposed || !data) return;
        placeAt(data.lng, data.lat);
      }

      async function wonderNews() {
        wondersAt = performance.now();
        const { data } = await supabase.rpc("wonder_news", { p_since: Math.max(0, wonderSince) });
        const n = data as WonderNews | null;
        if (disposed || !n) return;
        const skew = Date.now() - Date.parse(n.now);
        const at = (iso: string | null) => (iso ? Date.parse(iso) + skew : 0);
        const firstLook = wonderSince < 0;
        wonderSince = Math.max(wonderSince, n.latest);
        try {
          localStorage.setItem("loota:wonder-seen", String(wonderSince));
        } catch {
          // Private browsing: news may be told again next time.
        }
        let moved = false;
        let keys = false;
        for (const e of n.events) {
          // The holder heard when they used it; a Coin that saved you is told by what it saved you from.
          if (e.mine) continue;
          if (firstLook && Date.now() - at(e.at) > 120_000) continue; // old news
          if (e.hitMe && MOVES.has(e.wonder)) moved = true;
          if (CHANGES_KEYS.has(e.wonder)) keys = true;
          const text = e.savedMe
            ? `${e.message} …but your Djinn's Coin glowed and spared you! It's dust now.`
            : e.hitMe && HIT_YOU[e.wonder]
              ? `${e.message} ${HIT_YOU[e.wonder]}`
              : e.message;
          showWonder(e.wonder, text, e.hitMe);
        }
        if (moved && n.position && !ride) placeAt(n.position.lng, n.position.lat);
        if (keys) window.dispatchEvent(new Event("loota:hunt-changed"));

        // What's acting on the player now.
        freeze(at(n.frozenUntil));
        sandUntil = at(n.sandstorm?.until ?? null);
        sandBy = n.sandstorm?.by ?? null;
        eyeUntil = at(n.eyeUntil);
        const wasCloaked = Date.now() < cloakedUntil;
        cloakedUntil = at(n.cloakUntil);
        mirroredUntil = at(n.mirrorUntil);
        if (!wasCloaked && Date.now() < cloakedUntil) {
          // Vanish from everyone's map straight away.
          sayBye();
          void huntChannel?.send({ type: "broadcast", event: "bye", payload: { id: playerId } });
        }
        if (Date.now() < mirroredUntil) lastAnnounce = 0;
        showWonders();
      }

      async function useWonder(id: string, to?: LngLat): Promise<string> {
        if (to && rental) {
          const text = "Return your rental first (vehicle button, then Get off), then fly: the carpet carries only you.";
          say(text, true);
          return text;
        }
        await savePosition();
        const { data, error } = await supabase.rpc("use_wonder", { p_wonder: id, p_lng: to?.lng ?? null, p_lat: to?.lat ?? null });
        const r = data as { ok: boolean; reason?: string; wonder?: string; message?: string; lng?: number; lat?: number; finished?: boolean } | null;
        if (disposed) return "";
        if (error || !r || !r.ok) {
          const text = (r && WONDER_REFUSED[r.reason ?? ""]) ?? "The Wonder didn't stir. Try again.";
          if (to) say(text, true);
          return text;
        }
        const wonder = r.wonder ?? "";
        const message = `${r.message ?? ""}${r.finished ? " That was the last key: you've finished the hunt!" : ""}`;
        showWonder(wonder, message, false);
        if (wonder === "carpet_of_kings" && r.lng != null && r.lat != null) {
          pocketed(); // the carpet carries only you; your vehicle rides in your pocket
          snapReachM = 3000; // set down beside the place: onto its nearest road
          placeAt(r.lng, r.lat);
          void refreshVehicles();
        } else if (MOVES.has(wonder)) {
          await landWhereServerSays();
        }
        if (CHANGES_KEYS.has(wonder)) window.dispatchEvent(new Event("loota:hunt-changed"));
        if (wonder === "seers_seal") void refreshDjinn();
        await wonderNews(); // the Eye, the Cloak and the Mirror start now
        if (wonder === "eye_of_the_djinn") void lookWithEye();
        return message;
      }

      /** The Eye of the Djinn: every other hunter in the hunt, and the key areas they chase. */
      async function lookWithEye() {
        eyeAt = performance.now();
        const { data } = await supabase.rpc("eye_view");
        if (disposed) return;
        eyeSeen = (data ?? []) as EyeHunter[];
        drawEye();
      }
      const ringAround = (lng: number, lat: number, r: number) =>
        Array.from({ length: 49 }, (_, i) => {
          const a = (i / 48) * 2 * Math.PI;
          return [lng + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.cos(a)) / 110574];
        });
      function drawEye() {
        const source = map.getSource("eye") as import("maplibre-gl").GeoJSONSource | undefined;
        if (!source) return;
        const features: GeoJSON.Feature[] = [];
        const areas = new Set<number>();
        for (const h of eyeSeen) {
          features.push({ type: "Feature", properties: { label: `${h.name} · ${h.keysHeld} keys` }, geometry: { type: "Point", coordinates: [h.lng, h.lat] } });
          const c = h.chasing;
          if (c && !areas.has(c.key)) {
            areas.add(c.key);
            features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ringAround(c.lng, c.lat, c.radiusM)] } });
          }
        }
        source.setData({ type: "FeatureCollection", features });
      }

      function showWonders() {
        const left = (until: number) => Math.max(0, Math.ceil((until - Date.now()) / 1000));
        const sandLeft = left(sandUntil);
        if ((sandLeft > 0 ? 0.5 : 1) !== sandFactor) {
          sandFactor = sandLeft > 0 ? 0.5 : 1;
          applySpeed();
        }
        const here: [number, number] = [traveller.pos.lng, traveller.pos.lat];
        const view: Hud["wonders"] = {
          frozen: left(frozenUntil) || null,
          sand: sandLeft ? { seconds: sandLeft, by: sandBy } : null,
          eye: left(eyeUntil)
            ? {
                seconds: left(eyeUntil),
                hunters: eyeSeen
                  .map((h) => ({
                    name: h.name,
                    keysHeld: h.keysHeld,
                    metres: Math.round(geo.distanceM(here, [h.lng, h.lat])),
                    bearing: Math.round(geo.compassFromHeading(geo.headingOf(here, [h.lng, h.lat])) - map.getBearing()),
                  }))
                  .sort((a, b) => a.metres - b.metres)
                  .slice(0, 5),
              }
            : null,
          cloaked: Date.now() < cloakedUntil,
          mirrored: Date.now() < mirroredUntil,
        };
        setHud((h) => (JSON.stringify(h.wonders) === JSON.stringify(view) ? h : { ...h, wonders: view }));
      }

      function wondersTick(now: number) {
        if (now - wondersAt > WONDER_POLL_MS) void wonderNews();
        const eyeOpen = Date.now() < eyeUntil;
        if (eyeOpen && now - eyeAt > 5000) void lookWithEye();
        if (!eyeOpen && eyeSeen.length) {
          eyeSeen = [];
          drawEye();
        }
        if (now - lastWonderHud > 1000) {
          lastWonderHud = now;
          showWonders();
        }
      }

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
        const canMove = !frozen && now >= stuckUntil && Date.now() >= frozenUntil && !ride && !visit && !!onRoad;
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
        skyAndTrafficTick(now);
        lampTick(now);
        journeyTick(now);
        djinnTick(now);
        wondersTick(now);
        pocketTick(now);

        if (now - lastHud > 100) {
          lastHud = now;
          const energy = Math.round(traveller.energy);
          const hunters = others.size;
          const radarLeft = Math.max(0, Math.round((radarUntil - Date.now()) / 1000));
          const turnTo = (p: Pointer | null) => (p ? { bearing: Math.round(p.bearing - map.getBearing()), metres: p.metres } : null);
          const radar = radarLeft > 0 ? { secondsLeft: radarLeft, relic: turnTo(radarSeen.relic), key: turnTo(radarSeen.key) } : null;
          const dome = domeStatus();
          const speedKmh = Math.round((traveller.v / movement.TIME_SCALE) * 3.6);

          // Only re-render the display when something visible changed.
          setHud((h) =>
            h.energy === energy &&
            h.speedKmh === speedKmh &&
            h.hunters === hunters &&
            JSON.stringify(h.radar) === JSON.stringify(radar) &&
            JSON.stringify(h.dome) === JSON.stringify(dome)
              ? h
              : { ...h, energy, speedKmh, hunters, radar, dome },
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
        // Night: the ground darkens under the roads (they stay lit), and everything a little over them.
        // Buildings go under the roads first, so the dark covers them too.
        const firstRoad = styleLayers.find((l) => l.type === "line" && /^(road|bridge|tunnel)_/.test(l.id))?.id;
        if (firstRoad && map.getLayer("building")) map.moveLayer("building", firstRoad);
        const world: GeoJSON.Feature = {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] },
        };
        map.addSource("night", { type: "geojson", data: world });
        map.addLayer({ id: "night-ground", type: "fill", source: "night", paint: { "fill-color": "#0B1630", "fill-opacity": 0 } }, firstRoad);
        map.addLayer({ id: "night-dim", type: "fill", source: "night", paint: { "fill-color": "#0B1630", "fill-opacity": 0 } }, firstSymbol);
        // Traffic jams, over the roads and under the route.
        map.addSource("traffic", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer(
          {
            id: "traffic",
            type: "line",
            source: "traffic",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["match", ["get", "jam"], 2, "#D62828", "#F28C28"],
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 6, 20, 14],
              "line-opacity": 0.8,
            },
          },
          firstSymbol,
        );
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
        // The Eye of the Djinn (a Wonder): other hunters, and the key areas they chase.
        map.addSource("eye", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const isArea: import("maplibre-gl").FilterSpecification = ["==", ["geometry-type"], "Polygon"];
        const isHunter: import("maplibre-gl").FilterSpecification = ["==", ["geometry-type"], "Point"];
        map.addLayer({ id: "eye-area", type: "fill", source: "eye", filter: isArea, paint: { "fill-color": "#9B5DE5", "fill-opacity": 0.15 } }, firstSymbol);
        map.addLayer(
          { id: "eye-edge", type: "line", source: "eye", filter: isArea, paint: { "line-color": "#C3A6FF", "line-width": 2, "line-dasharray": [2, 2] } },
          firstSymbol,
        );
        map.addLayer({
          id: "eye-hunter",
          type: "circle",
          source: "eye",
          filter: isHunter,
          paint: { "circle-radius": 7, "circle-color": "#9B5DE5", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 },
        });
        map.addLayer({
          id: "eye-name",
          type: "symbol",
          source: "eye",
          filter: isHunter,
          layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top" },
          paint: { "text-color": "#FFFFFF", "text-halo-color": "#2A1747", "text-halo-width": 2 },
        });
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
  /** A square icon button (top bar and the tools on the right). */
  const tool = "pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-xl";
  /** A small count on an icon button's corner. */
  const badge = "absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-extrabold leading-none";
  /** A small status chip under the top bar. */
  const chip = "pointer-events-auto flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold";
  /** Something to do right here (above the street name). */
  const here = "pointer-events-auto flex h-10 items-center rounded-full bg-gold px-3.5 text-sm font-bold text-ink shadow-lg disabled:opacity-50";
  const distanceText = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-map">
      {/* MapLibre sets its container to position: relative, so it gets its own full-size box. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        {/* Top bar: back, energy, coins, bag, help */}
        <div className="flex items-center gap-2">
          <Link href="/lobby" aria-label="Back to the lobby" title="Back to the lobby" className={`${tool} bg-ink text-paper`}>
            <BackIcon />
          </Link>
          <div className="pointer-events-auto flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-ink px-3 sm:max-w-xs" aria-label={`Energy ${hud.energy} of 100`} title="Energy">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#1E9E62" aria-hidden="true" className="shrink-0">
              <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
            </svg>
            <div className="h-2 flex-1 overflow-hidden rounded bg-line">
              <div className={`h-full ${energyColour}`} style={{ width: `${hud.energy}%` }} />
            </div>
            <span className="w-7 text-right text-sm font-bold">{hud.energy}</span>
          </div>
          <span className="pointer-events-auto flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm font-bold" aria-label={`${hud.coins} coins`} title="Coins">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2.4" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
            </svg>
            {hud.coins.toLocaleString("en-NG")}
          </span>
          <button
            type="button"
            onClick={() => setBagOpen(true)}
            aria-label={`Bag${hud.relics > 0 ? `: ${hud.relics} relics` : ""}`}
            title="Bag"
            className={`${tool} relative bg-ink text-[#C3A6FF]`}
          >
            <BagIcon />
            {hud.relics > 0 && <span className={`${badge} bg-paper text-ink`}>{hud.relics}</span>}
          </button>
          <button
            type="button"
            aria-label="Help"
            title="Help"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((o) => !o)}
            className={`${tool} text-lg font-extrabold ${helpOpen ? "bg-gold text-ink" : "bg-ink"}`}
          >
            ?
          </button>
        </div>

        <div className="flex items-start gap-2">
          {/* Left: what's going on (small chips), then the cards */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {(hud.clock ||
              hud.vehicle ||
              hud.keg ||
              hud.radar ||
              hud.dome ||
              hud.rain ||
              hud.hunters > 0 ||
              hud.turn !== 0 ||
              hud.wonders.frozen ||
              hud.wonders.sand ||
              hud.wonders.eye ||
              hud.wonders.cloaked ||
              hud.wonders.mirrored) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {hud.clock && (
                  <div
                    className={`${chip} ${hud.clock.night ? "bg-[#0B1630] text-[#C9D6FF]" : "bg-ink"}`}
                    aria-label={`${hud.clock.text}${hud.clock.night ? ", night" : ""}${hud.clock.rush ? ", rush hour" : ""}`}
                    title={hud.clock.night ? "Night: taxis charge a night fare, buses come less often" : "Local time"}
                  >
                    <span aria-hidden="true">{hud.clock.night ? "🌙" : "☀️"}</span>
                    {hud.clock.text}
                    {hud.clock.rush && <span className="text-[#F28C28]">· rush hour</span>}
                  </div>
                )}
                {hud.jam > 0 && (
                  <div
                    className={`${chip} ${hud.jam === 2 ? "bg-danger" : "bg-[#F28C28] text-ink"}`}
                    aria-label={hud.jam === 2 ? "Traffic jam: at a standstill" : "Slow traffic"}
                    title={hud.jam === 2 ? "Go-slow: traffic at a standstill" : "Slow traffic"}
                  >
                    <span aria-hidden="true">🚦</span>
                    {hud.jam === 2 ? "Go-slow" : "Slow traffic"}
                  </div>
                )}
                {hud.turn !== 0 && (
                  <button
                    type="button"
                    onClick={() => actions.current?.turn(hud.turn as -1 | 1)}
                    className={`${chip} bg-gold text-ink`}
                    aria-label={`Turning ${hud.turn === -1 ? "left" : "right"} at the next junction. Press to cancel.`}
                  >
                    <span aria-hidden="true" className="text-base">{hud.turn === -1 ? "↰" : "↱"}</span>
                    {hud.turn === -1 ? "Left" : "Right"}
                    <CloseIcon size={12} />
                  </button>
                )}
                {hud.vehicle && (hud.vehicle.fuel != null || hud.vehicle.tyre != null || hud.vehicle.meter) && (
                  <div className={`${chip} bg-ink`} aria-label={`Your ${VEHICLES[hud.vehicle.kind].name.toLowerCase()}`}>
                    {hud.vehicle.fuel != null && (
                      <span className={hud.vehicle.fuel < 15 ? "text-danger" : ""} title="Fuel">⛽ {Math.round(hud.vehicle.fuel)}%</span>
                    )}
                    {hud.vehicle.tyre != null && (
                      <span className={hud.vehicle.tyre < 40 ? "text-danger" : ""} title="Tyres">{hud.vehicle.tyre <= 0 ? "🛞 flat" : `🛞 ${Math.round(hud.vehicle.tyre)}%`}</span>
                    )}
                    {hud.vehicle.engine != null && hud.vehicle.engine < 50 && (
                      <span className={hud.vehicle.engine < 30 ? "text-danger" : ""} title="Engine">🔧 {Math.round(hud.vehicle.engine)}%</span>
                    )}
                    {hud.vehicle.meter && <span className="font-semibold text-muted" title="Rental meter">{hud.vehicle.meter}</span>}
                  </div>
                )}
                {hud.keg && (
                  <div className={`${chip} bg-ink`} aria-label={`Fuel keg ${Math.round(hud.keg.fuel)}%, ${hud.keg.usesLeft} uses left`} title={`Fuel keg · ${hud.keg.usesLeft} uses left`}>
                    <span aria-hidden="true">🛢</span>
                    {hud.keg.fuel > 0 ? `${Math.round(hud.keg.fuel)}%` : "empty"}
                  </div>
                )}
                {hud.wonders.frozen && (
                  <div className={`${chip} bg-[#16324F] text-[#CFE6FF] ring-1 ring-[#8EC5FF]`} aria-label="Frozen by the Hourglass of Ages" title="Frozen by the Hourglass of Ages">
                    <span aria-hidden="true">⌛</span>
                    Frozen {mmss(hud.wonders.frozen)}
                  </div>
                )}
                {hud.wonders.sand && (
                  <div className={`${chip} bg-[#6B4A16] text-paper`} aria-label="Sandstorm: half speed" title={`${hud.wonders.sand.by ?? "Someone"}'s Sandstorm Crown: half speed`}>
                    <span aria-hidden="true">🌪</span>
                    Sandstorm · half speed {mmss(hud.wonders.sand.seconds)}
                  </div>
                )}
                {hud.wonders.cloaked && (
                  <div className={`${chip} bg-[#2A1747] text-[#C3A6FF]`} aria-label="Cloaked: nobody can see you" title="The Phantom Cloak: off everyone's map">
                    <span aria-hidden="true">🧥</span>
                    Unseen
                  </div>
                )}
                {hud.wonders.mirrored && (
                  <div className={`${chip} bg-[#2A1747] text-[#C3A6FF]`} aria-label="Mirrored: three copies of you" title="The Mirror of Many: three copies of you">
                    <span aria-hidden="true">🪞</span>×3
                  </div>
                )}
                {hud.wonders.eye && (
                  <div className="pointer-events-auto flex w-full max-w-xs flex-col gap-1 rounded-lg bg-[#2A1747] px-2.5 py-2 text-xs font-bold text-paper ring-1 ring-[#9B5DE5]" aria-label="The Eye of the Djinn">
                    <span className="flex items-center gap-1.5 text-[#C3A6FF]">
                      <span aria-hidden="true">👁</span> The Eye sees · {mmss(hud.wonders.eye.seconds)}
                    </span>
                    {hud.wonders.eye.hunters.length === 0 ? (
                      <span className="font-semibold text-paper/70">No other hunter in the hunt</span>
                    ) : (
                      hud.wonders.eye.hunters.map((h, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="#C3A6FF" aria-hidden="true" style={{ transform: `rotate(${h.bearing}deg)` }}>
                            <path d="M12 2l6 18-6-4-6 4z" />
                          </svg>
                          <span className="truncate">{h.name}</span>
                          <span className="font-semibold text-paper/70">
                            {distanceText(h.metres)} · {h.keysHeld} {h.keysHeld === 1 ? "key" : "keys"}
                          </span>
                        </span>
                      ))
                    )}
                  </div>
                )}
                {hud.radar && (
                  <div className={`${chip} bg-[#3B2F0A] text-paper ring-1 ring-gold`} aria-label="Radar">
                    <span className="text-gold">Radar</span>
                    {hud.radar.relic ? (
                      <span className="flex items-center gap-1">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#F4B41A" aria-hidden="true" style={{ transform: `rotate(${hud.radar.relic.bearing}deg)` }}>
                          <path d="M12 2l6 18-6-4-6 4z" />
                        </svg>
                        relic {distanceText(hud.radar.relic.metres)}
                      </span>
                    ) : (
                      <span className="font-semibold text-paper/70">no relic within 3 km</span>
                    )}
                    {hud.radar.key && (
                      <span className="flex items-center gap-1">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#3DD68C" aria-hidden="true" style={{ transform: `rotate(${hud.radar.key.bearing}deg)` }}>
                          <path d="M12 2l6 18-6-4-6 4z" />
                        </svg>
                        key {hud.radar.key.metres} m
                      </span>
                    )}
                    <span className="font-semibold text-paper/70">
                      {Math.floor(hud.radar.secondsLeft / 60)}:{String(hud.radar.secondsLeft % 60).padStart(2, "0")}
                    </span>
                  </div>
                )}
                {hud.dome && (
                  <div
                    className={`${chip} bg-[#3A1E5C] ring-1 ring-[#C89BFF]`}
                    aria-label="Lockdown dome"
                    title={hud.dome.inside ? (hud.dome.mine ? "Your dome" : "Inside a dome") : "A dome nearby"}
                  >
                    <span aria-hidden="true">🔒</span>
                    Key {hud.dome.key} · {hud.dome.minutesLeft} min
                  </div>
                )}
                {hud.rain && (
                  <div className={`${chip} bg-[#173B5C]`} aria-label="Rain" title={hud.rain.slowed ? "Rain: 20% slower on foot or bike" : "Rain"}>
                    <span aria-hidden="true">🌧</span>
                    {hud.rain.slowed ? "−20%" : "Rain"}
                  </div>
                )}
                {hud.hunters > 0 && (
                  <div className={`${chip} bg-ink`} aria-label={`${hud.hunters} other hunters nearby`} title="Hunters nearby">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7FB2FF" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="9" cy="8" r="3.5" />
                      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.6-4.8-4-5.6" />
                    </svg>
                    {hud.hunters}
                  </div>
                )}
              </div>
            )}

            {carpetFor && (
              <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2 rounded-2xl bg-[#2A1747] p-3 text-paper ring-2 ring-[#9B5DE5]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold">🧞 Where shall the Carpet of Kings fly you? Anywhere in the world.</span>
                  <button
                    type="button"
                    onClick={() => setCarpetFor(null)}
                    aria-label="Not now"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/60"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                <PlaceSearch
                  inline
                  near={() => actions.current?.where() ?? { lng: startLng, lat: startLat }}
                  onPick={(place) => {
                    const id = carpetFor;
                    setCarpetFor(null);
                    void actions.current?.useWonder(id, { lng: place.lng, lat: place.lat });
                  }}
                />
              </div>
            )}

            {searchOpen && (
              <PlaceSearch
                near={() => actions.current?.where() ?? { lng: startLng, lat: startLat }}
                onPick={(place) => {
                  actions.current?.goTo(place);
                  setSearchOpen(false);
                }}
              />
            )}

            {/* A journey under way: which step, and the Board button at the stop. */}
            {hud.journey && !hud.ride && !hud.care && (
              <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2 rounded-2xl bg-[#14324A] p-3 text-paper ring-1 ring-[#5FA8E6]" role="status" aria-label="Your journey">
                <div className="flex items-center gap-2">
                  <span className="text-xl" aria-hidden="true">
                    🧭
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-extrabold">
                      Step {hud.journey.step} of {hud.journey.total} · to {hud.journey.place}
                    </span>
                    <span className="truncate text-xs text-paper/85">{hud.journey.text}</span>
                  </div>
                  <button type="button" aria-label="End the journey" onClick={() => actions.current?.endJourney()} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-paper/70">
                    <CloseIcon />
                  </button>
                </div>
                {hud.journey.board && (
                  <button type="button" disabled={hud.busy} onClick={() => actions.current?.boardJourney()} className="h-10 rounded-xl bg-gold px-3 text-sm font-bold text-ink disabled:opacity-50">
                    {hud.journey.board}
                  </button>
                )}
              </div>
            )}

            {/* Directions: the next turn. The player steers; this only guides. */}
            {hud.guide && (
              <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-[#1E9E62] p-3 text-paper" role="status" aria-label="Directions">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0" style={{ transform: `rotate(${hud.guide.arrow}deg)` }}>
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

            {/* A warning: tired, fuel low, soft tyres, a worn engine; and the nearest place that helps. Tap for the whole story. */}
            {hud.advice && !hud.care && (
              <div className="pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-2xl bg-[#3B2F0A] p-2.5 text-sm text-paper ring-1 ring-gold" role="alert">
                <button type="button" onClick={() => setAdviceOpen((o) => !o)} aria-expanded={adviceOpen} className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="font-bold text-gold">⚠ {hud.advice.title}</span>
                  {adviceOpen ? (
                    <span className="text-xs">{hud.advice.text}</span>
                  ) : (
                    hud.advice.where && <span className="truncate text-xs text-paper/80">{hud.advice.where}</span>
                  )}
                </button>
                {hud.advice.place && (
                  <button
                    type="button"
                    onClick={() => actions.current?.followAdvice()}
                    aria-label={`Directions to ${hud.advice.place.name}`}
                    title={`Directions to ${hud.advice.place.name}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold text-ink"
                  >
                    <DirectionsIcon />
                  </button>
                )}
                <button type="button" aria-label="Dismiss" onClick={() => actions.current?.dismissAdvice()} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-paper/70">
                  <CloseIcon />
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
              <div className="pointer-events-auto flex max-h-[60dvh] max-w-md flex-col gap-2 overflow-y-auto rounded-2xl bg-ink p-4 text-sm" role="note">
                <p className="font-bold">The buttons</p>
                <ul className="flex flex-col gap-1.5">
                  <li className="flex items-center gap-2"><span className="text-paper"><DirectionsIcon /></span> Directions: search a place or tap the map</li>
                  <li className="flex items-center gap-2"><span className="text-paper"><VehicleIcon kind={hud.vehicle?.kind ?? null} /></span> Walk, or ride a bicycle, motorbike or car</li>
                  <li className="flex items-center gap-2"><span className="text-paper"><BusIcon /></span> Bus, train, plane or taxi (gold at a stop)</li>
                  <li className="flex items-center gap-2"><span className="text-paper"><LandmarkIcon /></span> Landmarks: check in for coins</li>
                  <li className="flex items-center gap-2"><span className="text-gold"><LampIcon /></span> The lamp: Detours, whispers and hidden finds during a hunt (it glows); the Djinn between hunts (it smokes purple)</li>
                  <li className="flex items-center gap-2"><span className="text-[#C3A6FF]"><BagIcon /></span> Your bag: relics</li>
                </ul>
                <p className="mt-1 font-bold">How to move</p>
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
                  Things you can do where you stand (eat, rest, refuel, check in) appear as gold buttons above the street name.
                </p>
                <p>
                  <b>Night and day</b> follow the real sun where you are. At night taxis charge more and buses come less often.{" "}
                  <b>Traffic:</b> at rush hour main roads in town jam (red: standstill, orange: slow). Cars crawl, motorbikes weave
                  through; walkers and cyclists aren&apos;t held up.
                </p>
                <button type="button" onClick={() => setHelpOpen(false)} className="self-start font-bold text-gold">
                  Got it
                </button>
              </div>
            )}

            {/* The hunt (riddle, keys, Search here) */}
            {huntId && huntShown && <HuntPanel huntId={huntId} actions={huntActions} onHide={hideHunt} />}
          </div>

          {/* Right: the tools, as icons */}
          <nav className="flex shrink-0 flex-col gap-2" aria-label="Tools">
            <button
              type="button"
              data-tool="directions"
              aria-label="Get directions"
              title="Directions"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((o) => !o)}
              className={`${tool} ${searchOpen ? "bg-gold text-ink" : "bg-ink text-paper"}`}
            >
              <DirectionsIcon />
            </button>
            <button
              type="button"
              data-tool="travel"
              aria-label={hud.vehicle ? `Travelling by ${VEHICLES[hud.vehicle.kind].name.toLowerCase()}: change` : "Walking: get a vehicle"}
              title={hud.vehicle ? VEHICLES[hud.vehicle.kind].name : "Walking · Vehicles"}
              onClick={() => setGarage(actions.current?.vehicles() ?? [])}
              className={`${tool} ${hud.vehicle ? "bg-gold text-ink" : "bg-ink text-paper"}`}
            >
              <VehicleIcon kind={hud.vehicle?.kind ?? null} />
            </button>
            <button
              type="button"
              data-tool="transit"
              aria-label={hud.stopHere?.label ?? "Bus, train, plane or taxi"}
              title={hud.stopHere?.label ?? "Bus · Train · Plane · Taxi"}
              disabled={!!hud.ride}
              onClick={() => setTransitOpen(true)}
              className={`${tool} relative disabled:opacity-50 ${hud.stopHere ? "bg-gold text-ink" : "bg-ink text-paper"}`}
            >
              <BusIcon />
              {hud.stopHere && <span className={`${badge} bg-ink text-paper`} aria-hidden="true">{hud.stopHere.icon}</span>}
            </button>
            <button
              type="button"
              data-tool="landmarks"
              aria-label="Landmarks"
              title="Landmarks"
              onClick={() => setLandmarksOpen({ quiz: null, message: null })}
              className={`${tool} relative ${hud.landmarkHere?.canTry ? "bg-gold text-ink" : "bg-ink text-paper"}`}
            >
              <LandmarkIcon />
            </button>
            <button
              type="button"
              data-tool="lamp"
              aria-label={`The lamp${hud.lamp.has ? (hud.lamp.unseen ? ": something new" : ": something waiting") : ""}`}
              title="The lamp"
              onClick={() => (hud.djinn?.fresh ? setDjinnOpen({ chamber: null }) : setLampOpen({ quiz: null }))}
              className={`${tool} relative ${
                hud.djinn && ["summoned", "gate", "seals"].includes(hud.djinn.stage)
                  ? "loota-lamp-djinn bg-[#5B2A9E] text-paper"
                  : hud.lamp.unseen
                    ? "loota-lamp-glow bg-gold text-ink"
                    : hud.lamp.has
                      ? "bg-ink text-gold"
                      : "bg-ink text-paper/60"
              }`}
            >
              <LampIcon />
              {hud.lamp.has && <span className={`absolute -right-1 -top-1 size-3 rounded-full ring-2 ring-ink ${hud.lamp.unseen ? "bg-ink" : "bg-gold"}`} aria-hidden="true" />}
            </button>
          </nav>
        </div>
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
          onWonder={async (id, wonder) => {
            if (wonder === "carpet_of_kings") {
              setBagOpen(false);
              setCarpetFor(id);
              return null;
            }
            return (await actions.current?.useWonder(id)) ?? "The map isn't ready yet.";
          }}
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
          onGetOff={() => {
            actions.current?.getOff();
            setGarage(null);
          }}
          onMechanic={() => {
            actions.current?.act("mechanic");
            setGarage(null);
          }}
          onTaxi={() => {
            setGarage(null);
            setTransitOpen(true);
          }}
          onClose={() => setGarage(null)}
        />
      )}

      {journeyPlan && (
        <JourneyPanel
          place={journeyPlan.place}
          options={journeyPlan.options}
          message={journeyPlan.message}
          onChoose={(j) => actions.current?.chooseJourney(j)}
          onRoadOnly={() => actions.current?.roadOnly(journeyPlan.place)}
          onClose={() => setJourneyPlan(null)}
        />
      )}

      {lampOpen && lampActions && (
        <LampPanel
          actions={lampActions}
          quiz={lampOpen.quiz}
          djinn={hud.djinn}
          onDjinn={() => {
            setLampOpen(null);
            setDjinnOpen({ chamber: null });
          }}
          onClose={() => setLampOpen(null)}
        />
      )}

      {djinnOpen && djinnActions && <DjinnPanel actions={djinnActions} chamber={djinnOpen.chamber} onClose={() => setDjinnOpen(null)} />}

      {/* Carried off by the Djinn's whirlwind; a trap springing. */}
      {whirlwind && (
        <div className="loota-whirlwind-screen pointer-events-none absolute inset-0 z-30 flex items-center justify-center" aria-hidden="true">
          <span className="text-7xl">🌪</span>
        </div>
      )}
      {trapFlash && <div className="loota-trap-flash pointer-events-none absolute inset-0 z-20" aria-hidden="true" />}

      {/* The Djinn's Wonders: news of every use, and what they do to you. */}
      {hud.wonders.sand && <div className="loota-sand pointer-events-none absolute inset-0" aria-hidden="true" />}
      {hud.wonders.frozen && <div className="loota-frost pointer-events-none absolute inset-0" aria-hidden="true" />}
      {wonderBanner?.flash && <div key={`flash-${wonderBanner.n}`} className="loota-cataclysm-flash pointer-events-none absolute inset-0 z-30" aria-hidden="true" />}
      {wonderBanner && (
        <div
          key={wonderBanner.n}
          role="alert"
          className={`loota-wonder-banner pointer-events-none absolute inset-x-3 top-20 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-[#2A1747] p-4 text-paper ring-2 ${
            wonderBanner.hit ? "ring-danger" : "ring-[#9B5DE5]"
          }`}
        >
          <span className="text-4xl" aria-hidden="true">
            {wonderBanner.icon}
          </span>
          <p className="text-sm font-bold">{wonderBanner.text}</p>
        </div>
      )}

      {landmarksOpen && landmarkActions && (
        <LandmarkPanel actions={landmarkActions} quiz={landmarksOpen.quiz} message={landmarksOpen.message} onClose={() => setLandmarksOpen(null)} />
      )}

      {transitOpen && transitActions && (
        <TransitPanel actions={transitActions} coins={hud.coins} onClose={() => setTransitOpen(false)} />
      )}

      {/* What can be done right here: check in, eat, rest, refuel, kegs, tyres, repairs; and the siege at a dome's edge. */}
      {(hud.dome?.siege || hud.actions.length > 0 || hud.detourHere || hud.djinnHere || (hud.landmarkHere?.canTry && !hud.ride && !hud.care)) && (
        <div
          className="pointer-events-none absolute inset-x-3 bottom-[156px] flex flex-wrap items-end justify-center gap-2 sm:bottom-[144px]"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          {hud.dome?.siege && (
            <button
              type="button"
              onClick={() => actions.current?.attackDome()}
              className="pointer-events-auto flex w-full max-w-xs flex-col items-center rounded-2xl bg-[#9B5DE5] px-6 py-3 font-display text-lg font-extrabold text-paper shadow-lg active:scale-95"
            >
              ⚔ Attack the dome
              <span className="text-xs font-semibold text-paper/85">
                {hud.dome.siege.attackers} of {hud.dome.siege.needed} hunters attacking together
              </span>
            </button>
          )}
          {hud.djinnHere && (
            <button
              type="button"
              disabled={checkingIn}
              onClick={() => void enterChamber()}
              aria-label={`Enter the chamber at ${hud.djinnHere.place}`}
              className="pointer-events-auto flex h-10 items-center gap-1.5 rounded-full bg-[#9B5DE5] px-3.5 text-sm font-bold text-paper shadow-lg disabled:opacity-50"
            >
              🧞 Enter the chamber
            </button>
          )}
          {hud.detourHere && (
            <button
              type="button"
              disabled={checkingIn}
              onClick={() => void claimDetour(hud.detourHere!)}
              aria-label={`Claim ${hud.detourHere.title}`}
              title={hud.detourHere.title}
              className={`${here} gap-1.5`}
            >
              <LampIcon size={18} />
              Claim · {hud.detourHere.relic ? RELICS[hud.detourHere.relic].name : `+${hud.detourHere.coins}`}
            </button>
          )}
          {hud.landmarkHere?.canTry && !hud.ride && !hud.care && (
            <button
              type="button"
              disabled={checkingIn}
              onClick={() => void checkIn(hud.landmarkHere!.landmark)}
              aria-label={`Check in at ${hud.landmarkHere.landmark.name} for ${hud.landmarkHere.landmark.reward} coins`}
              title={`Check in at ${hud.landmarkHere.landmark.name}`}
              className={`${here} gap-1.5`}
            >
              <LandmarkIcon size={18} />
              Check in · +{hud.landmarkHere.landmark.reward}
            </button>
          )}
          {hud.actions.map((a) => (
            <button key={a.id} type="button" disabled={hud.busy} onClick={() => actions.current?.act(a.id)} aria-label={a.label} title={a.label} className={`${here} gap-1`}>
              <span aria-hidden="true">{a.icon}</span>
              {a.short}
            </button>
          ))}
        </div>
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

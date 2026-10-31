"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { LootaLogo } from "@/components/Logo";
import { HuntInvite, MoveDemo, WelcomeTour, type OpenHunt } from "./WelcomeTour";
import { keeperLook, lookForId, type AvatarLook } from "@/lib/avatar";
import type { LngLat } from "@/game/geo";
import { MODES, canSprint, type Mode } from "@/game/movement";
import { PICKUP_RADIUS_M, RELIC_ICON, RELICS, type Lead, type RelicId, type WorldItem } from "@/game/items";
import { ADDONS, CALL_OUT_PRICE, FLAT_FIX_PRICE, KEG_CAPACITY, KEG_PRICE, MEAL_ENERGY, MEAL_PRICE, NOT_PAPERS, VEHICLES, type AddonId, type VehicleKind } from "@/game/economy";
import { cue, setSound, soundOn } from "@/game/sound";
import { RepairScene, type RepairActions, type RepairJob } from "./RepairScene";
import { RentalScene, type RentalActions, type RentalOffer } from "./RentalScene";
import { FuelScene, type FuelActions, type FuelOffer } from "./FuelScene";
import { MealScene, todaysMenu, type MealActions, type MealOffer } from "./MealScene";
import type { SceneMoment } from "./EventScene";
import { NurseScene, type Discharge } from "./NurseScene";
import { TicketScene, type TicketActions, type TicketOffer } from "./TicketScene";
import { QuizScene, type QuizActions, type QuizOffer } from "./QuizScene";
import { CoinShop, confirmPayment } from "./CoinShop";
import { PumpScene, type PumpActions, type PumpOffer } from "./PumpScene";
import { FlatScene, type FlatActions, type FlatOffer } from "./FlatScene";
import { PourScene, type PourActions, type PourOffer } from "./PourScene";
import { LoungeScene, type LoungeView } from "./LoungeScene";
import { ServiceScene, type ServiceActions, type ServiceOffer } from "./ServiceScene";
import { KEY_SCENE_INFO, isKeyScene, type KeyScene } from "@/game/keyScenes";
import { loadSignals, signalAhead, signalState, signalsNear, signalsOnPath, waitForGreen, type Signal } from "@/game/signals";
import { jamsAlongPath, planRide, rideAt, type Hold, type RideSchedule } from "@/game/rideSchedule";
import { OFFICER, RoadEventScene, type RoadEvent, type RoadEventActions, type RoadEventResult } from "./RoadEventScene";
import type { RoadGameResult } from "./RoadGames";
import { BagPanel } from "./BagPanel";
import { VehiclePanel, type OwnedVehicle } from "./VehiclePanel";
import { HuntPanel, type HuntActions } from "./HuntPanel";
import { HuntClock } from "./HuntClock";
import { StoryScene } from "./StoryScene";
import { trapBeat, type StoryLine } from "@/game/story";
import type { SearchResult } from "@/game/hunt";
import type { Place } from "@/game/places";
import { ROAD_CELL_DEG, ROAD_DATA_VERSION, decodeRoadCell, roadCellKey, type RoadCellData, type RoadCellFile } from "@/game/roadData";
import { PlaceSearch } from "./PlaceSearch";
import { BackIcon, BagIcon, BusIcon, CloseIcon, DirectionsIcon, LampIcon, RadioIcon, TrophyIcon, VehicleIcon } from "./HudIcons";
import { JourneyPanel, legText } from "./JourneyPanel";
import { DjinnPanel, type ChamberResult, type DjinnActions, type DjinnChamber, type DjinnStage, type DjinnState, type GateVerdict } from "./DjinnPanel";
import { wonderOf } from "@/game/wonders";
import { LOCAL_M, coachPossible, flyingMakesSense, goLeg, inNigeria, journeyOf, rideLeg, type Journey } from "@/game/journey";
import { NewsToasts } from "./NewsToasts";
import { local, peopleOf, setCountry, words, type Role } from "@/game/locale";
import { RadioPanel, useRadio } from "./RadioPanel";
import { ScrollIcon, StoryScroll, useHuntStory } from "./StoryScroll";
import { DETOUR_REACH_M, LampPanel, type LampActions, type LampDetour, type LampItem, type LampQuestion, type LampResult, type LampState } from "./LampPanel";
import { highwayRoute, loadHighways } from "@/game/highways";
import { NIGHT_BUS_WAIT, NIGHT_TAXI_FARE, clockText, daylight, isNight, jamOn, jamSpeed, trafficFactor, trafficLevel, type Jam } from "@/game/clock";
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
  /**
   * The rush for a crowded bus (at night and rush hour): the question now (6 s each), the marks so far, and
   * then how it went. Shown over the map, not in a panel.
   */
  rush: {
    q: string;
    choices: number[];
    index: number;
    total: number;
    left: number;
    per: number;
    marks: ("right" | "wrong" | "late" | "done")[];
    outcome: { boarded: boolean; score: number; of: number; next: number | null } | null;
  } | null;
  /** On a bus, train or plane (or waiting for one). */
  /** `toGo`: the distance still to travel once moving ("312 km"), for the trip's icon on a phone. */
  ride: { icon: string; title: string; status: string; canCancel: boolean; pass: boolean; toGo: string | null; to: string } | null;
  /** At a bus stop, station or airport: what the transport button offers. */
  stopHere: { icon: string; label: string } | null;
  /** At a station's ticket office or an airport's check-in desk: the button to go in. */
  /** At a train station or airport: its ticket office or check-in (`away`: metres to its door; 0 at it). */
  ticketHere: { kind: "train" | "plane"; name: string; away: number } | null;
  /** What can be done where the player stands: eat, rest, refuel, kegs, tyres, repairs. */
  actions: { id: LimitAction; icon: string; short: string; label: string }[];
  /** A warning that needs acting on (tired, fuel low, soft tyres, a worn engine), with the nearest place that helps. */
  advice: { key: string; title: string; text: string; where: string | null; place: { name: string; lng: number; lat: number } | null } | null;
  /** Going nowhere (dead end after dead end, round in circles, shut in): the offer to be put on a road that leads out. */
  stuck: boolean;
  /** Being looked after: the ambulance, the hospital, a mechanic on the way. */
  care: { icon: string; title: string; status: string } | null;
  /** The fuel keg the player carries, if any. */
  keg: { fuel: number; usesLeft: number } | null;
  /** Tyre kits (pump and patches) the player has. */
  tyreKits: number;
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
  /** Stopped at a red light: seconds until green. */
  redLight: number | null;
  /** A rental waiting at a bus stop, or a taxi on its way: where, how far, and the button once there. */
  pickup: { icon: string; title: string; status: string; action: string | null } | null;
  /** At a repair shop the player's vehicle is booked into: the "Enter" button. */
  repairHere: RepairJob | null;
  /** The metal detector in a hunt (key_pulse): in the key's area, how hot (0–1), warmer or colder; the chest within reach. */
  heat: { level: number; trend: "warmer" | "colder" | "steady"; chest: boolean; trap: boolean } | null;
  /** The police on your tail (owner, 25 Oct 2026): how far behind, and seconds left until you've lost them. */
  chase: { gap: number; left: number; chaser: "officer" | "patrol" } | null;
  /** Waiting for a flight in the departure lounge (owner, 26 Oct 2026), until it leaves. */
  lounge: LoungeView | null;
  /** Cruise (owner, 25 Oct 2026): tokens held (15 s each, up to 8), on or off, and what's left of the one in use (0–1). */
  cruise: { tokens: number; on: boolean; part: number };
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
type LimitAction = "eat" | "rest" | "rest_here" | "refuel" | "buy_keg" | "fill_keg" | "pour_keg" | "pump" | "service" | "mechanic" | "jerry_relic" | "tyre_kit" | "flat";

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

/** The Lamp's messenger (in purple, like the lamp's glow). */
const MESSENGER: AvatarLook = { skin: "#8D5524", hair: "bun", hairColour: "#1B120C", top: "hoodie", topColour: "#7C4DCC", bottomsColour: "#2A1747", extra: "none" };
/**
 * The renter, pump attendant, cook, vulcanizer, mechanic, nurse, paramedic and clerk in the scenes: the same one for
 * the same place or visit, with a name from the country the hunter is in (src/game/locale.ts).
 */
function nameFor(role: Role, seed: string) {
  const list = peopleOf(role);
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) % 9973;
  return list[n % list.length];
}
function renterName(requestedAt: string) {
  return nameFor("renter", requestedAt);
}

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
/**
 * The one zoom level the game is played at (a few streets around the hunter); players can't change it. Closer on a
 * phone (owner, 27 Oct 2026: "on mobile … zoom to 18"), then 17.5 (28 Oct: at 18 the ground slid past twice as fast as on a laptop).
 */
const GAME_ZOOM = typeof window !== "undefined" && window.matchMedia("(max-width: 600px)").matches ? 17.5 : 17;
/** A "do it here" button (Refuel, Eat…) ignores taps for this long after it appears, and presses held longer than this. */
const HERE_ARM_MS = 900;
const HERE_TAP_MS = 600;

/** A status card folded to an icon on a phone: what it is, a short badge (a time, a distance), and whether it needs the player now. */
type StatusPill = { id: string; icon: ReactNode; badge: string | null; tone: string; call: boolean; label: string; place?: string };
/** How long a new status card shows in full on a phone before folding to its icon. */
const CARD_PEEK_MS = 4000;
const PHONE_QUERY = "(max-width: 600px)";
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;
function onPhoneChange(fn: () => void) {
  const q = window.matchMedia(PHONE_QUERY);
  q.addEventListener("change", fn);
  return () => q.removeEventListener("change", fn);
}
/** The first time in a status line, short: "2 min 30 s" → "2:30", "45 s" → "45s". */
function shortTime(text: string) {
  const m = text.match(/(\d+) min(?: (\d+) s)?|(\d+) s\b/);
  if (!m) return null;
  return m[3] ? `${m[3]}s` : `${m[1]}:${String(m[2] ?? 0).padStart(2, "0")}`;
}

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
  openHunt = null,
  newcomer = false,
  huntClock = null,
  hasDetector = false,
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
  /** A live hunt the player hasn't joined: an invitation on the map (and the welcome tour's last card). */
  openHunt?: OpenHunt | null;
  /** Welcomed with coins at onboarding: the welcome tour, the first time on the map (on this device). */
  newcomer?: boolean;
  /** The hunt's times, for its clock at the top (the joined hunt, or a live one to join). */
  huntClock?: { startsAt: string; endsAt: string; allDay?: boolean } | null;
  /** A metal detector bought: it beeps as a key gets closer (the server also lets it reach farther). */
  hasDetector?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef({ go: false, sprint: false });
  const actions = useRef<{
    vehicles: () => OwnedVehicle[];
    ride: (kind: VehicleKind, how: "own" | "rent" | "buy", addons?: AddonId[]) => void;
    /** Buy a vehicle's gear or a licence; resolves when done (the vehicles list is fresh). */
    buyAddon: (kind: VehicleKind, id: AddonId) => Promise<void>;
    /** The repair shop for a broken-down vehicle: found (or recalled), with the way there. */
    findRepairShop: (kind: VehicleKind) => void;
    /** The way by road to a vehicle parked at the roadside (out of fuel). */
    wayToParked: (kind: VehicleKind) => void;
    /** Go into a repair shop: the open-roof shop on the map, the camera looking in (an in-world scene). */
    enterShop: (job: RepairJob) => void;
    /** Go into the ticket office or check-in hall where the player stands. */
    enterTicket: () => void;
    /** The Djinn's chamber on the map, where the player stands. */
    openVault: (chamber: DjinnChamber) => void;
    /** A landmark's plaza or the Lamp's spot where the player stands, on the map; false if it can't be shown. */
    openQuizPlace: (kind: "landmark" | "detour", name: string, host: AvatarLook) => boolean;
    /** Walk out of the place: back to the street. */
    leaveShop: () => void;
    /** What's happening in the scene, for the place on the map to show it. */
    sceneMoment: (m: SceneMoment) => void;
    getOff: () => void;
    /** Stuck: put on the nearest road that leads somewhere (or told the way out), or the offer put away. */
    getOut: () => void;
    notStuck: () => void;
    refuel: () => void;
    eat: () => void;
    /** Use a relic from the bag; resolves to a message for the bag. */
    useRelic: (id: string) => Promise<string>;
    /** Use a small item (the tyre kit). */
    useItem: (item: "tyre_kit") => Promise<string>;
    /** Use a Wonder from the bag (`to`: where the Carpet of Kings flies); resolves to a message. */
    useWonder: (id: string, to?: LngLat) => Promise<string>;
    /** Attack the dome the hunter is standing at the edge of. */
    attackDome: () => void;
    /** Cruise on or off. */
    toggleCruise: () => void;
    /** A scene that held the hunter (the pour) is over. */
    endHold: () => void;
    /** Buy cruise tokens (4 for 40 coins, up to the most you can hold); resolves to a message. */
    buyCruise: () => Promise<string>;
    /** Open the chest where the hunter stands when it's the Masquerade's decoy. */
    springTrap: () => void;
    /** Dizzy from the trap (after the Masquerade's scene): held still for `seconds`. */
    dizzy: (seconds: number) => void;
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
    /** Use a Fast Pass on the bus, train, taxi or flight being waited for. */
    fastPass: () => void;
    /** An answer in the bus rush (the choice's place, 0–2). */
    rushAnswer: (choice: number) => void;
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
    ticketHere: null,
    actions: [],
    advice: null,
    stuck: false,
    care: null,
    keg: null,
    tyreKits: 0,
    pickup: null,
    clock: null,
    jam: 0,
    redLight: null,
    lamp: { has: false, unseen: false },
    detourHere: null,
    journey: null,
    djinn: null,
    djinnHere: null,
    wonders: { frozen: null, sand: null, eye: null, cloaked: false, mirrored: false },
    repairHere: null,
    rush: null,
    heat: null,
    chase: null,
    cruise: { tokens: 0, on: false, part: 0 },
    lounge: null,
  });
  const [bagOpen, setBagOpen] = useState(false);
  const [detector, setDetector] = useState(hasDetector);
  const detectorRef = useRef(hasDetector); // for the map's own loop
  /** Buy the metal detector (from the inventory). */
  const buyDetector = async (): Promise<string> => {
    const { createClient } = await import("@/lib/supabase/client");
    const { data } = await createClient().rpc("buy_detector");
    const r = data as { ok: boolean; reason?: string; balance?: number; price?: number } | null;
    if (r?.ok) {
      setDetector(true);
      detectorRef.current = true;
      if (r.balance != null) setHud((h) => ({ ...h, coins: Number(r.balance) }));
      cue("coin");
      return "📡 Your metal detector is ready: it beeps as you close in on a key, and picks one up from farther away.";
    }
    if (r?.reason === "owned") return "You already have a metal detector.";
    if (r?.reason === "coins") return `A metal detector costs ${r.price ?? 300} coins.`;
    return "Couldn't buy it right now. Try again.";
  };
  // The first time on the map: the welcome tour (once per player on this device); a live hunt's invitation.
  const tourKey = `loota:welcome:${playerId}`;
  const tourSeen = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(tourKey) === "1";
      } catch {
        return true; // private browsing: no tour rather than one every time
      }
    },
    () => true, // on the server: none
  );
  const [tourDone, setTourDone] = useState(false);
  const [tourAgain, setTourAgain] = useState(false); // asked for from the help panel
  const touring = (newcomer && !tourSeen && !tourDone) || tourAgain;
  const [inviteOff, setInviteOff] = useState(false);
  const endTour = () => {
    setTourDone(true);
    setTourAgain(false);
    try {
      localStorage.setItem(tourKey, "1");
    } catch {
      // Private browsing: it may show again next time.
    }
  };
  const [bagOwned, setBagOwned] = useState<OwnedVehicle[]>([]); // the inventory's vehicles, gear and papers
  const [helpOpen, setHelpOpen] = useState(false);
  const [radioOpen, setRadioOpen] = useState(false);
  // A story hunt's story, on a scroll the hunter opens and closes at any time (owner, 31 Oct 2026).
  const [storyOpen, setStoryOpen] = useState(false);
  const huntStory = useHuntStory(huntId);
  const radio = useRadio();
  const [sound, setSoundState] = useState(() => soundOn()); // sounds and buzzes (owner, 24 Oct 2026), kept on this device
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
  /**
   * "Open the chest": the hunt card searches right there and starts the Key Trial. With the card put away (owner,
   * 20 Oct 2026: "I clicked open chest nothings happens") it comes back first and searches once it's ready.
   */
  const chestAsked = useRef(false);
  const boardAsked = useRef(false);
  /** Golden minutes (when they end, this device's clock), as the hunt card hears of them. */
  const [goldenUntil, setGoldenUntil] = useState<number | null>(null);
  useEffect(() => {
    const golden = (e: Event) => setGoldenUntil((e as CustomEvent<number | null>).detail);
    window.addEventListener("loota:golden", golden);
    return () => window.removeEventListener("loota:golden", golden);
  }, []);
  /** The leaderboard lights up when another hunter takes a key (owner, 26 Oct 2026), until it's opened. */
  const [boardLit, setBoardLit] = useState(false);
  useEffect(() => {
    const lit = () => setBoardLit(true);
    window.addEventListener("loota:key-news", lit);
    return () => window.removeEventListener("loota:key-news", lit);
  }, []);
  /** 🏆 on the right: the hunt card's leaderboard (the card comes back first if it was put away). */
  const openBoard = () => {
    setBoardLit(false);
    if (huntShown) {
      window.dispatchEvent(new Event("loota:board"));
      return;
    }
    boardAsked.current = true;
    document.cookie = "loota_hidden_hunt=; path=/; max-age=0";
    setHuntShown(true);
  };
  const openChest = () => {
    if (huntShown) {
      window.dispatchEvent(new Event("loota:hunt-search"));
      return;
    }
    chestAsked.current = true;
    document.cookie = "loota_hidden_hunt=; path=/; max-age=0";
    setHuntShown(true);
  };
  useEffect(() => {
    const ready = () => {
      if (boardAsked.current) {
        boardAsked.current = false;
        window.dispatchEvent(new Event("loota:board"));
      }
      if (!chestAsked.current) return;
      chestAsked.current = false;
      window.dispatchEvent(new Event("loota:hunt-search"));
    };
    window.addEventListener("loota:hunt-ready", ready);
    return () => window.removeEventListener("loota:hunt-ready", ready);
  }, []);
  const [journeyPlan, setJourneyPlan] = useState<{ place: Place; options: Journey[] | null; message: string | null } | null>(null);
  const [garage, setGarage] = useState<OwnedVehicle[] | null>(null); // the vehicle panel, when open
  const [transitOpen, setTransitOpen] = useState(false);
  const [transitActions, setTransitActions] = useState<TransitActions | null>(null); // set once the map is ready
  const [checkingIn, setCheckingIn] = useState(false);
  const [lampActions, setLampActions] = useState<LampActions | null>(null);
  const [repairActions, setRepairActions] = useState<RepairActions | null>(null);
  const [repairOpen, setRepairOpen] = useState<RepairJob | null>(null);
  /** Inside a place on the map (an in-world scene), and which: the street's buttons step aside. */
  const [inside, setInside] = useState<"repair" | "meal" | "fuel" | "ward" | "roadside" | "hire" | "road" | "ticket" | "quiz" | "trial" | "vault" | "pump" | "service" | "flat" | null>(null);
  const [serviceOpen, setServiceOpen] = useState<ServiceOffer | null>(null);
  const [serviceActions, setServiceActions] = useState<ServiceActions | null>(null);
  const [pumpOpen, setPumpOpen] = useState<PumpOffer | null>(null);
  const [pumpActions, setPumpActions] = useState<PumpActions | null>(null);
  const [flatOpen, setFlatOpen] = useState<FlatOffer | null>(null); // a flat by the roadside
  const [pourOpen, setPourOpen] = useState<PourOffer | null>(null); // pouring the jerry can (a scene)
  const [pourActions, setPourActions] = useState<PourActions | null>(null);
  /** The lounge put away to look at the map (for that flight; a chip brings it back). */
  const [loungeHiddenFor, setLoungeHiddenFor] = useState<string | null>(null);
  const [flatActions, setFlatActions] = useState<FlatActions | null>(null);
  /** A landmark's guide or the Lamp's messenger, asking their question at the place on the map. */
  const [quizOpen, setQuizOpen] = useState<{ offer: QuizOffer; actions: QuizActions } | null>(null);
  /** Buying coins (tap your coins); `notice`: how a payment on Paystack's own page went. */
  /** Who asks the Key Trial at the key's place on the map. */
  const [trialKeeper, setTrialKeeper] = useState("The Keeper");
  const [coinShop, setCoinShop] = useState<{ notice: { text: string; good: boolean } | null } | null>(null);
  // Back from Paystack's own page (/play?paid=…): check the payment with Paystack through our server, then show it.
  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get("paid");
    if (!reference) return;
    const url = new URL(window.location.href);
    for (const k of ["paid", "reference", "trxref"]) url.searchParams.delete(k);
    window.history.replaceState(null, "", url.toString());
    void confirmPayment(reference).then((r) => {
      if (r.ok) setHud((h) => ({ ...h, coins: r.balance }));
      setCoinShop({ notice: r.ok ? { text: `+${r.coins.toLocaleString("en-NG")} coins! Thank you.`, good: true } : { text: r.message, good: false } });
    });
  }, []);
  const [ticketOpen, setTicketOpen] = useState<TicketOffer | null>(null);
  const [ticketActions, setTicketActions] = useState<TicketActions | null>(null);
  /** The scenes tell the place on the map what's happening (one function for good: their timers depend on it). */
  const onMoment = useCallback((m: SceneMoment) => actions.current?.sceneMoment(m), []);
  const [rentalActions, setRentalActions] = useState<RentalActions | null>(null);
  const [rentOpen, setRentOpen] = useState<RentalOffer | null>(null);
  /** The scenes at a petrol station, a place to eat, and on leaving hospital. */
  const [fuelActions, setFuelActions] = useState<FuelActions | null>(null);
  const [fuelOpen, setFuelOpen] = useState<FuelOffer | null>(null);
  const [mealActions, setMealActions] = useState<MealActions | null>(null);
  const [mealOpen, setMealOpen] = useState<MealOffer | null>(null);
  const [discharge, setDischarge] = useState<Discharge | null>(null);
  const [lampOpen, setLampOpen] = useState<{ quiz: LampQuestion | string | null } | null>(null);
  const [djinnActions, setDjinnActions] = useState<DjinnActions | null>(null);
  const [djinnOpen, setDjinnOpen] = useState<{ chamber: DjinnChamber | string | null } | null>(null);
  /** A whirlwind is carrying the player off (the chamber was failed). */
  const [whirlwind, setWhirlwind] = useState(false);
  /** A trap just sprang: a red flash. */
  const [trapFlash, setTrapFlash] = useState(false);
  /** The Masquerade's trap chest sprang: his lines, then dizzy a while (the time it ends). */
  const [trapStory, setTrapStory] = useState<{ lines: StoryLine[]; dizzyS: number } | null>(null);
  const [dizzyUntil, setDizzyUntil] = useState<number | null>(null);
  /** News of a Wonder (everyone hears of every use); `flash`: a Cataclysm hit you. */
  const [wonderBanner, setWonderBanner] = useState<{ n: number; icon: string; text: string; hit: boolean; flash: boolean } | null>(null);
  /** A strike on screen: the thunder flash, the bolt and the item spinning off (see strike() in the map's code). */
  const [strikeFx, setStrikeFx] = useState<{ n: number; icon: string } | null>(null);
  /** The Carpet of Kings is ready: asking where to fly. */
  const [carpetFor, setCarpetFor] = useState<string | null>(null);
  /** A key just won: it flies into the bag (the time it set off, so each one animates). */
  const [keyFly, setKeyFly] = useState<number | null>(null);
  /** Something on the road (a hunt): the officer, the traveller, the seller. */
  const [roadEvent, setRoadEvent] = useState<RoadEvent | null>(null);
  const [roadActions, setRoadActions] = useState<RoadEventActions | null>(null);
  /** "Enter the chamber" at the chosen place: ask for the rooms (once), then open the Djinn on them. */
  const enterChamber = async () => {
    if (!djinnActions || checkingIn) return;
    setCheckingIn(true);
    const chamber = await djinnActions.enterChamber();
    setCheckingIn(false);
    if (typeof chamber === "object") actions.current?.openVault(chamber); // the vault on the map (the panel as a sheet)
    setDjinnOpen({ chamber });
  };
  /** The Claim button at a Detour's place: the Lamp's messenger on the map (the lamp's panel if it can't be shown). */
  const claimDetour = async (detour: LampDetour) => {
    if (!lampActions || checkingIn) return;
    if (actions.current?.openQuizPlace("detour", detour.place, MESSENGER)) {
      const prize = detour.relic ? `the ${RELICS[detour.relic].name}` : `${detour.coins} coins`;
      setQuizOpen({
        offer: {
          host: { name: "Zuri, the Lamp's messenger", look: MESSENGER },
          title: detour.title,
          sign: detour.place,
          intro: `So, you followed the lamp. ${detour.story} Answer me right and ${prize} is yours. Ready?`,
        },
        actions: {
          start: async () => {
            const q = await lampActions.start(detour);
            if (typeof q === "string") return q;
            return { question: q.question, options: q.options, seconds: q.seconds, endsAt: q.endsAt };
          },
          answer: async (choice) => {
            const r = await lampActions.answer(detour.id, choice);
            if (typeof r === "string") return r;
            if (r.outcome === "won") return { good: true, line: `You got it! ${r.relic ? `The ${RELICS[r.relic].name} is yours: it's in your bag.` : `${r.coins} coins are yours.`}` };
            if (r.outcome === "full") return { good: false, line: "Ah, others got here first: it's all been claimed." };
            if (r.outcome === "late") return { good: false, line: `Too slow! The answer was ${r.answer}. The lamp moves on.` };
            return { good: false, line: `${local("No o", "No")}. It was ${r.answer}. The lamp moves on.` };
          },
        },
      });
      return;
    }
    setCheckingIn(true);
    const q = await lampActions.start(detour);
    setCheckingIn(false);
    setLampOpen({ quiz: q });
  };
  const [adviceOpen, setAdviceOpen] = useState(false);
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
      /**
       * On a phone the hunter rides low on the screen, two-thirds of the way down, so more of the road ahead shows
       * (owner, 28 Oct 2026: "we are too close to the front"); a laptop's screen is big enough to keep them centred.
       */
      const chasePad = () => ({ top: small ? Math.round(window.innerHeight * 0.34) : 0, bottom: 0, left: 0, right: 0 });
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
      // For the browser tests (development only): the map, to read what it draws.
      if (process.env.NODE_ENV !== "production") Object.assign(window, { __lootaMap: map });

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
      let landedUntil = 0; // while the server still allows the landing's long hop (save_position: 60 s)
      let roadless = 0; // since when no road has been near enough to stand on
      // For checking: whether the hunter's road is shut in (scripts/tests/airside-browser-test.mjs).
      if (process.env.NODE_ENV !== "production") {
        Object.assign(window, { __lootaRoad: () => (network && onRoad ? { pocket: roads.cutOffEdges(network)[onRoad.edge], ...traveller.pos } : null) });
      }

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
        // circles. The nearest proper road instead, when it's near enough for the server to allow. Shut in
        // behind a fence (an airport's airside: no public road at all), out to the street up to 800 m away.
        const pockets = roads.cutOffEdges(network);
        let reach = snapReachM;
        if (onRoad && pockets[onRoad.edge]) {
          reach = Math.max(snapReachM, pockets[onRoad.edge] === 2 ? 800 : 240);
          const main = roads.snapToNetwork(network, traveller.pos, facing, pockets);
          const m = main ? roads.positionOf(network, main) : null;
          if (main && m && geo.distanceM([traveller.pos.lng, traveller.pos.lat], [m.lng, m.lat]) <= reach) onRoad = main;
          else offerWayOut(true); // no road out near enough to step onto: offer the longer way out
        }
        const p = onRoad ? roads.positionOf(network, onRoad) : null;
        if (!onRoad || !p || geo.distanceM([traveller.pos.lng, traveller.pos.lat], [p.lng, p.lat]) > reach) {
          // Only far-away roads loaded so far (e.g. just thrown out of a trial): wait for nearer tiles. Still none
          // after a while (a field, a lagoon's edge): offer the way out.
          onRoad = null;
          roadless ||= performance.now();
          if (performance.now() - roadless > 8000) offerWayOut(true);
          return false;
        }
        roadless = 0;
        traveller.pos = { lng: p.lng, lat: p.lat };
        // Just landed and still airside (the town's roads not loaded yet): keep the landing's reach a little longer.
        if (!pockets[onRoad.edge] || performance.now() > landedUntil) snapReachM = 400;
        // Put onto a road some way from where the server last saw the hunter (thrown off any road, say): tell it so,
        // or it takes the jump for walking too fast and refuses every save after (owner, 25 Oct 2026).
        if (geo.distanceM([saved.lng, saved.lat], [p.lng, p.lat]) > 30) void placeOnRoad();
        return true;
      }

      /** The hunter was put onto the road: the server records the spot (up to 800 m, once every two minutes). */
      async function placeOnRoad() {
        if (saving) return;
        saving = true; // no ordinary save meanwhile: it would be refused and pull the hunter back off the road
        const at = { ...traveller.pos };
        const { data } = await supabase.rpc("place_on_road", { p_lng: at.lng, p_lat: at.lat });
        saving = false;
        const r = data as { ok: boolean; lng?: number; lat?: number } | null;
        if (r?.ok && r.lng != null && r.lat != null) saved = { lng: r.lng, lat: r.lat };
      }

      // ---- Stuck? "Get me out" (owner, 27 Oct 2026: "we need an everlasting solution") -----------------------------
      // Whatever the map's roads get wrong (a fence, an airfield, roads that don't join up), the hunter can always be put
      // on the nearest road that leads somewhere: offered when they're going nowhere, and always in the help panel.
      let stuckOfferOff = 0; // put away: not offered again until then
      let offeredAt: LngLat | null = null;
      const deadEnds: { t: number; lng: number; lat: number }[] = [];
      const progress: { t: number; lng: number; lat: number; walked: number }[] = []; // a sample a minute
      let walked = 0;
      let freeing = false;

      function offerWayOut(on: boolean) {
        if (!on) stuckOfferOff = performance.now() + 600_000;
        else if (performance.now() < stuckOfferOff) return;
        offeredAt = on ? { ...traveller.pos } : null;
        setHud((h) => (h.stuck === on ? h : { ...h, stuck: on }));
      }

      /** Turned back by a road's end: three within 3 minutes, all close together, is going nowhere. */
      function noteDeadEnd(now: number) {
        deadEnds.push({ t: now, ...traveller.pos });
        while (deadEnds.length && deadEnds[0].t < now - 180_000) deadEnds.shift();
        const near = deadEnds.every((d) => geo.distanceM([d.lng, d.lat], [traveller.pos.lng, traveller.pos.lat]) < 300);
        if (deadEnds.length >= 3 && near) offerWayOut(true);
      }

      /** Moving on the roads: 600 m and more in 8 minutes without ever getting 200 m from where it began is round in circles. */
      function noteProgress(now: number, metres: number) {
        walked += metres;
        if (offeredAt && geo.distanceM([offeredAt.lng, offeredAt.lat], [traveller.pos.lng, traveller.pos.lat]) > 400) {
          offeredAt = null; // found the way after all
          setHud((h) => (h.stuck ? { ...h, stuck: false } : h));
        }
        if (progress.length && now - progress[progress.length - 1].t < 60_000) return;
        progress.push({ t: now, ...traveller.pos, walked });
        if (progress.length > 9) progress.shift();
        const first = progress[0];
        const round = progress.length === 9 && walked - first.walked >= 600 && progress.every((s) => geo.distanceM([s.lng, s.lat], [first.lng, first.lat]) < 200);
        if (round) offerWayOut(true);
      }

      async function getOut() {
        if (freeing) return;
        if (ride) return say("Not while you're on a trip.", true);
        if (!network) return say("The roads are still loading: try again in a moment.", true);
        const out = roads.wayOut(network, traveller.pos, traveller.heading, onRoad);
        if (!out) {
          offerWayOut(false);
          return say("Your road does lead out: tap Directions, choose a place and follow the blue line.", true);
        }
        const p = roads.positionOf(network, out);
        const away = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [p.lng, p.lat]);
        if (away > 2000) return say("There's no road out within 2 km of here. Take a taxi or a plane from the transport button.", true);
        freeing = true;
        saving = true; // no ordinary save meanwhile: it would be refused as too fast a move
        const { data } = await supabase.rpc("free_me", { p_lng: p.lng, p_lat: p.lat });
        saving = false;
        freeing = false;
        const r = data as { ok: boolean; reason?: string; next?: string } | null;
        if (disposed) return;
        if (!r?.ok) {
          const mins = r?.next ? Math.max(1, Math.ceil((new Date(r.next).getTime() - Date.now()) / 60000)) : 10;
          return say(
            r?.reason === "wait"
              ? `You were helped out a moment ago. Try again in ${mins} min, or follow Directions.`
              : r?.reason === "today"
                ? "That's 3 times today already. Take a taxi from the transport button, or follow Directions."
              : r?.reason === "frozen"
                ? "The Hourglass holds you: wait for it to run out."
                : r?.reason === "dome"
                  ? "A Lockdown dome stands over the nearest road out. Wait for it to fall."
                  : "Couldn't get you out just now: try again.",
            true,
          );
        }
        traveller.pos = { lng: p.lng, lat: p.lat };
        traveller.v = 0;
        saved = { lng: p.lng, lat: p.lat };
        onRoad = out;
        deadEnds.length = 0;
        progress.length = 0;
        offeredAt = null;
        setHud((h) => ({ ...h, stuck: false }));
        lastNetworkCheck = 0; // the roads around the new spot
        say(away > 30 ? `Out you come: on a road that leads somewhere, ${geo.formatDistance(away)} from where you were.` : "You're on a road that leads somewhere.", true);
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
        // Very far, or outside the areas we host: the routing service. Never a straight line across the map (owner, 19 Oct
        // 2026: "a line drawn in the middle of nowhere" can't be travelled): no road route, no line; try again shortly.
        if (!route) ({ route, fallback } = await fetchRoute(traveller.pos, to, traveller.mode));
        if (disposed || id !== planId) return;
        if (fallback) {
          endDirections();
          say(`Couldn't find the way by road to ${name} just now. Trying again…`, true);
          const retry = planId;
          window.setTimeout(() => {
            if (!disposed && planId === retry) void planDirections(to, name, quiet);
          }, 15_000);
          return;
        }
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
          // Too far for the energy left on foot or by bicycle (a newcomer would faint halfway): say so, and what to do.
          const drain = movement.MODES[traveller.mode].drain;
          const reach = drain > 0 ? (traveller.energy / drain) * movement.baseSpeed(traveller.mode) : Infinity;
          const tooFar = !fallback && route.total > reach;
          say(
            fallback
              ? `Road directions are unavailable right now. The arrow points to ${name}; steer your own way there.`
              : `Directions to ${name}: ${geo.formatDistance(route.total)}, ${travelTime(route.total)} by ${
                  traveller.mode === "walk" ? "foot" : VEHICLES[traveller.mode].name.toLowerCase()
                }. Follow the blue line.${
                  tooFar
                    ? ` ⚠ Your energy lasts about ${geo.formatDistance(Math.round(reach / 100) * 100)} ${traveller.mode === "walk" ? "on foot" : "on a bicycle"}: take a taxi or bus (the bus button), ${traveller.mode === "walk" ? "get a bike, " : ""}or eat and rest on the way.`
                    : ""
                }`,
            tooFar,
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
      let saveAgain = false; // a forced save asked for while another was on its way
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
        stopped?: "fuel" | "broken" | "flat" | null;
      };
      /** `force`: save even without having moved (e.g. to have the server confirm a faint). */
      async function savePosition(force = false) {
        if (saving) {
          // One already on its way: a forced save (a faint to confirm) goes straight after it, never dropped.
          if (force) saveAgain = true;
          return;
        }
        if (!force && geo.distanceM([saved.lng, saved.lat], [traveller.pos.lng, traveller.pos.lat]) < 5) return;
        saving = true;
        const sent = { ...traveller.pos };
        const { data, error } = await supabase.rpc("save_position", { p_lng: sent.lng, p_lat: sent.lat, p_mode: traveller.mode });
        saving = false;
        if (saveAgain && !disposed) {
          saveAgain = false;
          void savePosition(true);
          return;
        }
        if (disposed || error || !data) return;
        const result = data as SaveResult;
        saved = { lng: result.lng, lat: result.lat };
        if (result.ok) {
          onSaved(result);
          return;
        }
        if (traveller.phase === "fainted" && result.reason !== "fainted" && result.reason !== "hospital") {
          // Collapsed, but the save wasn't taken (moved too fast for it, say): the collapse still stands.
          void confirmCollapse();
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
        /**
         * Parked at the roadside at lng/lat (not in the pocket): out of fuel until a jerry can is poured in, or (a motorbike
         * or car with tyre 0) with a flat until it's changed.
         */
        stranded_at: string | null;
        lng: number;
        lat: number;
        in_use: boolean;
        light: boolean;
        helmet: boolean;
        registered: boolean;
        insured: boolean;
        /** A jack and spare: change a flat yourself (owner, 22 Oct 2026). */
        jack: boolean;
      };
      let owned: VehicleRow[] = [];
      let vehiclesLoaded = false; // owned is filled in (refreshVehicles)
      let licences = { rider: false, driver: false };
      let rental: { kind: VehicleKind; startedAt: number; rate: number } | null = null;
      let busy = false;

      const setBusy = (value: boolean) => {
        busy = value;
        setHud((h) => ({ ...h, busy: value }));
      };
      const vehicleName = (kind: VehicleKind) => VEHICLES[kind].name.toLowerCase();
      const ownInUse = () => owned.find((v) => v.in_use) ?? null;
      /** A motorbike or car with a flat (it stands at the roadside until the tyre is changed). */
      const isFlat = (v: VehicleRow) => v.kind !== "bicycle" && v.tyre <= 0;
      /** A motorbike or car that ran dry and stands at the roadside where it stopped (not one waiting only for a new tyre). */
      const strandedVehicle = () => owned.find((v) => !!v.stranded_at && !(isFlat(v) && v.fuel > 0)) ?? null;
      /** One standing at the roadside with a flat. */
      const flatVehicle = () => owned.find((v) => !!v.stranded_at && isFlat(v)) ?? null;
      const metresTo = (p: LngLat) => geo.distanceM([traveller.pos.lng, traveller.pos.lat], [p.lng, p.lat]);
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
      let darkFactor = 1; // your own bicycle after dark without a light (darkTick)
      let sandFactor = 1; // in someone's sandstorm (the Sandstorm Crown): half speed, whatever you ride
      function applySpeed() {
        traveller.speedFactor =
          vehicleFactor * sandFactor * darkFactor * (traveller.mode === "walk" || traveller.mode === "bicycle" ? weatherFactor : trafficSpeed);
      }
      // After dark, your own bicycle without a light: you crawl (you can't see the road). Rentals come with a light.
      let lastDark = -Infinity;
      function darkTick(now: number) {
        if (now - lastDark < 2000) return;
        lastDark = now;
        const bike = traveller.mode === "bicycle" && !rental ? ownInUse() : null;
        const blind = !!bike && !bike.light && isNight(Date.now(), traveller.pos.lng, traveller.pos.lat);
        const factor = blind ? 0.6 : 1;
        if (factor === darkFactor) return;
        darkFactor = factor;
        applySpeed();
        if (blind) say("It's dark and your bicycle has no light: you ride slowly, and the police may stop you. Buy a light in the vehicle panel.", true);
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
        const [{ data: vehicles }, { data: rentals }, { data: papers }] = await Promise.all([
          supabase.from("player_vehicles").select("kind, fuel, tyre, engine, broken_at, repair_ready_at, stranded_at, lng, lat, in_use, light, helmet, registered, insured, jack"),
          supabase.from("vehicle_rentals").select("kind, started_at").is("ended_at", null),
          supabase.from("profiles").select("rider_licence, driver_licence").maybeSingle(),
        ]);
        if (disposed) return;
        owned = (vehicles ?? []) as VehicleRow[];
        vehiclesLoaded = true;
        const p = papers as { rider_licence: boolean; driver_licence: boolean } | null;
        licences = { rider: !!p?.rider_licence, driver: !!p?.driver_licence };
        const active = rentals?.[0] as { kind: VehicleKind; started_at: string } | undefined;
        rental = active ? { kind: active.kind, startedAt: new Date(active.started_at).getTime(), rate: VEHICLES[active.kind].ratePerMinute } : null;
        showVehicle();
        showParked();
      }

      // ---- Out of fuel: the vehicle stays parked at the roadside where it ran dry (owner, 19 Oct 2026) ----
      // On the map by the kerb (the right-hand side of the road), with a tag, until a jerry can is poured in.
      const parked = new Map<VehicleKind, { at: string; onRoad: boolean; entity: import("@/game/ThreeMapLayer").MapEntity }>();
      let lastParked = 0;
      function showParked() {
        const want = owned.filter((v) => v.stranded_at);
        for (const [kind, p] of parked) {
          const v = want.find((w) => w.kind === kind);
          if (!v || `${v.lng},${v.lat}` !== p.at || (!p.onRoad && network)) {
            layer.remove(p.entity);
            parked.delete(kind);
          }
        }
        for (const v of want) {
          if (parked.has(v.kind)) continue;
          const object = models.makeVehicleModel(v.kind);
          const tag = layer.billboard(models.makeNameplate(isFlat(v) ? "FLAT TYRE" : "NO FUEL", "#B23A3A"));
          tag.position.y = v.kind === "car" ? 2.6 : 2.2;
          object.add(tag);
          let at = { lng: v.lng, lat: v.lat };
          let heading = 0;
          const near = network ? roads.snapToNetwork(network, at, 0) : null;
          const p = near && network ? roads.positionOf(network, near) : null;
          if (p && geo.distanceM([p.lng, p.lat], [v.lng, v.lat]) < 60) {
            // By the kerb on the right, facing along the road.
            const right = { e: -Math.cos(p.heading), n: -Math.sin(p.heading) };
            const off = (v.kind === "car" ? 2.2 : 1.6) * layer.enlargement(); // models are drawn enlarged: so is the kerb
            at = { lng: p.lng + (right.e * off) / (111320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat + (right.n * off) / 110574 };
            heading = p.heading;
          }
          parked.set(v.kind, { at: `${v.lng},${v.lat}`, onRoad: !!p, entity: layer.add({ object, lng: at.lng, lat: at.lat, heading }) });
        }
      }
      function parkedTick(now: number) {
        if (now - lastParked < 2000) return;
        lastParked = now;
        if ([...parked.values()].some((p) => !p.onRoad) && network) showParked(); // placed before the roads had loaded
      }

      // While a vehicle stands at the roadside and the player is on foot, the way is always drawn (also after a reload): to
      // the nearest petrol station while the jerry can is empty, back to the vehicle once it has fuel. Ending the
      // directions or dismissing the advice turns it off for 5 minutes.
      let strandGuideOff = 0;
      let nextStrandGuide = 0;
      function strandGuideTick(now: number) {
        if (now < nextStrandGuide) return;
        nextStrandGuide = now + 3000;
        const s = strandedVehicle();
        if (!s || trip || inWorld || ride || visit || now < strandGuideOff || traveller.mode !== "walk" || busy || !onRoad) return;
        if (fuelInHand()) {
          if (metresTo(s) <= 25) return; // there: pour it in
          nextStrandGuide = now + 20000; // one try every 20 s if no road route is found
          adviseCarryBack();
        } else if (!spotHere(["fuel"])) {
          nextStrandGuide = now + 20000;
          adviseFuelWalk(vehicleName(s.kind));
        }
      }
      // Where the player was going when the tank ran dry: set aside while they fetch fuel (kept across a reload), and
      // taken up again once the jerry can is poured in (owner, 19 Oct 2026: "my old route… is gone").
      const GOING_KEY = "loota:going-before-dry";
      let goingBeforeDry: { lng: number; lat: number; name: string } | null = null;
      try {
        goingBeforeDry = JSON.parse(localStorage.getItem(GOING_KEY) ?? "null") as typeof goingBeforeDry;
      } catch {
        goingBeforeDry = null;
      }
      function setGoing(to: typeof goingBeforeDry) {
        goingBeforeDry = to;
        try {
          if (to) localStorage.setItem(GOING_KEY, JSON.stringify(to));
          else localStorage.removeItem(GOING_KEY);
        } catch {
          // Private browsing: kept for this visit only.
        }
      }
      /** Back on the road after the jerry can: the journey's step, or the place the player was heading for. */
      function resumeGoing(): string | null {
        const to = goingBeforeDry;
        setGoing(null);
        endDirections();
        if (journey) {
          // The journey's current step, quietly (the pour message says where to).
          const leg = journey.journey.legs[journey.step];
          if (leg?.kind === "go") void planDirections({ lng: leg.to.lng, lat: leg.to.lat }, leg.to.name, true);
          showJourney();
          return journey.journey.place.name;
        }
        if (to) {
          void planDirections({ lng: to.lng, lat: to.lat }, to.name, true);
          return to.name;
        }
        return null;
      }

      /** On foot from a dry tank: to the nearest petrol station, by road, with (or for) a jerry can. */
      function adviseFuelWalk(name: string, first = false) {
        void advise(
          "fuel",
          first ? "Out of fuel" : `Fuel for your ${name}`,
          `${first ? "Out of fuel! " : ""}Your ${name} is parked at the roadside. Walk to a petrol station ${
            keg ? "with your jerry can" : "(they sell jerry cans)"
          }, fill it, carry it back and pour it in: a jerry can takes the tank to ${KEG_CAPACITY}%.`,
          ["fuel"],
          Infinity,
          undefined,
          true,
        ).then(() => {
          if (advicePlace && adviceKey === "fuel" && !trip) void planDirections({ lng: advicePlace.lng, lat: advicePlace.lat }, advicePlace.name, true);
        });
      }

      /** After filling a jerry can (or with one already full): the way back to the vehicle at the roadside. */
      function adviseCarryBack() {
        const s = strandedVehicle();
        if (!s || !fuelInHand()) return;
        const name = vehicleName(s.kind);
        const away = metresTo(s);
        adviceKey = "fuel";
        advicePlace = { name: `your ${name}`, lng: s.lng, lat: s.lat };
        const text = `Carry the ${keg && keg.fuel > 0 ? "jerry can" : "Jerry Can relic"} back to your ${name}, ${geo.formatDistance(away)} away, and pour it in (the gold button there).`;
        setHud((h) => ({ ...h, advice: { key: "fuel", title: "Carry the fuel back", text, where: `Your ${name} · ${geo.formatDistance(away)}`, place: advicePlace } }));
        say(text, true);
        void planDirections({ lng: s.lng, lat: s.lat }, `your ${name}`, true);
      }

      function afterModeChange() {
        buildRoads(); // cars keep off footpaths, bikes off steps
        if (trip) void planDirections(trip.to, trip.name, true); // and may need a different way there
      }

      /** Ride your own, rent, or buy. Resolves to "ok", or why not (the server's reason, "busy", "walk"…). */
      /** Whether a vehicle has this piece of gear or papers (licences are the player's). */
      function hasPaper(v: VehicleRow, id: AddonId) {
        if (id === "rider_licence") return licences.rider;
        if (id === "driver_licence") return licences.driver;
        return id === "light" ? v.light : id === "helmet" ? v.helmet : id === "registration" ? v.registered : id === "jack" ? v.jack : v.insured;
      }

      /** Buy a vehicle's gear or a licence (buy_addon). */
      async function buyAddon(kind: VehicleKind, id: AddonId, quiet = false) {
        const { data } = await supabase.rpc("buy_addon", { p_addon: id, p_kind: kind });
        const r = data as { ok: boolean; reason?: string; price?: number; balance?: number } | null;
        const name = ADDONS[kind].find((a) => a.id === id)?.name ?? id;
        if (r?.ok) {
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          if (!quiet) say(`${name} bought for your ${vehicleName(kind)}.`);
        } else if (!quiet || r?.reason === "coins") {
          say(r?.reason === "coins" ? `Not enough coins for the ${name.toLowerCase()} (${r.price} coins).` : `Couldn't buy the ${name.toLowerCase()} just now.`, true);
        }
        await refreshVehicles();
        lastDark = -Infinity; // a light changes riding after dark
      }

      async function chooseVehicle(kind: VehicleKind, how: "own" | "rent" | "buy", addons: AddonId[] = []): Promise<string> {
        if (busy || traveller.phase !== "idle") return "busy";
        if (how === "rent") {
          if (kind === "car") {
            setTransitOpen(true); // cars come as taxis
            return "taxi";
          }
          // Rent only where the renter is waiting; until then, ask for one.
          const waiting = pickup && pickup.p.kind === kind;
          if (!waiting) {
            await requestBikePickup(kind);
            return "asked";
          }
          if (geo.distanceM([traveller.pos.lng, traveller.pos.lat], [pickup!.p.lng, pickup!.p.lat]) > PICKUP_AT_M) {
            say(`Walk to the renter at ${pickup!.p.name} first (the blue line).`, true);
            return "walk";
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
              return bought?.reason ?? "error";
            }
            const balance = bought.balance;
            if (balance != null) setHud((h) => ({ ...h, coins: balance }));
            await refreshVehicles();
            // Its gear and papers, ticked with it.
            for (const id of addons) await buyAddon(kind, id, true);
            const missing = ADDONS[kind].filter((a) => !addons.includes(a.id) && !NOT_PAPERS.includes(a.id)).map((a) => a.name.toLowerCase());
            if (missing.length) say(`No ${missing.join(" or ")} yet: police checkpoints fine what's missing. Get them in the vehicle panel.`, true);
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
            else if (started?.reason === "flat")
              say(`Your ${vehicleName(kind)} has a flat and stands at the roadside. Go to it and change the tyre (🛞 Fix flat): free with your jack, or a roadside mechanic does it for ${FLAT_FIX_PRICE} coins.`, true);
            else if (started?.reason === "stranded")
              say(`Your ${vehicleName(kind)} is parked at the roadside with an empty tank. Bring it fuel in a jerry can from a petrol station (🧭 in Vehicles shows the way).`, true);
            else if (started?.reason === "fuel")
              say(`Your ${vehicleName(kind)}'s tank is empty. Any petrol station fills it while it's in your pocket, or pour in a jerry can.`, true);
            else if (started?.reason === "far_pickup") say("Walk to the renter first: they're waiting at the bus stop.", true);
            else if (started?.reason === "pickup") say(`Ask for a ${vehicleName(kind)} first (Rent in Vehicles): a renter brings one to a bus stop near you.`, true);
            else if (started?.reason === "taxi") say("Cars come as taxis: call one from Taxi, bus, train or plane.", true);
            else if (started?.reason === "broken") say(`Your ${vehicleName(kind)} has broken down. Call a mechanic (the gold 🔧 button, or in Vehicles): they come to you.`, true);
            else if (started?.reason === "repairing") say(`The mechanic is still working on your ${vehicleName(kind)}. Try again in a moment.`, true);
            else say("Couldn't get on. Please try again.", true);
            afterModeChange();
            return started?.reason ?? "error";
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
          return "ok";
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

      async function refuelHere(quiet = false): Promise<{ ok: true; cost: number; fuel: number } | { ok: false; reason: string }> {
        if (busy) return { ok: false, reason: "busy" };
        setBusy(true);
        try {
          const { data } = await supabase.rpc("refuel");
          const r = data as { ok: boolean; reason?: string; fuel?: number; cost?: number; balance?: number } | null;
          if (!r?.ok) {
            if (!quiet) say(r?.reason === "full" ? "Your tank is already full." : r?.reason === "coins" ? "Not enough coins for fuel." : "Couldn't refuel here.", true);
            return { ok: false, reason: r?.reason ?? "error" };
          }
          await refreshVehicles(); // the one ridden, or one in the pocket, was filled
          warned.fuel = 100;
          clearAdvice("fuel");
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          if (!quiet) say(`Filled up for ${r.cost} coins.`);
          return { ok: true, cost: r.cost ?? 0, fuel: r.fuel ?? 100 };
        } finally {
          setBusy(false);
          computeActions();
        }
      }

      /** Fill the jerry can at the petrol station (FuelScene): as far as the coins go, up to KEG_CAPACITY. */
      async function fillKegHere(): Promise<{ ok: true; cost: number; fuel: number } | { ok: false; reason: string }> {
        await savePosition(); // the server checks the player is at the station
        const { data } = await supabase.rpc("fill_keg");
        const r = data as { ok: boolean; reason?: string; fuel?: number; cost?: number; balance?: number } | null;
        if (disposed) return { ok: false, reason: "gone" };
        if (!r?.ok) return { ok: false, reason: r?.reason ?? "error" };
        keg = { fuel: r.fuel ?? KEG_CAPACITY, usesLeft: keg?.usesLeft ?? 50 };
        showKeg();
        const balance = r.balance;
        if (balance != null) setHud((h) => ({ ...h, coins: balance }));
        computeActions();
        return { ok: true, cost: r.cost ?? 0, fuel: r.fuel ?? KEG_CAPACITY };
      }

      async function eatHere(place: string, quiet = false): Promise<{ ok: true; energy: number } | { ok: false; reason: string }> {
        if (busy) return { ok: false, reason: "busy" };
        setBusy(true);
        try {
          const { data } = await supabase.rpc("buy_meal");
          const r = data as { ok: boolean; reason?: string; energy?: number; now?: number; balance?: number } | null;
          if (!r?.ok) {
            if (!quiet) say(r?.reason === "not_here" ? "Meals are sold at places to eat." : `A meal costs ${MEAL_PRICE} coins. Rest at a chill spot for free instead.`, true);
            return { ok: false, reason: r?.reason ?? "error" };
          }
          traveller.energy = r.now ?? Math.min(100, traveller.energy + (r.energy ?? MEAL_ENERGY));
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          if (!quiet) say(`You ate at ${place}: +${r.energy ?? MEAL_ENERGY} energy.`);
          return { ok: true, energy: r.energy ?? MEAL_ENERGY };
        } finally {
          setBusy(false);
          computeActions();
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
        | { ok: true; kind: "coins" | "cache"; coins: number; balance: number; freeRoam?: boolean } // half, outside a hunt
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
          const half = result.freeRoam ? " (free roam: half, full in a hunt)" : "";
          say(result.kind === "cache" ? `You found a hidden coin cache! +${result.coins} coins${half}.` : `+${result.coins} coins${half}`);
          cue("coin");
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

      // Relics count for the bag button (relics with uses left); a Jerry Can relic and tyre kits, for the buttons here.
      let jerryRelicId: string | null = null;
      let fastPassRelicId: string | null = null; // one to use while waiting at a stop (the trip banner's button)
      let tyreKits = 0;
      function countRelics() {
        void supabase
          .from("player_relics")
          .select("id, relic, expires_at")
          .gt("charges", 0)
          .then(({ data }) => {
            if (disposed || !data) return;
            const now = Date.now();
            const live = data.filter((r) => new Date(r.expires_at).getTime() > now);
            jerryRelicId = live.find((r) => r.relic === "jerry_can")?.id ?? null;
            fastPassRelicId = live.find((r) => r.relic === "fast_pass")?.id ?? null;
            setHud((h) => ({ ...h, relics: live.length }));
            computeActions();
          });
        void supabase
          .from("player_items")
          .select("item, qty")
          .then(({ data }) => {
            if (disposed || !data) return;
            tyreKits = data.find((i) => i.item === "tyre_kit")?.qty ?? 0;
            setHud((h) => (h.tyreKits === tyreKits ? h : { ...h, tyreKits }));
            computeActions();
          });
      }
      /** Fuel to carry to a vehicle at the roadside: a jerry can with fuel in it, or a Jerry Can relic. */
      const fuelInHand = () => (!!keg && keg.fuel > 0) || !!jerryRelicId;
      async function applyItem(item: "tyre_kit"): Promise<string> {
        const { data } = await supabase.rpc("use_item", { p_item: item });
        const r = data as { ok: boolean; reason?: string; flat?: boolean; left?: number } | null;
        if (disposed) return "";
        countRelics();
        if (!r?.ok)
          return r?.reason === "full" ? "Your tyres are fine: keep the kit for a flat." : r?.reason === "no_vehicle" ? "The tyre kit is for your bicycle." : "No tyre kit left.";
        await refreshVehicles();
        warned.tyre = 100;
        clearAdvice("tyre");
        return r.flat ? "Flat patched and pumped with your tyre kit: good as new." : "Tyres pumped with your tyre kit.";
      }
      countRelics();

      // ---- Player actions --------------------------------------------------
      actions.current = {
        vehicles: () =>
          owned.map((v) => ({
            kind: v.kind,
            fuel: v.fuel,
            inUse: v.in_use,
            state: v.stranded_at
              ? isFlat(v)
                ? "flat"
                : "stranded"
              : v.broken_at
                ? v.repair_ready_at
                  ? "repairing"
                  : "broken"
                : v.kind !== "bicycle" && v.fuel <= 0
                  ? "empty"
                  : "ready",
            away: v.stranded_at ? Math.round(metresTo(v)) : null,
            papers: ADDONS[v.kind].map((a) => ({ ...a, have: hasPaper(v, a.id) })),
          })),
        ride: (kind, how, addons) => void chooseVehicle(kind, how, addons),
        buyAddon: (kind, id) => buyAddon(kind, id),
        findRepairShop: (kind) => void findRepairShop(kind, true),
        wayToParked: (kind) => {
          const v = owned.find((o) => o.kind === kind && o.stranded_at);
          if (v) void planDirections({ lng: v.lng, lat: v.lat }, `your ${vehicleName(kind)}`);
        },
        enterShop: (job) => openShopScene(job),
        enterTicket: () => enterTicket(),
        openVault: (chamber) => openVault(chamber),
        openQuizPlace: (kind, name, host) => openQuizPlace(kind, name, host),
        leaveShop: () => closePlace(),
        sceneMoment: (m) => sceneMoment(m),
        getOff: () => void getOff(),
        getOut: () => void getOut(),
        notStuck: () => offerWayOut(false),
        refuel: () => void refuelHere(),
        eat() {
          void act("eat");
        },
        useRelic: (id) => useRelic(id),
        useItem: (item) => applyItem(item),
        useWonder: (id, to) => useWonder(id, to),
        attackDome: () => void attackDome(),
        toggleCruise: () => toggleCruise(),
        endHold: () => {
          sceneHold = false;
          computeActions();
        },
        buyCruise: () => buyCruise(),
        springTrap: () => void springTrap(),
        dizzy(seconds) {
          stuckUntil = performance.now() + seconds * 1000;
          traveller.v = 0;
          setDizzyUntil(Date.now() + seconds * 1000);
          window.setTimeout(() => setDizzyUntil(null), seconds * 1000);
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
        endDirections: () => {
          endDirections();
          strandGuideOff = performance.now() + 300_000; // the player chose to go their own way
        },
        follow() {
          lookOffset = 0;
        },
        where: () => ({ ...traveller.pos }),
        cancelTrip: () => void cancelTrip(),
        fastPass: () => {
          if (fastPassRelicId) void spendRelic(fastPassRelicId).then((said) => say(said));
        },
        rushAnswer: (choice) => rushAnswer(choice),
        act: (id) => void act(id),
        followAdvice: () => {
          const place = advicePlace;
          if (place) void planDirections({ lng: place.lng, lat: place.lat }, place.name);
        },
        pickupAction: () => void pickupAction(),
        cancelPickup: () => void cancelPickup(),
        dismissAdvice: () => {
          if (adviceKey === "fuel") strandGuideOff = performance.now() + 300_000;
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
      let huntHold = false; // standing still until the riddle's place is named (the riddle clock)
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
        pointer(lng, lat) {
          const here: [number, number] = [traveller.pos.lng, traveller.pos.lat];
          return {
            bearing: Math.round(geo.compassFromHeading(geo.headingOf(here, [lng, lat])) - map.getBearing()),
            metres: Math.round(geo.distanceM(here, [lng, lat])),
          };
        },
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
        setHold(value) {
          huntHold = value;
          if (value) traveller.v = 0;
        },
        goTo: (place) => actions.current?.goTo(place),
        where: () => ({ ...traveller.pos }),
        say,
      };

      // Look around: drag sideways to turn the view around the hunter, up or
      // down to tilt it. Moving off brings the view
      // back behind the hunter. A short tap gives directions to that spot.
      //
      // On touch screens the lower part of the screen steers instead: press and
      // hold to walk, swipe left or right to turn, swipe down to turn back. And a
      // sideways swipe anywhere on the map turns too (owner, 26 Oct 2026: "On
      // mobile we should be able to swipe left and right to make turns"); up or
      // down in the upper part still tilts the view.
      const pointers = new Set<number>();
      let drag: { x: number; y: number; offset: number; pitch: number; moved: boolean; touch: boolean; swipe: "turn" | "tilt" | null } | null = null;
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
        drag = { x: e.clientX, y: e.clientY, offset: lookOffset, pitch: map.getPitch(), moved: false, touch: e.pointerType === "touch", swipe: null };
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
        if (drag.touch) {
          // A finger: sideways is a turn (once per swipe), up or down tilts the view.
          if (!drag.swipe && Math.hypot(dx, dy) >= 12) drag.swipe = Math.abs(dx) > Math.abs(dy) ? "turn" : "tilt";
          if (drag.swipe === "turn") {
            if (Math.abs(dx) > 45) {
              actions.current?.turn(dx > 0 ? 1 : -1);
              drag.swipe = "tilt"; // done: the rest of this swipe only tilts
              drag.x = e.clientX;
              drag.y = e.clientY;
              drag.pitch = map.getPitch();
            }
            return;
          }
          if (drag.swipe === "tilt") {
            dragging = true;
            map.setPitch(Math.max(25, Math.min(70, drag.pitch - dy * 0.2)));
          }
          return;
        }
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

      const spendRelic = useRelic; // the same, by a plain name ("use…" reads as a React hook to the linter)
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
              not_yet: "Use a Fast Pass while you're waiting for a bus, train, taxi or flight: book the ride (the bus button), then use it to skip the wait.",
              already: "This trip already has a Fast Pass on it.",
              no_vehicle: "Jerry Can fills your own motorbike or car. Get on it first (Vehicles), then use the can.",
              far: "Walk to your vehicle at the roadside first (the way is drawn), then use the Jerry Can beside it.",
              full: "Your tank has 65% or more: a jerry can won't fill it further. Keep it for when it runs dry.",
              gone: "That relic has no uses left.",
              position: "Move a little first, then try again.",
              no_hunt: "The Lockdown Orb works during a live hunt you've joined: it locks the area of your current key.",
              final_key: "The Lockdown Orb can't be used on a hunt's final key.",
              dome_up: "A dome is already up in this hunt. Only one at a time.",
            }[r.reason ?? ""] ?? "Couldn't use that relic."
          );
        }
        if (r.relic === "lockdown_orb" || r.relic === "rain_charm") strike(RELIC_ICON[r.relic], RELICS[r.relic].colour, true); // it reaches others
        if (r.relic === "lockdown_orb") {
          lastDomes = 0;
          return "Dome raised over your key area for 20 minutes! Hunters outside can't get in unless enough of them attack it together. The Orb now hides somewhere new.";
        }
        if (r.relic === "second_wind") {
          traveller.energy = Math.min(100, traveller.energy + (r.energy ?? 50));
          return "Second Wind: +50 energy.";
        }
        if (r.relic === "jerry_can" && r.fuel != null) {
          const kind = (r as { kind?: VehicleKind }).kind;
          if ((r as { remounted?: boolean }).remounted && kind) {
            // Back on the vehicle that stood at the roadside, and on the way you were going.
            traveller.mode = kind;
            saved = { ...traveller.pos };
            await refreshVehicles();
            afterModeChange();
            clearAdvice("fuel");
            warned.fuel = 100;
            const onTo = resumeGoing();
            return `Jerry Can poured: your ${vehicleName(kind)} has ${Math.round(r.fuel)}% fuel, and you're back on it${onTo ? `. On to ${onTo}` : ""}.`;
          }
          onFuel(r.fuel);
          return `Jerry Can: your tank is at ${Math.round(r.fuel)}%.`;
        }
        if (r.relic === "fast_pass") {
          // Used while waiting (owner, 26 Oct 2026): the trip leaves sooner, and a crowded bus's scramble is skipped.
          const trip = (r as { trip?: TransitTrip }).trip;
          if (trip && ride && ride.trip.id === trip.id) {
            ride.trip = trip;
            ride.offset = Date.parse(trip.now) - Date.now();
            ride.departs = Date.parse(trip.departsAt);
            ride.arrives = Date.parse(trip.arrivesAt);
            ride.way = null;
            clearCrowd();
            rush = null;
            busLeftAt = 0;
            setHud((h) => (h.rush ? { ...h, rush: null } : h));
            if ((trip.mode === "bus" && trip.metres <= BUS_RANGE_M) || trip.mode === "taxi") void planRideWay(ride);
          }
          if (trip?.mode === "plane") return "Fast Pass: straight past the check-in queue. You board sooner.";
          return `Fast Pass: no waiting. Your ${trip ? TRANSIT[trip.mode].label.toLowerCase() : "ride"} is here: off you go.`;
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

      let effectsReady = false;
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
        const effectsChecked = effectsReady; // rain already falling when the game opened is no news
        effectsReady = true;
        for (const e of rain) {
          if (effectsSeen.has(e.id)) continue;
          effectsSeen.add(e.id);
          if (!e.mine && effectsChecked) strike(RELIC_ICON.rain_charm, RELICS.rain_charm.colour, false);
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

      let domesReady = false; // domes already up when the game opened are no news
      async function refreshDomes() {
        const { data } = await supabase.rpc("domes_near");
        const list = (data ?? []) as Omit<Dome, "entity">[];
        if (disposed) return;
        const wasReady = domesReady;
        domesReady = true;
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
          if (!known && !d.mine && wasReady) strike(RELIC_ICON.lockdown_orb, RELICS.lockdown_orb.colour, false);
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
        way: { stops: WayStop[]; plan: RideSchedule } | null; // a bus's stops, and the jams and red lights on the way (bus or taxi), once loaded
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
      // The rush for a crowded bus: the people waiting at the stop, and the questions under way.
      type CrowdMember = {
        entity: import("@/game/ThreeMapLayer").MapEntity;
        avatar: ReturnType<typeof models.buildAvatar>;
        spot: LngLat;
        door: LngLat;
        walk: number | null; // performance ms: squeezing onto the bus from then
      };
      type Rush = {
        id: number;
        questions: { q: string; choices: number[] }[];
        answers: number[]; // the choice's place, or -1 (too slow)
        marks: ("right" | "wrong" | "late" | "done")[];
        asked: number; // performance ms the current question was asked
        sending: boolean;
        outcome: NonNullable<Hud["rush"]>["outcome"];
        outcomeAt: number;
      };
      const RUSH_PER_S = 6;
      let crowd: CrowdMember[] = [];
      let rush: Rush | null = null;
      let lastRushTry = 0;
      let busLeftAt = 0; // performance ms: a full bus pulling off without the player
      let lastRushHud = "";
      const TRAIN_SCALE = 0.8;
      // A phone's narrow screen: the plane smaller, or it fills the view (owner, 28 Oct 2026: "the plane is too big on
      // mobile"; then, at 0.3 and 0.75, "too small"): halfway.
      const PLANE_GROUND_SCALE = small ? 0.38 : 0.45; // at the gate and on the runway, next to the hunter
      const PLANE_AIR_SCALE = small ? 1.05 : 1.4; // at cruising height, seen from far above

      function showRide(status: string, canCancel: boolean) {
        if (!ride) return;
        const info = TRANSIT[ride.trip.mode];
        const title = `${info.label} ${ride.trip.mode === "bus" ? "towards" : "to"} ${ride.label}`;
        const pass = canCancel && !!fastPassRelicId && !ride.trip.fastPass; // still waiting, and a Fast Pass in the bag
        // The distance left, counting down once moving (owner, 28 Oct 2026: "add the km countdown in the icon for travel").
        const metres = ride.s > 0 ? Math.max(0, ride.cum[ride.cum.length - 1] - ride.s) : null;
        const toGo =
          metres === null ? null : metres >= 10_000 ? `${Math.round(metres / 1000)} km` : metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 50) * 50} m`;
        const to = ride.label;
        setHud((h) =>
          h.ride?.status === status && h.ride.canCancel === canCancel && h.ride.pass === pass && h.ride.title === title && h.ride.toGo === toGo && h.ride.to === to
            ? h
            : { ...h, ride: { icon: info.icon, title, status, canCancel, pass, toGo, to } },
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
        if ((next.mode === "bus" && next.metres <= BUS_RANGE_M) || next.mode === "taxi") void planRideWay(ride); // long-distance buses run express
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

      /**
       * A city bus's stops within 30 m of its path (not the first or last 150 m), in order; then for a bus or a
       * taxi, how it spends the ride: crawling through jams, waiting at stops and red lights.
       */
      async function planRideWay(r: Ride) {
        if (r.trip.mode === "taxi") {
          const plan = await trafficPlan(r, []);
          if (!disposed && ride === r) r.way = { stops: [], plan };
          return;
        }
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
        const plan = await trafficPlan(r, stops);
        if (disposed || ride !== r) return;
        for (const h of plan.holds) if (h.kind === "stop") stops[h.ref].at = h.at;
        r.way = { stops, plan };
      }

      /** The jams (as the map draws them) and the traffic lights along a ride, and the timings they make. */
      async function trafficPlan(r: Ride, stops: WayStop[]) {
        const path = r.trip.path as [number, number][];
        const keys = [...new Set(path.map(([lng, lat]) => roadCellKey(Math.floor(lng / ROAD_CELL_DEG), Math.floor(lat / ROAD_CELL_DEG))))];
        await Promise.all(keys.map((k) => ensureSquare(k)));
        const cells = keys.map((k) => roadSquares.get(k)).filter((c): c is RoadCellData => typeof c === "object");
        const total = r.cum[r.cum.length - 1] || 1;
        const rideMs = r.arrives - r.departs;
        const leaves = r.departs - r.offset; // on this device's clock, which the lights and jams follow
        const jams = jamsAlongPath(cells, path, r.cum, (s) => leaves + (s / total) * rideMs);
        const lights = signalsOnPath(await loadSignals(), path, r.cum).map((x) => ({ s: x.s, id: x.signal.group }));
        return planRide(r.cum, jams, stops.map((st) => ({ s: st.s, dwell: st.dwell })), lights, waitForGreen, leaves, rideMs);
      }

      /** Where the bus or taxi is `elapsed` ms after leaving: the stop or red light it's at, the next stop, the jam it's in. */
      function busAt(r: Ride, elapsed: number): { s: number; at: WayStop | null; next: WayStop | null; light: Hold | null; jam: number } {
        const way = r.way!;
        const p = rideAt(way.plan, r.cum, elapsed);
        const stop = (h: Hold | null) => (h?.kind === "stop" ? way.stops[h.ref] : null);
        return { s: p.s, at: stop(p.at), next: stop(p.nextStop), light: p.at?.kind === "signal" ? p.at : null, jam: p.jam };
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
        clearCrowd();
        rush = null;
        busLeftAt = 0;
        setHud((h) => (h.rush ? { ...h, rush: null } : h));
        ride = null;
        lampStale = true; // the lamp rested on the way: it looks around where you got off
        setHud((h) => (h.lounge ? { ...h, lounge: null } : h));
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
        rushTick(now);
        const rushing = r.trip.mode === "bus" && r.trip.rush === "pending";
        if (serverNow < r.departs || rushing) {
          // Waiting at the stop (or checking in). The bus or train pulls in for the last few seconds; the plane waits at the gate.
          const left = (r.departs - serverNow) / 1000;
          if (rushing && !crowd.length && !rush) spawnCrowd(r);
          if (busLeftAt && now - busLeftAt < 4000) {
            // The full bus pulls off without the player.
            placeRide(r, ((now - busLeftAt) / 4000) ** 2 * Math.min(200, total), dt, false);
            for (const p of r.parts) p.object.visible = true;
          } else {
            busLeftAt = 0;
            placeRide(r, 0, dt, true);
            // The bus or train pulls in for the last few seconds; the plane is at the gate for the last 20 (boarding).
            for (const p of r.parts) p.object.visible = left < (r.trip.mode === "plane" ? 20 : 6) || (rushing && left <= 0);
          }
          crowdStep(now, dt, now / 1000);
          if (rushing && left <= 3 && !rush && !busLeftAt && now - lastRushTry > 1500) void beginRush(r, now);
          if (r.trip.mode === "plane") {
            const lounge: LoungeView = { id: r.trip.id, from: r.trip.from, to: r.trip.to, left: Math.max(0, Math.ceil(left)) };
            setHud((h) => (h.lounge?.id === lounge.id && h.lounge.left === lounge.left ? h : { ...h, lounge }));
          }
          showRide(
            rushing
              ? left > 0
                ? `A crowd is waiting for this bus · it comes in ${clock(left)}: get ready to push!`
                : "The bus is here: push through the crowd!"
              : `${r.trip.mode === "plane" ? "Check-in and boarding" : info.wait} · leaves in ${clock(left)}`,
            true,
          );
          return false;
        }
        if (r.s === 0) {
          clearCrowd(); // the rest squeezed on too
          setHud((h) => (h.lounge ? { ...h, lounge: null } : h)); // boarded: off to the plane
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
        // Through many red lights a bus or taxi may get there a little after the server's time (never before).
        const endsAt = r.departs + Math.max(r.arrives - r.departs, r.way?.plan.ends ?? 0);
        const left = clock((endsAt - serverNow) / 1000);
        // Held up: a red light, or a jam on this stretch.
        const traffic = bus?.light ? "🚦 Red light · " : bus?.jam === 2 ? "Go-slow · " : bus?.jam === 1 ? "Slow traffic · " : "";
        if (bus?.at) {
          const { name, off, on } = bus.at;
          showRide(`Stopped at ${name} · ${off} getting off, ${on} getting on`, false);
        } else if (r.trip.mode === "bus") {
          showRide(`${traffic}${bus?.next && !traffic ? `Next stop: ${bus.next.name} · ` : ""}you get off at ${r.trip.to} in ${left}`, false);
        } else {
          showRide(`${traffic}${r.trip.mode === "plane" ? "Lands" : "Arrives"} in ${left} · ${geo.formatDistance(total - r.s)} to go`, false);
        }
        if (f >= 1 && serverNow >= endsAt && !r.finishing && now - r.lastTry > 2000) void finishRide(now);
        return true;
      }

      // ---- The bus rush (night, rush hour): the crowd, quick questions, the surge to the door ----
      /** People waiting at the kerb for the same bus (more at night), facing the road. */
      function spawnCrowd(r: Ride) {
        const path = r.trip.path;
        const stop = { lng: path[0][0], lat: path[0][1] };
        const heading = geo.headingOf(path[0], path[1]);
        const enlarge = layer.enlargement();
        const tries = r.trip.rushTries ?? 0;
        const random = seededRandom(`${r.trip.id}:crowd:${tries}`);
        const count = (isNight(Date.now(), stop.lng, stop.lat) ? 7 : 5) + Math.floor(random() * 4);
        const door = besideBus(stop, heading, 1.6 * enlarge, 1.5 * enlarge); // (the player waits among them: busKerb)
        for (let i = 0; i < count; i++) {
          const spot = besideBus(stop, heading, (2.8 + random() * 2.6) * enlarge, (random() * 10 - 5) * enlarge);
          const avatar = models.buildAvatar(lookForId(`${r.trip.id}:crowd:${tries}:${i}`));
          const entity = layer.add({ object: avatar.root, lng: spot.lng, lat: spot.lat, heading: geo.headingOf([spot.lng, spot.lat], [door.lng, door.lat]) });
          crowd.push({ entity, avatar, spot, door, walk: null });
        }
      }

      function clearCrowd() {
        for (const c of crowd) layer.remove(c.entity);
        crowd = [];
      }

      /** Idle at the kerb, or squeezing to the door and in. */
      function crowdStep(now: number, dt: number, t: number) {
        const enlarge = layer.enlargement();
        crowd = crowd.filter((c) => {
          let moving = 0;
          let stepM = 0;
          if (c.walk !== null && now >= c.walk) {
            const f = Math.min(1, (now - c.walk) / 1300);
            const before: [number, number] = [c.entity.lng, c.entity.lat];
            c.entity.lng = c.spot.lng + (c.door.lng - c.spot.lng) * f;
            c.entity.lat = c.spot.lat + (c.door.lat - c.spot.lat) * f;
            if (f >= 1) {
              layer.remove(c.entity);
              return false;
            }
            moving = 1.4; // pushing
            stepM = geo.distanceM(before, [c.entity.lng, c.entity.lat]);
          }
          models.animateAvatar(c.avatar, { mode: "walk", phase: "idle", moving, distance: stepM / enlarge }, dt, t);
          return true;
        });
      }

      /** `n` more of the crowd squeeze onto the bus, one after another. */
      function surge(n: number, now: number) {
        let k = 0;
        for (const c of crowd) {
          if (k >= n) break;
          if (c.walk !== null) continue;
          c.walk = now + k * 350;
          k++;
        }
      }

      /** The answer to a rush question, worked out from it (the server checks the real one). */
      function rushAnswerOf(q: string): number | null {
        let m = /^(\d+) \+ (\d+)$/.exec(q);
        if (m) return +m[1] + +m[2];
        m = /^(\d+) − (\d+)$/.exec(q);
        if (m) return +m[1] - +m[2];
        m = /^(\d+) × (\d+)$/.exec(q);
        if (m) return +m[1] * +m[2];
        m = /^Half of (\d+)$/.exec(q);
        if (m) return +m[1] / 2;
        m = /^(\d+), (\d+), (\d+), (\d+), \?$/.exec(q);
        if (m) return +m[4] + (+m[4] - +m[3]);
        return null;
      }

      async function beginRush(r: Ride, now: number) {
        lastRushTry = now;
        const { data } = await supabase.rpc("bus_rush_start");
        const res = data as {
          ok: boolean;
          reason?: string;
          rush?: { id: number; questions: { q: string; choices: number[] }[] };
        } | null;
        if (disposed || ride !== r || rush) return;
        if (!res?.ok || !res.rush) {
          if (res?.reason === "no_rush") r.trip = { ...r.trip, rush: null }; // nothing to push for: on you get
          return; // not yet (clocks differ): again shortly
        }
        rush = { id: res.rush.id, questions: res.rush.questions, answers: [], marks: [], asked: performance.now(), sending: false, outcome: null, outcomeAt: 0 };
      }

      function rushAnswer(choice: number) {
        const ru = rush;
        if (!ru || ru.sending || ru.outcome || ru.answers.length >= ru.questions.length) return;
        const now = performance.now();
        const q = ru.questions[ru.answers.length];
        ru.answers.push(choice);
        const expected = rushAnswerOf(q.q);
        const mark = choice < 0 ? "late" : expected === null ? "done" : q.choices[choice] === expected ? "right" : "wrong";
        ru.marks.push(mark);
        // The crowd surges: a right answer, you hold your place; a wrong or late one, more cut in ahead of you.
        surge(mark === "right" ? 1 : 2, now);
        ru.asked = now;
        if (ru.answers.length >= ru.questions.length) void sendRush(ru);
      }

      async function sendRush(ru: Rush) {
        ru.sending = true;
        const r = ride;
        const { data } = await supabase.rpc("bus_rush_answer", { p_rush: ru.id, p_choices: ru.answers });
        const res = data as { ok: boolean; reason?: string; boarded?: boolean; score?: number; of?: number; trip?: TransitTrip } | null;
        if (disposed || !r || ride !== r || rush !== ru) return;
        const now = performance.now();
        if (!res?.ok || !res.trip) {
          rush = null; // the bus went (another tab), or a hiccup: a new rush for the next one
          return;
        }
        r.trip = res.trip;
        r.offset = Date.parse(res.trip.now) - Date.now();
        r.departs = Date.parse(res.trip.departsAt);
        r.arrives = Date.parse(res.trip.arrivesAt);
        r.way = null;
        void planRideWay(r); // its stops, jams and lights at the new time
        const next = res.boarded ? null : Math.max(0, Math.round((r.departs - (Date.now() + r.offset)) / 1000));
        ru.outcome = { boarded: !!res.boarded, score: res.score ?? 0, of: res.of ?? ru.questions.length, next };
        ru.outcomeAt = now;
        if (res.boarded) {
          surge(crowd.length, now); // the rest pile in behind you
          say(`You squeezed in! (${res.score} of ${res.of}). Off you go.`);
        } else {
          busLeftAt = now; // the full bus pulls off
          clearCrowd();
          say(`The bus filled up before you got to the door (${res.score} of ${res.of}). Next bus in ${clock(next ?? 0)}: you'll have to push again.`, true);
        }
      }

      /** The rush's clock: each question 6 s; the strip on screen; the outcome shown for a few seconds. */
      function rushTick(now: number) {
        const ru = rush;
        if (!ru) return;
        let view: Hud["rush"];
        if (ru.outcome) {
          if (now - ru.outcomeAt > 4000) {
            rush = null;
            lastRushHud = "";
            setHud((h) => ({ ...h, rush: null }));
            return;
          }
          view = { q: "", choices: [], index: ru.questions.length, total: ru.questions.length, left: 0, per: RUSH_PER_S, marks: ru.marks, outcome: ru.outcome };
        } else {
          const index = ru.answers.length;
          if (index < ru.questions.length && (now - ru.asked) / 1000 >= RUSH_PER_S) {
            rushAnswer(-1); // too slow
            return;
          }
          const q = ru.questions[Math.min(index, ru.questions.length - 1)];
          const left = index < ru.questions.length ? Math.max(0, Math.round((RUSH_PER_S - (now - ru.asked) / 1000) * 10) / 10) : 0;
          view = { q: q.q, choices: q.choices, index, total: ru.questions.length, left, per: RUSH_PER_S, marks: ru.marks, outcome: null };
        }
        const key = JSON.stringify(view);
        if (key === lastRushHud) return;
        lastRushHud = key;
        setHud((h) => ({ ...h, rush: view }));
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
        if (mode === "plane") {
          snapReachM = 3000; // the server allows this hop too (save_position)
          landedUntil = performance.now() + 45_000;
        }
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
        // Only what's within reach of here: in the United States the nearest train was a Nigerian one, 12,457 km off
        // (owner, 27 Oct 2026: "the bus, train should work according to the country not showing nigeria").
        if ((near.nearest.train?.metres ?? 0) > 100_000) delete near.nearest.train;
        if ((near.nearest.bus?.metres ?? 0) > 50_000) delete near.nearest.bus;
        near.parkWord = words().park;
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
        countryTick();
      }

      // ---- The country the hunter is in: its words, people's names and radio (src/game/locale.ts) ------------------
      let countryFrom: LngLat | null = null;
      let countryAsking = false;
      function countryTick() {
        const here = traveller.pos;
        if (countryAsking || (countryFrom && geo.distanceM([countryFrom.lng, countryFrom.lat], [here.lng, here.lat]) < 20_000)) return;
        countryAsking = true;
        if (!countryFrom) setCountry(inNigeria(here) ? "NG" : "ZZ"); // until the answer: Nigeria's flavour only in Nigeria
        countryFrom = { ...here };
        void fetch(`/api/world/country?lng=${here.lng}&lat=${here.lat}`)
          .then((r) => (r.ok ? (r.json() as Promise<{ code: string | null }>) : null))
          .then((c) => {
            if (c && !disposed) {
              setCountry(c.code ?? (inNigeria(here) ? "NG" : "ZZ")); // the open sea: no country's in particular
              void refreshNear(); // its words (a motor park or a bus station)
            }
          })
          .catch(() => {
            countryFrom = null; // try again shortly
          })
          .finally(() => {
            countryAsking = false;
          });
      }

      const stopTitle = (st: TransitStop) => (st.kind === "plane" ? `${st.name} (${st.code})` : st.kind === "train" ? `${st.name} station` : st.name);

      /** A bus from this stop to the bus stop nearest a place, along the roads a car would take. */
      async function quoteBus(from: TransitStop, place: Place): Promise<TransitQuote | string> {
        // Abroad, the place's stops come in first if they aren't yet (a few seconds).
        const pending = await lookUpArea(place);
        const far = geo.distanceM([from.lng, from.lat], [place.lng, place.lat]) > BUS_RANGE_M;
        let to: TransitStop | undefined;
        if (!far) {
          const { data } = await supabase.rpc("stops_near", { p_kind: "bus", p_lng: place.lng, p_lat: place.lat, p_limit: 1 });
          to = (data as TransitStop[] | null)?.[0];
          if (!to || to.metres > 2000) {
            if (pending) return `The bus stops around ${place.name} are still being looked up: try again in a moment.`;
            return `There's no bus stop within 2 km of ${place.name}.`;
          }
        } else {
          // Another city: a long-distance bus, motor park to motor park.
          if (!from.park) {
            const park = near?.park;
            return `Buses to other cities leave from ${near?.parkWord ?? "motor park"}s.${park ? ` The nearest is ${park.name}, ${geo.formatDistance(park.metres)} away (Directions in this panel).` : ""}`;
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
          if (!to) {
            if (pending) return `The bus stations around ${place.name} are still being looked up: try again in a moment.`;
            return `There's no ${inNigeria(place) ? "motor park" : "bus station"} within 25 km of ${place.name}, so no long-distance bus goes there.`;
          }
        }
        const straight = geo.distanceM([from.lng, from.lat], [to.lng, to.lat]);
        if (to.id === from.id || straight < 300) return `${place.name} is within walking distance of this stop.`;
        if (straight > COACH_RANGE_M) return "That's too far for a bus. Take a plane.";
        // City trips on our own roads, long ones on our main-road network; the routing service if those fail.
        let path: import("@/game/geo").Coord[] | null = null;
        if (far && inNigeria(from) && inNigeria(to)) {
          // Our main-road network is Nigeria's: elsewhere it took Calgary to Red Deer by way of Nigeria (21,311 km), so
          // a long way abroad goes by the routing service below.
          const highways = await loadHighways(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public`);
          path = highways ? highwayRoute(highways, [from.lng, from.lat], [to.lng, to.lat]) : null;
        } else if (!far) {
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
            desk:
              quote.from.kind === "plane"
                ? `Check in at ${stopTitle(quote.from)}'s desk: you need to be at it.`
                : `Buy your ticket at ${stopTitle(quote.from)}'s ticket office: you need to be at its counter.`,
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
        ticketOffice,
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

      async function spotAhead(kinds: Spot["kind"][], closest = false): Promise<{ spot: Spot; behind: boolean; nearest?: boolean } | null> {
        const at = { ...traveller.pos };
        if (closest) {
          // The nearest of them, whichever way (on foot, e.g. from a dry tank).
          const { data } = await supabase.rpc("places_near", { p_kinds: kinds, p_lng: at.lng, p_lat: at.lat, p_limit: 20 });
          const list = ((data ?? []) as Spot[]).map((sp) => ({ ...sp, metres: Math.round(geo.distanceM([at.lng, at.lat], [sp.lng, sp.lat])) }));
          if (disposed || !list.length) return null;
          return { spot: list.sort((a, b) => a.metres - b.metres)[0], behind: false, nearest: true };
        }
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
      async function advise(
        key: string,
        title: string,
        text: string,
        kinds: Spot["kind"][] | null,
        maxM = Infinity,
        none?: { text: string; where: string },
        nearest = false,
      ) {
        let found = kinds ? await spotAhead(kinds, nearest) : null;
        if (disposed) return;
        if (found && found.spot.metres > maxM) found = null;
        const spot = found?.spot ?? null;
        const full = found
          ? `${text} ${found.nearest ? "The nearest" : found.behind ? "None ahead; the nearest is back the way you came" : trip ? "Next on your way" : "Next ahead"}: ${found.spot.name}, ${geo.formatDistance(found.spot.metres)}.`
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
        if (traveller.mode === "motorbike" || traveller.mode === "car") {
          // Riding or driving a long time (owner, 26 Oct 2026): time for a break.
          const what = traveller.mode === "car" ? "driving" : "riding";
          if (energy <= 0 && warned.energy > 0) {
            warned.energy = 0;
            void advise("energy", "Too tired to go on", `You're too tired to keep ${what}. Pull over and rest (Rest here), or take a break at a park, a mall or a place to eat.`, ["rest", "eat"], 2000, {
              text: `You're too tired to keep ${what}. Pull over and rest right here (Rest here) until you've got your energy back.`,
              where: "Rest here",
            });
          } else if (energy < 25 && warned.energy > 25) {
            warned.energy = 25;
            void advise("energy", "Pull over and rest", `You've been ${what} too long and you're worn out: pull over and rest now, or you'll soon be too tired to go on.`, ["rest", "eat"], 2000, {
              text: `You've been ${what} too long and you're worn out. Pull over and rest right here (Rest here).`,
              where: "Rest here",
            });
          } else if (energy < 50 && warned.energy > 50) {
            warned.energy = 50;
            void advise("energy", "Time for a break", `You've been ${what} a while. Take a break at a chill spot (a park, a mall or a place to eat): energy comes back fast there.`, ["rest", "eat"], 2000, {
              text: `You've been ${what} a while. Pull over for a break (Rest here) when you can.`,
              where: "Rest here",
            });
          }
        } else if (traveller.mode === "walk" || traveller.mode === "bicycle") {
          if (energy < 25 && warned.energy > 25) {
            warned.energy = 25;
            void advise("energy", "Exhausted: rest now", "You're exhausted! Rest now or you'll faint and need an ambulance: sit down at a park, a mall or a place to eat, or have a meal.", ["rest", "eat"], chillReachM(), {
              text: "You're exhausted! There's no chill spot close by: sit down and rest right where you are (Rest here), or you'll faint and need an ambulance.",
              where: "No chill spot near: rest here",
            });
          } else if (energy < 50 && warned.energy > 50) {
            warned.energy = 50;
            void advise("energy", "Getting tired", "You're getting tired. Take a break at a chill spot (a park, a mall or a place to eat): energy comes back fast there.", ["rest", "eat"], chillReachM(), {
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
            void advise("fuel", "Fuel almost gone", `Fuel almost gone! If the tank runs dry your ${vehicleName(mine.kind)} stops at the roadside, and you walk to a petrol station and back with a jerry can.`, ["fuel"]);
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
            void advise("tyre", "Flat tyre", `Flat tyre! You're pushing your bicycle at walking pace. A ${words().tyres} or petrol station can fix it (20 coins).`, ["tyres", "fuel"]);
          } else if (mine.tyre < 40 && warned.tyre > 40) {
            warned.tyre = 40;
            void advise("tyre", "Soft tyres", `Your tyres are getting soft. Pump them at a ${words().tyres} or petrol station (5 coins).`, ["tyres", "fuel"]);
          }
          if (mine.tyre > 60 && warned.tyre < 100) {
            warned.tyre = 100;
            clearAdvice("tyre");
          }
        }
      }

      /** The motorbike or car a petrol station would fill: the one ridden, or an empty one in the pocket. */
      function thirstyVehicle() {
        const riding = ownInUse();
        if (riding && riding.kind !== "bicycle" && riding.fuel < 99) return riding;
        return owned.find((v) => !v.in_use && !v.stranded_at && v.kind !== "bicycle" && v.fuel <= 0) ?? null;
      }

      /** What can be done here: by the place the hunter is at, and the vehicles next to them. */
      function computeActions() {
        const list: { id: LimitAction; icon: string; short: string; label: string }[] = [];
        if (!visit && !ride && traveller.phase === "idle") {
          // Buttons for the vehicle being ridden; one in the pocket only when it can't be ridden until seen to
          // (an empty tank, a breakdown). The server picks the same vehicle.
          const riding = ownInUse();
          const motorRidden = riding && riding.kind !== "bicycle" ? riding : null;
          const pocketed = (want: (v: VehicleRow) => boolean) => owned.find((v) => !v.in_use && !v.stranded_at && v.kind !== "bicycle" && want(v)) ?? null;
          const stranded = strandedVehicle();
          const atStranded = !!stranded && metresTo(stranded) <= 25;
          // Beside a motorbike or car with a flat: change the tyre (a roadside mechanic, or your jack).
          const flat = flatVehicle();
          if (flat && metresTo(flat) <= 25 && traveller.mode === "walk") {
            list.push({ id: "flat", icon: "🛞", short: "Fix flat", label: `Change your ${vehicleName(flat.kind)}'s flat tyre` });
          }
          const eatSpot = spotHere(["eat"]);
          if (eatSpot && traveller.energy < 95) list.push({ id: "eat", icon: "🍲", short: `Eat · ${MEAL_PRICE}`, label: `Eat at ${eatSpot.name} · ${MEAL_PRICE} coins` });
          const chill = spotHere(["rest", "eat"]);
          // Resting: on foot, by your bicycle, or pulled over on a motorbike or in a car (they tire you too).
          const driving = traveller.mode === "motorbike" || traveller.mode === "car";
          if (chill && (traveller.mode === "walk" || driving) && traveller.energy < 90 && !traveller.resting) list.push({ id: "rest", icon: "🪑", short: "Rest", label: `Rest at ${chill.name}` });
          if (!chill && traveller.energy < 60 && !traveller.resting) {
            list.push({ id: "rest_here", icon: "🧘", short: "Rest here", label: driving ? "Pull over and rest right here (slower than at a chill spot)" : "Sit down and rest right here (slower than at a chill spot)" });
          }
          const station = spotHere(["fuel"]);
          const thirsty = thirstyVehicle();
          if (station && thirsty) {
            list.push({
              id: "refuel",
              icon: "⛽",
              short: "Refuel",
              label: thirsty.in_use ? `Refuel at ${station.name}` : `Fill your ${vehicleName(thirsty.kind)}'s tank (in your pocket) at ${station.name}`,
            });
          } else if (station && stranded && !(keg && keg.fuel >= KEG_CAPACITY)) {
            // The vehicle is back at the roadside: the attendant fills a jerry can to carry to it.
            list.push({ id: "refuel", icon: "⛽", short: "Jerry can", label: `Fuel in a jerry can for your ${vehicleName(stranded.kind)}` });
          }
          const lowOnFuel = (motorRidden && motorRidden.fuel < 40) || !!pocketed((v) => v.fuel <= 0);
          // A jerry can (the attendant sells and fills one for a vehicle at the roadside: the Jerry can button above).
          const canFill = keg ? 2 * (KEG_CAPACITY - Math.floor(keg.fuel)) : 0;
          if (station && !stranded && !keg && lowOnFuel) list.push({ id: "buy_keg", icon: "🛢", short: `Jerry can · ${KEG_PRICE}`, label: `Buy a jerry can · ${KEG_PRICE} coins` });
          if (station && !stranded && keg && keg.fuel < KEG_CAPACITY) list.push({ id: "fill_keg", icon: "🛢", short: `Fill can · ${canFill}`, label: `Fill your jerry can · ${canFill} coins` });
          // Pour it only when a tank has run dry (owner, 26 Oct 2026: "remove the jerry can totally… not needed… except
          // when fuel finishes"): by the vehicle at the roadside, or into an empty one in your pocket.
          const dry = atStranded ? stranded : pocketed((v) => v.fuel <= 0 && !v.broken_at);
          pourTarget = keg && keg.fuel > 0 && dry ? dry : null;
          if (keg && keg.fuel > 0 && dry) list.push({ id: "pour_keg", icon: "🛢", short: "Pour can", label: `Pour the jerry can into your ${vehicleName(dry.kind)}` });
          // Beside the vehicle that ran dry, with no fuel in a can but a Jerry Can relic: use that.
          if (atStranded && stranded && !(keg && keg.fuel > 0) && jerryRelicId) {
            list.push({ id: "jerry_relic", icon: "⛽", short: "Jerry Can", label: `Use your Jerry Can relic: your ${vehicleName(stranded.kind)}'s tank to ${KEG_CAPACITY}%` });
          }
          const bike = riding?.kind === "bicycle" ? riding : null; // pumping is for the bicycle you're on
          // A tyre kit fixes it anywhere (at a vulcanizer, the vulcanizer does).
          if (bike && bike.tyre < 95 && tyreKits > 0 && !spotHere(["tyres", "fuel"])) {
            list.push({ id: "tyre_kit", icon: "🛠", short: bike.tyre <= 0 ? "Tyre kit: flat" : "Tyre kit", label: "Fix your tyres with your tyre kit" });
          }
          if (spotHere(["tyres", "fuel"]) && bike && bike.tyre < 95) {
            list.push(bike.tyre <= 0 ? { id: "pump", icon: "🛞", short: "Fix flat · 20", label: "Fix the flat · 20 coins" } : { id: "pump", icon: "🛞", short: "Pump · 5", label: "Pump the tyres · 5 coins" });
          }
          const motor = motorRidden && motorRidden.engine < 90 ? motorRidden : pocketed((v) => !!v.broken_at);
          if (spotHere(["mechanic"]) && motor) {
            list.push({ id: "service", icon: "🔧", short: "Service · 60", label: `Service your ${vehicleName(motor.kind)} · 60 coins` });
          }
          const broken = owned.find((v) => !!v.broken_at && !v.repair_ready_at) ?? null; // the mechanic comes to you
          if (broken) {
            const fee = CALL_OUT_PRICE[broken.kind];
            list.push({ id: "mechanic", icon: "🔧", short: `Mechanic · ${fee}`, label: `Call a mechanic for your ${vehicleName(broken.kind)} · ${fee} coins` });
          }
        }
        setHud((h) => (JSON.stringify(h.actions) === JSON.stringify(list) ? h : { ...h, actions: list }));
      }

      const showKeg = () => setHud((h) => ({ ...h, keg: keg ? { ...keg } : null }));

      setFuelActions({ fill: () => refuelHere(true), buyKeg: () => act("buy_keg"), fillKeg: () => fillKegHere() });
      setPumpActions({ pump: () => act("pump", true) });
      setPourActions({
        pour: async () => {
          lastPour = null;
          const ok = await act("pour_keg", true);
          return ok ? lastPour : null;
        },
      });
      // Changing a flat (FlatScene): start it (the wait), then finish it: the tyre changed, and back on the vehicle.
      setFlatActions({
        start: async (how) => {
          await savePosition();
          const { data } = await supabase.rpc("start_flat_fix", { p_how: how });
          const r = data as { ok: boolean; reason?: string; seconds?: number } | null;
          return r ?? { ok: false, reason: "error" };
        },
        finish: async () => {
          const { data } = await supabase.rpc("finish_flat_fix");
          const r = data as { ok: boolean; reason?: string; kind?: VehicleKind; price?: number; balance?: number; remounted?: boolean } | null;
          if (disposed || !r) return { ok: false, reason: "error" };
          if (!r.ok) return r;
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          if (r.remounted && r.kind) {
            // Back on it, and on the way the player was going.
            traveller.mode = r.kind;
            saved = { ...traveller.pos };
          }
          await refreshVehicles();
          if (r.remounted) {
            afterModeChange();
            const onTo = resumeGoing();
            say(`New tyre on${r.price ? ` (${r.price} coins)` : ""}: you're back on your ${vehicleName(r.kind ?? "motorbike")}${onTo ? `. On to ${onTo}` : ""}.`, true);
          }
          computeActions();
          return r;
        },
      });
      setServiceActions({ service: () => act("service", true) });
      setMealActions({
        eat: async () => {
          const place = spotHere(["eat"]);
          return place ? eatHere(place.name, true) : { ok: false, reason: "not_here" };
        },
      });

      /** The vehicle the jerry can would go into (computeActions), and how the last pour went. */
      let pourTarget: { kind: VehicleKind; fuel: number } | null = null;
      let lastPour: { tank: number; can: number; usesLeft: number; spoilt: boolean } | null = null;
      async function act(id: LimitAction, direct = false): Promise<boolean> {
        if (busy) return false;
        if (id === "pour_keg" && !direct) {
          // The pour as a scene (owner, 26 Oct 2026): the hunter gets off and tips the can in; both gauges move.
          const v = pourTarget;
          if (!v || !keg || v.kind === "bicycle") return false;
          traveller.v = 0;
          sceneHold = true;
          setPourOpen({ kind: v.kind, tank: v.fuel, can: Math.min(1, keg.fuel / KEG_CAPACITY), usesLeft: keg.usesLeft });
          return true;
        }
        if (id === "flat") {
          // The flat by the roadside (FlatScene): a roadside mechanic, or your own jack.
          const v = flatVehicle();
          if (!v || v.kind === "bicycle" || metresTo(v) > 25) return false;
          await savePosition(); // the server checks you're beside it
          const offer: FlatOffer = { kind: v.kind, mechanic: nameFor("vulcanizer", `${v.lng.toFixed(4)},${v.lat.toFixed(4)}`), jack: v.jack };
          openFlatPlace(offer, v);
          setFlatOpen(offer);
          return true;
        }
        if (id === "jerry_relic" || id === "tyre_kit") {
          setBusy(true);
          try {
            if (id === "jerry_relic" && jerryRelicId) await savePosition(); // the server checks you're beside it
            const said = id === "jerry_relic" ? ((jerryRelicId && (await actions.current?.useRelic(jerryRelicId))) ?? "") : await applyItem("tyre_kit");
            if (said) say(said, true);
            return true;
          } finally {
            setBusy(false);
            computeActions();
          }
        }
        if (id === "service" && !direct) {
          // The mechanic (ServiceScene): 20 s for a light service, up to 45 s for a worn-out or broken engine.
          const spot = spotHere(["mechanic"]);
          const riding = ownInUse();
          const v = riding && riding.kind !== "bicycle" && riding.engine < 90 ? riding : owned.find((o) => !o.in_use && o.kind !== "bicycle" && !!o.broken_at) ?? null;
          if (!spot || !v || v.kind === "bicycle") return false;
          const offer: ServiceOffer = {
            place: spot.name,
            mechanic: nameFor("mechanic", String(spot.id)),
            kind: v.kind,
            engine: v.engine,
            broken: !!v.broken_at,
            price: 60,
            seconds: v.broken_at ? 45 : Math.min(45, Math.max(20, Math.round(20 + (90 - v.engine) * 0.5))),
          };
          openServicePlace(offer, spot);
          setServiceOpen(offer);
          return true;
        }
        if (id === "pump" && !direct) {
          // The vulcanizer (PumpScene): soft tyres pumped (8 s), or a flat patched and pumped (20 s).
          const spot = spotHere(["tyres", "fuel"]);
          const bike = ownInUse();
          if (!spot || bike?.kind !== "bicycle") return false;
          const flat = bike.tyre <= 0;
          const place = spot.kind === "fuel" ? `${spot.name}: air and tyres` : spot.name;
          const offer = { place, keeper: nameFor("vulcanizer", String(spot.id)), flat, price: flat ? 20 : 5, seconds: flat ? 20 : 8 };
          openPumpPlace(offer, spot);
          setPumpOpen(offer);
          return true;
        }
        if (id === "eat") {
          // Sit down with the cook (MealScene).
          const place = spotHere(["eat"]);
          if (place) {
            const offer = { place: place.name, cook: nameFor("cook", String(place.id)), id: place.id, price: MEAL_PRICE, energy: MEAL_ENERGY };
            openMealPlace(offer, todaysMenu(place.id).map((d) => d.board), place);
            setMealOpen(offer);
          }
          return !!place;
        }
        if (id === "refuel") {
          // The pump attendant (FuelScene).
          const station = spotHere(["fuel"]);
          const thirsty = thirstyVehicle();
          const s = thirsty ? null : strandedVehicle(); // back at the roadside: a jerry can to carry to it
          const v = thirsty ?? s;
          if (station && v && v.kind !== "bicycle") {
            const offer = {
              station: station.name,
              attendant: nameFor("attendant", String(station.id)),
              kind: v.kind,
              fuel: v.fuel,
              pocket: !v.in_use,
              hasKeg: !!keg,
              kegFuel: keg?.fuel ?? 0,
              stranded: s ? { metres: Math.round(metresTo(s)) } : null,
            };
            openFuelPlace(offer, station, station.id);
            setFuelOpen(offer);
          }
          return !!station && !!v;
        }
        setBusy(true);
        try {
          await savePosition(); // the server checks where the player is
          const rpc: Record<Exclude<LimitAction, "eat" | "refuel" | "jerry_relic" | "tyre_kit" | "flat">, string> = {
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
            kegFuel?: number;
            remounted?: boolean;
            /** Poured into a vehicle at the roadside with a flat: you stay on foot until the tyre is changed. */
            flat?: boolean;
            lng?: number;
            lat?: number;
          } | null;
          if (disposed) return false;
          if (!r?.ok && r?.reason === "far") {
            const s = strandedVehicle();
            say(`Carry the jerry can to your ${s ? vehicleName(s.kind) : "vehicle"} first: it's ${s ? geo.formatDistance(metresTo(s)) : "back"} away at the roadside.`, true);
            return false;
          }
          if (!r?.ok) {
            const why: Record<string, string> = {
              not_here: "You need to be right at the place for that.",
              coins: "Not enough coins for that.",
              have_one: "You already have a jerry can.",
              full: "It's already full.",
              no_vehicle: "None of your vehicles needs that.",
              no_keg: "Buy a jerry can first.",
              empty: "Your jerry can is empty: fill it at a petrol station.",
            };
            say(why[r?.reason ?? ""] ?? "Couldn't do that just now.", true);
            return false;
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
            say(
              traveller.mode === "motorbike" || traveller.mode === "car"
                ? `You pull over and rest by your ${vehicleName(traveller.mode)}. Energy comes back while you rest (faster at a park or a place to eat); go on when you're ready.`
                : `You sit down ${traveller.mode === "bicycle" ? "by your bicycle" : "by the road"}. Energy comes back while you rest (faster at a park or a place to eat); move on when you're ready.`,
            );
          } else if (id === "buy_keg") {
            keg = { fuel: 0, usesLeft: r.usesLeft ?? 50 };
            say(`You bought a jerry can (good for 50 trips). Fill it here: it carries enough for ${KEG_CAPACITY}% of a tank.`);
          } else if (id === "fill_keg") {
            keg = { fuel: r.fuel ?? KEG_CAPACITY, usesLeft: keg?.usesLeft ?? 50 };
            say(`Jerry can filled: ${Math.round(r.fuel ?? KEG_CAPACITY)}% of a tank for ${r.cost} coins. Pour it in when the tank runs dry.`);
            adviseCarryBack();
          } else if (id === "pour_keg") {
            keg = r.spoilt ? null : { fuel: r.kegFuel ?? 0, usesLeft: r.usesLeft ?? 0 };
            lastPour = { tank: r.fuel ?? 0, can: Math.min(1, (r.kegFuel ?? 0) / KEG_CAPACITY), usesLeft: r.usesLeft ?? 0, spoilt: !!r.spoilt };
            const name = r.kind ? vehicleName(r.kind) : "vehicle";
            let onTo: string | null = null;
            if (r.remounted && r.kind) {
              // Back on the vehicle that stood at the roadside.
              traveller.mode = r.kind;
              saved = { ...traveller.pos };
            }
            await refreshVehicles();
            if (r.remounted) {
              afterModeChange();
              clearAdvice("fuel");
              onTo = resumeGoing(); // the way the player was going before the tank ran dry
            }
            warned.fuel = 100;
            say(
              r.remounted
                ? `Poured: your ${name} has ${Math.round(r.fuel ?? 0)}% fuel, and you're back on it${onTo ? `. On to ${onTo}` : ""}. A jerry can only goes so far: fill up at a petrol station.`
                : `Poured: your ${name} has ${Math.round(r.fuel ?? 0)}% fuel.${r.flat ? " Change its flat tyre (🛞 Fix flat) to ride on." : ""}${r.spoilt ? " That was your jerry can's last use: it's worn out." : ` Your jerry can has ${r.usesLeft} uses left.`}`,
              true,
            );
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
          return true;
        } finally {
          setBusy(false);
          computeActions();
        }
      }

      /** After a save: the server's energy, wear, and whether the vehicle stopped or the hunter fainted. */
      function onSaved(result: SaveResult) {
        if (typeof result.energy === "number") {
          if (traveller.phase === "fainted" && !result.fainted && !visit) {
            // The server counted a little more energy than this device (it measures straight lines between saves):
            // the collapse this device saw stands, if the server's count is low too.
            void confirmCollapse();
          } else traveller.energy = result.energy;
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

      /** An empty tank, a flat or a breakdown: the vehicle stays where it stopped; the hunter is on foot. */
      function vehicleStopped(why: "fuel" | "broken" | "flat") {
        const kind = traveller.mode === "walk" ? null : (traveller.mode as VehicleKind);
        if (kind && why === "broken") pocketAnim(kind, false); // out of fuel, it stays at the roadside (showParked)
        traveller.mode = "walk";
        traveller.v = 0;
        void refreshVehicles().then(() => {
          afterModeChange();
          computeActions();
        });
        const name = kind ? vehicleName(kind) : "vehicle";
        if (why === "flat") {
          // Right beside it (where the server saw it stop: the phone may have ridden on a few seconds more), to change
          // the tyre here, then on the way again.
          placeAt(saved.lng, saved.lat);
          if (trip) setGoing({ lng: trip.to.lng, lat: trip.to.lat, name: trip.name });
          endDirections();
          const jack = owned.find((v) => v.kind === kind)?.jack;
          say(
            `💥 Flat tyre! Your ${name} stands at the roadside. ${
              jack ? "Change it with your jack (free)" : "No jack: a roadside mechanic can change it"
            }${jack ? `, or let a roadside mechanic do it (${FLAT_FIX_PRICE} coins)` : ` for ${FLAT_FIX_PRICE} coins`}: the 🛞 Fix flat button.`,
            true,
          );
          return;
        }
        if (why === "fuel") {
          if (fuelInHand()) {
            if (trip) setGoing({ lng: trip.to.lng, lat: trip.to.lat, name: trip.name });
            endDirections();
            say(
              keg && keg.fuel > 0
                ? `Out of fuel! Your ${name} stands at the roadside. Pour in your jerry can (the gold button).`
                : `Out of fuel! Your ${name} stands at the roadside. You have a Jerry Can relic: use it right here (the gold button).`,
              true,
            );
          } else {
            // On foot to the nearest petrol station, by road, with (or for) a jerry can, and back. The way the player was
            // going waits until then.
            if (trip) setGoing({ lng: trip.to.lng, lat: trip.to.lat, name: trip.name });
            endDirections();
            nextStrandGuide = performance.now() + 20000;
            adviseFuelWalk(name, true);
          }
        } else {
          say(`Your ${name} has broken down and goes into your pocket. Take it to a repair shop nearby, or call a mechanic to you.`, true);
          if (kind) void findRepairShop(kind, false);
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

      function showCare(icon: string, title: string, status: string) {
        setHud((h) => (h.care?.title === title && h.care.status === status ? h : { ...h, care: { icon, title, status } }));
      }

      /**
       * This device saw the hunter collapse (0 energy on foot or a bicycle) but the server's save didn't: the server
       * takes its word when its own count is low too (owner, 27 Oct 2026: "the avatar just looks like falling, and then
       * continue moving"). Only well short of 0 by the server's count do they get up again.
       */
      let confirming = false;
      async function confirmCollapse() {
        if (confirming || visit) return;
        confirming = true;
        const { data } = await supabase.rpc("collapse");
        confirming = false;
        if (disposed) return;
        const r = data as { ok: boolean; reason?: string; energy?: number } | null;
        if (r?.ok) return faint();
        if (r?.reason === "busy") return;
        traveller.phase = "idle";
        if (typeof r?.energy === "number") traveller.energy = r.energy;
        say("You're about to collapse: rest now!", true);
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
          // Our own roads, or (abroad, where we have none) the routing service, as for a taxi.
          const byRoad = async (from: LngLat, to: LngLat) => {
            const own = (await routeOnOwnRoads(from, to, "car"))?.path ?? null;
            if (own) return own;
            const { route: r, fallback } = await fetchRoute(from, to, "car");
            return fallback ? null : r.coords;
          };
          const way = await byRoad(at, hospital);
          if (way) route = thinPath([[at.lng, at.lat], ...way, [hospital.lng, hospital.lat]]);
          // The ambulance comes from 1–2 km away, along the roads.
          for (let i = 0; i < 4 && route && !approach; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const m = 1000 + Math.random() * 1000;
            const start = {
              lng: at.lng + (Math.sin(angle) * m) / (111320 * Math.cos((at.lat * Math.PI) / 180)),
              lat: at.lat + (Math.cos(angle) * m) / 110574,
            };
            const found = await byRoad(start, at);
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
            say("You collapsed on your bicycle: it's damaged. Once you're out of hospital, a repair shop nearby can fix it.", true);
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
        // A vehicle damaged in the fall: a repair shop not far from the hospital, and the way there.
        const broken = owned.find((v) => v.broken_at && !v.repair_ready_at);
        if (broken) void findRepairShop(broken.kind, true);
        const discharge = {
          hospital: vs.v.route ? (r.hospital ?? vs.v.hospital) : null,
          nurse: nameFor(vs.v.route ? "nurse" : "paramedic", vs.v.calledAt),
          bill: vs.v.bill,
          energy: Math.round(traveller.energy),
          damaged: broken?.kind ?? null,
        };
        openWardPlace(discharge, { lng, lat });
        setDischarge(discharge);
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
          renter = models.buildAvatar(keeperLook(renterName(p.requestedAt)));
          renter.root.add(layer.billboard(models.makeNameplate(p.kind === "bicycle" ? "BICYCLE HIRE" : `${words().okada.toUpperCase()} HIRE`, "#1E9E62")));
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

      /**
       * Ask for a bicycle or motorbike: a renter brings one to a side street near you (never by a highway or a
       * main road; owner, 18 Oct 2026), or to the nearest bus stop where there's no such street.
       */
      async function requestBikePickup(kind: "bicycle" | "motorbike") {
        if (rental) {
          say("Return your rental first (vehicle button, then Get off), then ask for another.", true);
          return;
        }
        await savePosition();
        const at = { ...traveller.pos };
        const street = network ? roads.streetSpot(network, at) : null;
        let spot: { name: string; lng: number; lat: number; metres: number };
        if (street) {
          spot = { name: street.name ?? "a side street", lng: street.lng, lat: street.lat, metres: Math.round(street.metres) };
        } else {
          const { data } = await supabase.rpc("stops_near", { p_kind: "bus", p_lng: at.lng, p_lat: at.lat, p_limit: 1 });
          const stop = (data as TransitStop[] | null)?.[0];
          spot = stop && stop.metres <= 2000 ? { name: stop.name, lng: stop.lng, lat: stop.lat, metres: stop.metres } : { name: "where you are", ...at, metres: 0 };
        }
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

      setRentalActions({
        rent: async () => {
          const pk = pickup;
          if (!pk || pk.p.kind === "taxi") return "error";
          const r = await chooseVehicle(pk.p.kind, "rent");
          return r === "ok" ? "ok" : r === "coins" ? "coins" : "error";
        },
        cancel: () => void cancelPickup(),
      });

      /** The banner's button: get in the taxi, or ride off on the rented bike. */
      async function pickupAction() {
        const pk = pickup;
        if (!pk || busy) return;
        if (pk.p.kind !== "taxi") {
          // At the renter: meet them (RentalScene); not there yet, chooseVehicle says to walk.
          if (geo.distanceM([traveller.pos.lng, traveller.pos.lat], [pk.p.lng, pk.p.lat]) <= PICKUP_AT_M) {
            const offer = { kind: pk.p.kind, renter: renterName(pk.p.requestedAt), stop: pk.p.name, rate: VEHICLES[pk.p.kind].ratePerMinute };
            openHirePlace(offer, { lng: pk.p.lng, lat: pk.p.lat }, pk.entities);
            setRentOpen(offer);
          } else await chooseVehicle(pk.p.kind, "rent");
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
                const a = pts.get(way.points[i - 1]);
                const b = pts.get(way.points[i]);
                if (!a || !b) continue;
                const jam = jamOn(way.cls, roads.jamStretch(way, a), urban, level, now);
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

      /** The jam (if any) where the hunter is, as the map draws it under them: slows motorbikes and cars. */
      function trafficHere(now: number) {
        const { lng, lat } = traveller.pos;
        const level = trafficLevel(now, lng, lat);
        let jam: Jam = 0;
        if (network && onRoad && level > 0) {
          for (const r of roads.roadsNear(network, traveller.pos, 12)) {
            const j = jamOn(r.cls, r.stretch, r.urban, level, now);
            if (j > jam) jam = j;
          }
        }
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

      // ---- Traffic lights (src/game/signals.ts): the real ones, the same colour for every player.
      // Shown in 3D at the kerb; cars, motorbikes and bicycles stop at red (walkers cross).
      let allSignals: Signal[] = [];
      let signalsHere: Signal[] = [];
      let signalsFrom: LngLat | null = null;
      const lights = new Map<number, { entity: import("@/game/ThreeMapLayer").MapEntity; model: ReturnType<typeof models.makeTrafficLight> }>();
      let lastLights = -Infinity;
      let redShown: number | null = null;
      let redAt = -Infinity;
      let redWarnedAt = -Infinity;
      void loadSignals().then((s) => {
        allSignals = s;
        signalsFrom = null;
      });

      /** Beside the road, facing along it (the light's spot is in the junction). */
      function kerbOf(s: Signal) {
        const rp = network ? roads.snapToNetwork(network, s, 0) : null;
        const p = network && rp ? roads.positionOf(network, rp) : null;
        if (!p || geo.distanceM([p.lng, p.lat], [s.lng, s.lat]) > 25) return { lng: s.lng, lat: s.lat, heading: 0 };
        return { ...besideBus(p, p.heading, 5 * layer.enlargement(), 0), heading: p.heading };
      }

      function lightsTick(now: number) {
        if (redShown !== null && now - redAt > 400) showRed(null); // moved on, or stopped trying
        if (now - lastLights < 250) return;
        lastLights = now;
        const pos = traveller.pos;
        if (!signalsFrom || geo.distanceM([signalsFrom.lng, signalsFrom.lat], [pos.lng, pos.lat]) > 100) {
          signalsFrom = { ...pos };
          signalsHere = signalsNear(allSignals, pos, 700);
          const keep = new Set(signalsHere.map((s) => s.id));
          for (const [id, l] of lights) {
            if (keep.has(id)) continue;
            layer.remove(l.entity);
            lights.delete(id);
          }
        }
        const wall = Date.now();
        for (const s of signalsHere) {
          let l = lights.get(s.id);
          if (!l) {
            if (!network && !ride) continue; // once the roads are known, to stand at the kerb
            const at = kerbOf(s);
            const model = models.makeTrafficLight();
            l = { entity: layer.add({ object: model.group, lng: at.lng, lat: at.lat, heading: at.heading }), model };
            lights.set(s.id, l);
          }
          l.model.show(signalState(s.group, wall).light);
        }
      }

      /** A red (or amber) light just ahead that this step would run: how long until green. */
      function redLightAhead(step: number) {
        if (traveller.mode === "walk" || !signalsHere.length) return null;
        const ahead = signalAhead(signalsHere, traveller.pos, traveller.heading, 40);
        // Stop 6 m short of it; already at it (it changed as you got there): go on.
        if (!ahead || ahead.ahead < 4 || ahead.ahead - step > 6) return null;
        const wait = waitForGreen(ahead.signal.group, Date.now());
        return wait > 0 ? wait : null;
      }

      function showRed(seconds: number | null) {
        if (seconds === redShown) return;
        redShown = seconds;
        setHud((h) => ({ ...h, redLight: seconds }));
      }

      function holdAtRed(wait: number, now: number) {
        traveller.v = 0;
        redAt = now;
        showRed(Math.max(1, Math.ceil(wait / 1000)));
        if (now - redWarnedAt > 60_000) {
          redWarnedAt = now;
          say("🚦 Red light! Wait for green.");
        }
      }

      function skyAndTrafficTick(now: number) {
        lightsTick(now);
        darkTick(now);
        parkedTick(now);
        strandGuideTick(now);
        const wall = Date.now();
        if (now - lastSky > 30_000) {
          lastSky = now;
          updateSky(wall);
          drawTraffic(wall);
        }
        // Often: a car covers 30 m a second even in a go-slow, 150 m on a free road.
        if (now - lastTraffic > 200) {
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
        // A train, wherever both ends are near stations on the same line.
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
        await Promise.all(tries);
        // Driving: your own motorbike or car, by road, within a long-distance bus's range.
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
        // Abroad, the place's stops come in first if they aren't yet (a few seconds), then the ways there.
        const lookingUp = await lookUpArea(place);
        const options = await journeyOptions(place);
        if (disposed) return;
        if (!options) {
          setJourneyPlan(null);
          void planDirections({ lng: place.lng, lat: place.lat }, place.name);
          return;
        }
        const soon = lookingUp ? ` Its bus stations are still being looked up: check again in a moment.` : "";
        setJourneyPlan({
          place,
          options,
          message: options.length ? (soon ? soon.trim() : null) : `No bus, train or plane goes there from here. You can still take the road.${soon}`,
        });
      }

      /**
       * Outside Nigeria a place's area may not have its bus stops, stations and lines yet (they come in as hunters go:
       * src/lib/fill-area.ts): brings them in (its own square before the answer, a few seconds; the rest after). True
       * if they're still not in (the service busy, or another fill nearby going on).
       */
      async function lookUpArea(p: { lng: number; lat: number }) {
        if (inNigeria(p)) return false;
        try {
          const res = await fetch("/api/world/fill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lng: p.lng, lat: p.lat }) });
          return res.ok && !((await res.json()) as { filled: boolean }).filled;
        } catch {
          return false;
        }
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
        if (quote.mode === "train" || quote.mode === "plane") {
          // Tickets at the ticket office, flights checked in at the desk: in, or the way there.
          const where = ticketOffice({ ...quote, then: place });
          if (where) say(where, true);
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
        if (!journeyResumed && vehiclesLoaded) {
          journeyResumed = true;
          // After a reload: draw the current step again (not while a vehicle waits at the roadside for fuel: that way first).
          if (!ride && !strandedVehicle()) beginStep();
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
        const raw = data as { now: string; current: RawItem | null; hunt?: boolean; restUntil?: string; riding?: boolean } | null;
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
        lamp = { current, inHunt: raw.hunt !== false, restUntil: raw.restUntil ? Date.parse(raw.restUntil) + skew : undefined, riding: !!raw.riding };
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
        // On a bus, train, plane or taxi the lamp rests (it can't send you anywhere); it looks again once you're off.
        if (ride) {
          if (lamp?.current) {
            lamp = { ...lamp, current: null };
            showLamp();
          }
          return;
        }
        if (lampStale || now - lampAt > 30_000) {
          lampStale = false;
          void refreshLamp();
        } else if (now - lampShownAt > 1000) {
          lampShownAt = now;
          showLamp();
        }
      }

      // ---- Repair shops: a broken-down vehicle is walked into a shop nearby (RepairScene) ----
      type RepairJson = Omit<RepairJob, "readyAt"> & { readyAt: string | null; now: string };
      let repairs: RepairJob[] = [];
      const repairMarkers = new Map<number, import("@/game/ThreeMapLayer").MapEntity[]>();
      let lastRepairCheck = 0;
      const toJob = (j: RepairJson): RepairJob => ({
        id: j.id,
        kind: j.kind,
        shop: j.shop,
        keeper: j.keeper,
        lng: j.lng,
        lat: j.lat,
        price: j.price,
        waitS: j.waitS,
        readyAt: j.readyAt ? Date.parse(j.readyAt) + (Date.now() - Date.parse(j.now)) : null,
      });

      /** The shops on the map: the keeper, a sign, and vehicles waiting outside. */
      function showRepairs() {
        for (const [id, entities] of repairMarkers) {
          if (repairs.some((j) => j.id === id)) continue;
          for (const e of entities) layer.remove(e);
          repairMarkers.delete(id);
        }
        for (const j of repairs) {
          if (repairMarkers.has(j.id) || !network) continue; // (placed at the kerb once the roads are known)
          const { origin } = shopPlacement(j);
          const keeper = models.buildAvatar(keeperLook(j.keeper));
          keeper.root.add(layer.billboard(models.makeNameplate(j.kind === "bicycle" ? "BICYCLE REPAIRS" : "MECHANIC", "#B8322A")));
          const k = 1.6 * layer.enlargement();
          const east = (m: number) => origin.lng + (m * k) / (111320 * Math.cos((origin.lat * Math.PI) / 180));
          repairMarkers.set(j.id, [
            layer.add({ object: keeper.root, lng: origin.lng, lat: origin.lat, heading: 0 }),
            layer.add({ object: models.makeVehicleModel(j.kind === "bicycle" ? "bicycle" : "motorbike"), lng: east(1), lat: origin.lat, heading: 0 }),
            layer.add({ object: models.makeVehicleModel(j.kind === "bicycle" ? "bicycle" : "car"), lng: east(-1.3), lat: origin.lat, heading: 0.4 }),
          ]);
        }
      }

      // ---- In-world scenes (owner, 18 Oct 2026: "not a modal; an open-roof building where we can see inside, and
      // the user interacts depending on the event"). Going into a place happens on the map: it stands at the kerb
      // with no roof (a repair shop, a buka, a petrol station's forecourt, a hospital ward, a renter's spot), the
      // camera glides down to look in, the hunter walks in; what they say floats over their heads and the replies
      // sit in a strip at the bottom (EventScene's world mode). What happens inside follows the event (the scene
      // tells the map: SceneMoment). The people inside are drawn bigger than on the street.
      const SCENE_SCALE = 1.7;
      const SCENE_ZOOM = 19.3;
      const SCENE_PITCH = 48;
      const SCENE_PAD = small ? 190 : 150; // the reply strip's height: the place sits above it
      type PlaceKind = "repair" | "meal" | "fuel" | "ward" | "roadside" | "hire" | "road" | "ticket" | "quiz" | "trial" | "vault" | "pump" | "service" | "flat";
      type Walker = {
        av: ReturnType<typeof models.buildAvatar>;
        x: number;
        z: number;
        tx: number;
        tz: number;
        face: number;
        /** Sitting on a bench (its height), lying on a bed, or riding off. */
        seat: number | null;
        lying: boolean;
        riding: VehicleKind | null;
      };
      type InWorld = {
        kind: PlaceKind;
        spots: import("@/game/models3d").PlaceSpots;
        entity: import("@/game/ThreeMapLayer").MapEntity;
        keeper: Walker;
        you: Walker;
        facing: number;
        opened: number;
        closing: number | null;
        cam: { lng: number; lat: number; bearing: number; zoom: number; pitch: number };
        /** Things on the street that are inside now (the shop's keeper, the renter): hidden until you leave. */
        hidden: import("@/game/ThreeMapLayer").MapEntity[];
        /** The scene's own state in React, cleared as you walk out. */
        closeScene: () => void;
        job?: RepairJob;
        vehicle?: import("three").Object3D;
        sparkles?: import("three").Object3D;
        buka?: ReturnType<typeof models.makeOpenBuka>;
        hall?: ReturnType<typeof models.makeTicketHall>;
        shrine?: ReturnType<typeof models.makeLampShrine>;
        circle?: ReturnType<typeof models.makeKeyScene>;
        vault?: ReturnType<typeof models.makeDjinnVault>;
        vulcanizer?: ReturnType<typeof models.makeVulcanizer>;
        star?: import("three").Object3D;
        terminal?: ReturnType<typeof models.makeTerminal>;
        /** When the bag went on the scale (check-in). */
        bagAt?: number;
        petrol?: ReturnType<typeof models.makeOpenPetrol>;
        /** Flashing lights (the patrol van's). */
        lights?: import("three").Object3D[];
        /** The latest moment the scene told the map about. */
        moment: SceneMoment | null;
        servedAt: number;
        /** The reply strip's height, as the camera keeps the place above it. */
        pad: number;
      };
      let inWorld: InWorld | null = null;

      /** A spot inside (model units) on the map, at the place's current size. */
      function insideAt(w: InWorld, x: number, z: number) {
        const s = layer.enlargement() * (w.entity.scaleBy ?? 1);
        const f = w.facing;
        const east = (x * Math.cos(f) + z * Math.sin(f)) * s;
        const south = (-x * Math.sin(f) + z * Math.cos(f)) * s;
        return {
          lng: w.entity.lng + east / (111320 * Math.cos((w.entity.lat * Math.PI) / 180)),
          lat: w.entity.lat - south / 110574,
          metresPerUnit: s,
        };
      }

      /**
       * Where a place stands: at the kerb of the road nearest its spot (`kerbM` from the road's middle), its
       * doorway to the street. Worked out once the roads are known, then kept.
       */
      const placements = new Map<string, { origin: LngLat; facing: number; door: LngLat; net: unknown }>();
      let cutOff: { net: unknown; edges: Uint8Array } | null = null;
      const cutOffOf = (net: NonNullable<typeof network>) => {
        if (cutOff?.net !== net) cutOff = { net, edges: roads.cutOffEdges(net) };
        return cutOff.edges;
      };
      function placeAtKerb(key: string, at: LngLat, kerbM = 8, withinM = 50) {
        // Kept while the roads stay the same (a place mid-scene doesn't move); worked out again on new roads (the
        // first ones, from the map tiles while our own load, can put it on the wrong road).
        const known = placements.get(key);
        if (known && (known.net === network || inWorld)) return known;
        // On a road the hunter can reach: never a cut-off pocket (an airfield's own roads, a fenced yard).
        const rp = network ? roads.snapToNetwork(network, at, 0, cutOffOf(network)) : null;
        const road = network && rp ? roads.positionOf(network, rp) : null;
        if (!road || geo.distanceM([road.lng, road.lat], [at.lng, at.lat]) > withinM) {
          return { origin: at, facing: geo.headingOf([at.lng, at.lat], [traveller.pos.lng, traveller.pos.lat]), door: at };
        }
        const right = besideBus(road, road.heading, 1, 0);
        const side = (right.lng - road.lng) * (at.lng - road.lng) + (right.lat - road.lat) * (at.lat - road.lat) < 0 ? -1 : 1;
        const origin = besideBus(road, road.heading, side * kerbM, 0);
        const placed = { origin, facing: geo.headingOf([origin.lng, origin.lat], [road.lng, road.lat]), door: { lng: road.lng, lat: road.lat }, net: network as unknown };
        placements.set(key, placed);
        return placed;
      }
      const shopPlacement = (job: RepairJob) => placeAtKerb(`repair:${job.id}`, { lng: job.lng, lat: job.lat });

      /** Into a place on the map: it grows in at the kerb, the camera looks in, the people take their places. */
      function openPlace(o: {
        kind: PlaceKind;
        key: string;
        at: LngLat;
        group: import("three").Object3D;
        spots: import("@/game/models3d").PlaceSpots;
        keeper: { look: AvatarLook; at: { x: number; z: number } };
        /** Where you appear, and where you go first. */
        you: { from: { x: number; z: number }; to: { x: number; z: number }; lying?: boolean };
        hidden?: import("@/game/ThreeMapLayer").MapEntity[];
        kerbM?: number;
        withinM?: number;
        closeScene: () => void;
        extra?: Partial<InWorld>;
      }) {
        if (inWorld || ride) return false;
        const { origin, facing } = placeAtKerb(o.key, o.at, o.kerbM, o.withinM);
        const walker = (look: AvatarLook, spot: { x: number; z: number }, face: number): Walker => {
          const av = models.buildAvatar(look);
          av.root.position.set(spot.x, 0.14, spot.z);
          av.root.rotation.y = face;
          o.group.add(av.root);
          return { av, x: spot.x, z: spot.z, tx: spot.x, tz: spot.z, face, seat: null, lying: false, riding: null };
        };
        const keeper = walker(o.keeper.look, o.keeper.at, 0);
        const you = walker(JSON.parse(lookKey) as AvatarLook, o.you.from, Math.PI);
        you.tx = o.you.to.x;
        you.tz = o.you.to.z;
        you.lying = !!o.you.lying;
        const entity = layer.add({ object: o.group, lng: origin.lng, lat: origin.lat, heading: facing, scaleBy: 0.01 });
        inWorld = {
          kind: o.kind,
          spots: o.spots,
          entity,
          keeper,
          you,
          facing,
          opened: performance.now(),
          closing: null,
          cam: { lng: traveller.pos.lng, lat: traveller.pos.lat, bearing: camBearing, zoom: map.getZoom(), pitch: map.getPitch() },
          hidden: o.hidden ?? [],
          closeScene: o.closeScene,
          moment: null,
          servedAt: 0,
          pad: SCENE_PAD,
          ...o.extra,
        };
        for (const e of inWorld.hidden) e.object.visible = false;
        me.object.visible = false; // you're the one inside
        traveller.v = 0;
        controls.current.go = false;
        touchGo = false;
        map.setMaxZoom(20);
        setInside(o.kind);
        return true;
      }

      function openShopScene(job: RepairJob) {
        if (inWorld || ride || visit) return;
        const group = models.makeOpenShop(job.kind === "bicycle" ? "bicycle" : "workshop", job.shop); // the people go in it too
        const S = models.SHOP_SPOTS;
        const returning = !!job.readyAt;
        const vehicle = models.makeVehicleModel(job.kind);
        vehicle.rotation.y = Math.PI / 2;
        vehicle.position.set(returning ? S.stand.x : S.outside.x + 1.4, 0.14, returning ? S.stand.z : S.outside.z);
        group.add(vehicle);
        const sparkles = models.makeSparkles();
        sparkles.position.set(S.stand.x, 0.14, S.stand.z);
        sparkles.visible = false;
        group.add(sparkles);
        const opened = openPlace({
          kind: "repair",
          key: `repair:${job.id}`,
          at: { lng: job.lng, lat: job.lat },
          group,
          spots: { ...S },
          keeper: { look: keeperLook(job.keeper), at: returning && job.readyAt! > Date.now() ? S.work : S.keeper },
          you: { from: S.outside, to: S.customer },
          hidden: repairMarkers.get(job.id) ?? [],
          closeScene: () => setRepairOpen(null),
          extra: { job, vehicle, sparkles },
        });
        if (opened) setRepairOpen(job);
      }

      /** Sitting down at a buka: the cook at the pots, the menu on the wall; you go to the bench. */
      function openMealPlace(offer: MealOffer, menu: string[], at: LngLat) {
        const S = models.BUKA_SPOTS;
        const buka = models.makeOpenBuka(offer.place === "Place to eat" ? "Buka" : offer.place, menu);
        return openPlace({
          kind: "meal",
          key: `meal:${offer.id}`,
          at,
          group: buka.group,
          spots: S,
          keeper: { look: keeperLook(offer.cook), at: S.keeper },
          you: { from: S.outside, to: { x: S.seat!.x, z: S.seat!.z } },
          closeScene: () => setMealOpen(null),
          extra: { buka },
        });
      }

      /** At the pump: your vehicle alongside it, the attendant by the kiosk; you step out to talk. */
      function openFuelPlace(offer: FuelOffer, at: LngLat, id: number) {
        const S = models.FUEL_SPOTS;
        const petrol = models.makeOpenPetrol(offer.station === "Petrol station" ? "Petrol" : offer.station);
        // The vehicle at the pump; or, when it stands at the roadside out of fuel, the jerry can the attendant fills.
        const vehicle = offer.stranded ? models.makeJerryCan() : models.makeVehicleModel(offer.kind);
        if (offer.stranded) vehicle.scale.setScalar(2.2);
        vehicle.position.set(S.stand.x, offer.stranded ? 0.5 : 0.1, S.stand.z);
        petrol.group.add(vehicle);
        return openPlace({
          kind: "fuel",
          key: `fuel:${id}`,
          at,
          group: petrol.group,
          spots: S,
          kerbM: 10,
          keeper: { look: { ...keeperLook(offer.attendant), topColour: "#1E9E62", extra: "cap" }, at: S.keeper },
          you: { from: { x: S.stand.x + 1.3, z: S.stand.z }, to: S.customer },
          closeScene: () => {
            setFuelOpen(null);
            adviseCarryBack();
          },
          extra: { petrol, vehicle },
        });
      }

      /** Waking up: on the ward's bed with the nurse beside it, or on the ground with the paramedic and the ambulance. */
      function openWardPlace(d: Discharge, at: LngLat) {
        const ward = !!d.hospital;
        const S = ward ? models.WARD_SPOTS : models.ROADSIDE_SPOTS;
        const look = ward
          ? { ...keeperLook(d.nurse), hair: "bun" as const, topColour: "#F4F1EA", bottomsColour: "#F4F1EA", extra: "none" as const }
          : { ...keeperLook(d.nurse), topColour: "#1E9E62", bottomsColour: "#1E9E62", extra: "cap" as const };
        return openPlace({
          kind: ward ? "ward" : "roadside",
          key: `ward:${at.lng.toFixed(5)},${at.lat.toFixed(5)}`,
          at,
          group: ward ? models.makeOpenWard(d.hospital === "Hospital" ? "Hospital" : d.hospital!) : models.makeRoadsideCare(),
          spots: S,
          kerbM: ward ? 8 : 5,
          keeper: { look, at: S.keeper },
          you: { from: S.stand, to: S.customer, lying: true },
          closeScene: () => setDischarge(null),
        });
      }

      /** The renter's spot in the side street: the renter under the umbrella, your ride on its stand. */
      function openHirePlace(offer: RentalOffer, at: LngLat, hidden: import("@/game/ThreeMapLayer").MapEntity[]) {
        const S = models.HIRE_SPOTS;
        const group = models.makeHireStand(offer.kind);
        const vehicle = models.makeVehicleModel(offer.kind);
        vehicle.userData.kind = offer.kind; // what you ride off on
        vehicle.rotation.y = Math.PI / 2;
        vehicle.position.set(S.stand.x, 0, S.stand.z);
        group.add(vehicle);
        return openPlace({
          kind: "hire",
          key: `hire:${at.lng.toFixed(5)},${at.lat.toFixed(5)}`,
          at,
          group,
          spots: S,
          kerbM: 5,
          keeper: { look: keeperLook(offer.renter), at: S.keeper },
          you: { from: S.outside, to: S.customer },
          hidden,
          closeScene: () => setRentOpen(null),
          extra: { vehicle },
        });
      }

      /**
       * Stopped on the road (a checkpoint, a stranded traveller, a seller's stall): the scene at the kerb where you
       * are, your vehicle in the road beside it; you step off to talk.
       */
      function openRoadPlace(e: RoadEvent) {
        const S = models.ROAD_EVENT_SPOTS;
        let group: import("three").Object3D;
        let lights: import("three").Object3D[] | undefined;
        if (e.kind === "checkpoint") {
          const c = models.makeCheckpointScene();
          group = c.group;
          lights = c.lights;
        } else if (e.kind === "seller" && e.game) group = models.makeGameTable(e.game.type);
        else if (e.kind === "seller") group = models.makeStallScene(`${e.npc}'s snacks`);
        else group = models.makeTravellerScene();
        const riding = traveller.mode === "walk" ? null : (traveller.mode as VehicleKind);
        if (riding) {
          const vehicle = models.makeVehicleModel(riding);
          vehicle.rotation.y = Math.PI / 2; // along the road
          vehicle.position.set(S.stand.x, 0, S.stand.z);
          group.add(vehicle);
        }
        const look = e.kind === "checkpoint" ? OFFICER : e.kind === "seller" ? keeperLook(e.npc) : lookForId(`traveller:${e.npc}`);
        return openPlace({
          kind: "road",
          key: `road:${e.id}`,
          at: { ...traveller.pos },
          group,
          spots: S,
          kerbM: 6,
          keeper: { look, at: S.keeper },
          you: { from: riding ? { x: S.stand.x - 1.2, z: S.stand.z } : S.outside, to: S.customer },
          closeScene: () => {
            roadDone();
            setRoadEvent(null);
          },
          extra: { lights },
        });
      }

      // ---- Tickets and check-in (owner, 18 Oct 2026: "for trains, the user must go and purchase the ticket; at the
      // airport, the user must go and check in"). A station's ticket office stands at the road nearest the station
      // (within the 150 m the server allows), an airport's terminal at the road nearest it (within its 2 km).
      const TICKET_AT_M = 30;
      let pendingTicket: TransitQuote | null = null; // chosen in the travel panel, to buy at the office
      const boards = new Map<number, string[]>(); // each station's or airport's departures, for its board
      /** The desk the server knows (it insists on it), else the road nearest the stop. */
      const deskOf = (st: TransitStop) =>
        st.desk_lng != null && st.desk_lat != null
          ? { at: { lng: st.desk_lng, lat: st.desk_lat }, withinM: 60 }
          : { at: { lng: st.lng, lat: st.lat }, withinM: st.kind === "plane" ? 1900 : 140 };
      const ticketDoor = (st: TransitStop) => {
        const d = deskOf(st);
        return placeAtKerb(`ticket:${st.id}`, d.at, 9, d.withinM);
      };

      function openTicketPlace(st: TransitStop, quote: TransitQuote | null) {
        if (st.kind !== "train" && st.kind !== "plane") return;
        const plane = st.kind === "plane";
        const S = plane ? models.TERMINAL_SPOTS : models.TICKET_SPOTS;
        const clerk = nameFor("clerk", String(st.id));
        // The departures board: the trip chosen, then where else the line or airport goes (looked up as you approach).
        const board = [...(quote ? [quote.label] : []), ...(boards.get(st.id) ?? []).filter((r) => r !== quote?.label)].slice(0, 5);
        const hall = plane ? null : models.makeTicketHall(st.name, board);
        const terminal = plane ? models.makeTerminal(`${st.name}${st.code ? ` (${st.code})` : ""}`, board) : null;
        const opened = openPlace({
          kind: "ticket",
          key: `ticket:${st.id}`,
          at: deskOf(st).at,
          withinM: deskOf(st).withinM,
          kerbM: 9,
          group: (hall ?? terminal)!.group,
          spots: S,
          keeper: { look: { ...keeperLook(clerk), topColour: plane ? "#2F6FEB" : "#1E9E62", extra: "none" }, at: S.keeper },
          you: { from: S.outside, to: S.customer },
          closeScene: () => setTicketOpen(null),
          extra: { hall: hall ?? undefined, terminal: terminal ?? undefined },
        });
        if (!opened) return;
        pendingTicket = null;
        setTicketOpen({ stop: st, clerk, quote });
      }

      /** At a ticket office or check-in desk's door: the button to go in. */
      let lastTicketCheck = 0;
      // At a station (owner, 19 Oct 2026: "the buy ticket for train… not showing a scene or anything when I got to the
      // ticket location"): the button shows as soon as the server counts you at the station, with how far the office
      // door is, and a "TICKETS" sign hangs over the door so you can see where it is.
      let ticketSign: { id: number; entity: import("@/game/ThreeMapLayer").MapEntity } | null = null;
      function showTicketSign(st: TransitStop | null, door: LngLat | null) {
        if (ticketSign && (!st || ticketSign.id !== st.id)) {
          layer.remove(ticketSign.entity);
          ticketSign = null;
        }
        if (!st || !door) return;
        if (ticketSign) {
          ticketSign.entity.lng = door.lng;
          ticketSign.entity.lat = door.lat;
          return;
        }
        const group = models.makeSignPost();
        const plate = layer.billboard(models.makeNameplate(st.kind === "plane" ? "🛫 CHECK-IN" : "🎫 TICKETS", "#1E9E62"));
        plate.position.y = 5;
        plate.scale.setScalar(1.6);
        group.add(plate);
        ticketSign = { id: st.id, entity: layer.add({ object: group, lng: door.lng, lat: door.lat }) };
      }
      function ticketTick(now: number) {
        if (now - lastTicketCheck < 500) return;
        lastTicketCheck = now;
        let here: { kind: "train" | "plane"; name: string; away: number } | null = null;
        let station: TransitStop | null = null;
        let at: LngLat | null = null;
        if (!ride && !visit && !inWorld && network && near) {
          for (const st of near.here) {
            if (st.kind !== "train" && st.kind !== "plane") continue;
            const { door } = ticketDoor(st);
            const away = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [door.lng, door.lat]);
            here = { kind: st.kind, name: st.kind === "plane" ? st.name : `${st.name} station`, away: away <= TICKET_AT_M ? 0 : Math.round(away / 10) * 10 };
            station = st;
            at = door;
            if (!boards.has(st.id)) {
              boards.set(st.id, []);
              const id = st.id;
              void supabase.rpc("transit_destinations", { p_stop: id }).then(({ data }) => {
                boards.set(id, ((data ?? []) as { name: string }[]).map((d) => d.name));
              });
            }
            break;
          }
        }
        showTicketSign(inWorld ? null : station, at);
        setHud((h) => (JSON.stringify(h.ticketHere) === JSON.stringify(here) ? h : { ...h, ticketHere: here }));
      }

      /**
       * The gold button: into the ticket office (with the trip chosen in the travel panel, if it's from here). A few
       * steps from its door you walk straight in; further, the way to it is drawn.
       */
      function enterTicket() {
        const st = near?.here.find((s) => s.kind === "train" || s.kind === "plane");
        if (!st) return;
        const { door } = ticketDoor(st);
        const away = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [door.lng, door.lat]);
        const quote = pendingTicket?.from.id === st.id ? pendingTicket : null;
        if (away <= TICKET_AT_M) {
          openTicketPlace(st, quote);
          return;
        }
        const office = st.kind === "plane" ? `${st.name}'s check-in` : `${st.name} station's ticket office`;
        if (away <= 110 && !ride && !visit) {
          // Walk over to the door and in (the server is told where you are first: it checks you're at the desk).
          traveller.pos = { lng: door.lng, lat: door.lat };
          traveller.v = 0;
          if (network) onRoad = roads.snapToNetwork(network, traveller.pos, traveller.heading);
          void savePosition(true).then(() => openTicketPlace(st, quote));
          return;
        }
        void planDirections({ lng: door.lng, lat: door.lat }, office);
        say(`${office[0].toUpperCase()}${office.slice(1)} is ${geo.formatDistance(away)} away: follow the line to the green sign.`, true);
      }

      /** From the travel panel: go in if at the door, else the way to it. */
      function ticketOffice(quote: TransitQuote): string | null {
        const st = quote.from;
        const { door } = ticketDoor(st);
        const away = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [door.lng, door.lat]);
        const office = st.kind === "plane" ? `${st.name}'s check-in desk` : `${st.name} station's ticket office`;
        if (away <= TICKET_AT_M) {
          setTransitOpen(false);
          openTicketPlace(st, quote);
          return null;
        }
        pendingTicket = quote;
        void planDirections(door, office, true);
        return `${st.kind === "plane" ? "Check in" : "Buy your ticket"} at ${office}, ${geo.formatDistance(away)} away: follow the blue line, then tap ${st.kind === "plane" ? "🛫 Check in" : "🎫 Ticket office"}.`;
      }

      setTicketActions({
        destinations: async (stop) => {
          const { data } = await supabase.rpc("transit_destinations", { p_stop: stop.id });
          return (data ?? []) as import("@/game/transit").TransitDestination[];
        },
        quoteTo: (stop, to) => quoteTo(stop, to),
        board: (quote) => board(quote, false),
        elsewhere: () => {
          closePlace();
          setTransitOpen(true);
        },
      });

      /** A landmark's plaza (the guide by the star) or the Lamp's spot (the messenger by the glowing lamp), where you stand. */
      function openQuizPlace(kind: "landmark" | "detour", name: string, host: AvatarLook) {
        if (!network) return false;
        const S = models.PLAZA_SPOTS;
        const plaza = kind === "landmark" ? models.makeLandmarkPlaza(name) : null;
        const shrine = kind === "detour" ? models.makeLampShrine() : null;
        return openPlace({
          kind: "quiz",
          key: `quiz:${kind}:${traveller.pos.lng.toFixed(5)},${traveller.pos.lat.toFixed(5)}`,
          at: { ...traveller.pos },
          group: (plaza ?? shrine)!.group,
          spots: S,
          kerbM: 6,
          keeper: { look: host, at: S.keeper },
          you: { from: S.outside, to: S.customer },
          closeScene: () => setQuizOpen(null),
          extra: { shrine: shrine ?? undefined, star: plaza?.star },
        });
      }

      // ---- The key's trial on the map: the Keeper of the Key by the open chest in a ring of standing stones, where
      // the chest rose; the questions in a strip (HuntPanel's KeyTrial, world mode). The Keeper raises their arms
      // at each right answer; won, they cheer a moment before you leave with the key; failed, you're thrown away.
      // Each key's place is its own scene (owner, 19 Oct 2026): a market with its market woman, a monument's plaza with a
      // guide, a beach with a fisherman… chosen for the key in /admin; the stone circle and the Keeper elsewhere.
      function openTrialPlace() {
        if (inWorld || !network) return;
        const S = models.TRIAL_SPOTS;
        const scene: KeyScene = chest?.scene ?? "circle";
        const info = KEY_SCENE_INFO[scene];
        const circle = models.makeKeyScene(scene, info.sign);
        setTrialKeeper(info.keeper.name);
        openPlace({
          kind: "trial",
          key: `trial:${traveller.pos.lng.toFixed(5)},${traveller.pos.lat.toFixed(5)}`,
          at: chest?.spot ?? { ...traveller.pos },
          group: circle.group,
          spots: S,
          kerbM: 7,
          keeper: { look: info.keeper.look, at: S.keeper },
          you: { from: S.outside, to: S.customer },
          hidden: chest ? [chest.entity] : [],
          closeScene: () => {},
          extra: { circle },
        });
      }
      function trialEvent(e: Event) {
        const { on, outcome } = (e as CustomEvent<{ on: boolean; outcome?: string }>).detail;
        if (on) return openTrialPlace();
        if (inWorld?.kind !== "trial") return;
        if (outcome === "key" || outcome === "finished") {
          // Well done: the Keeper cheers, then you leave with the key.
          inWorld.moment = { type: "won" };
          inWorld.servedAt = performance.now();
          window.setTimeout(() => closePlace(), 1600);
        } else closePlace();
      }
      function trialStep() {
        if (inWorld?.kind !== "trial") return;
        inWorld.moment = { type: "won" };
        inWorld.servedAt = performance.now();
      }
      window.addEventListener("loota:trial", trialEvent);
      window.addEventListener("loota:trial-step", trialStep);

      // ---- The Djinn's chamber on the map: the vault at the chosen place, the Djinn hovering by its door. You go to
      // whichever room you're working on; the wheel turns, the floor's stones glow where you step, the scales tip;
      // mastered, the door swings open on the Wonder's light; failed, the whirlwind takes you.
      const DJINN: AvatarLook = { skin: "#7C4DCC", hair: "bald", hairColour: "#1B120C", top: "hoodie", topColour: "#3B1F66", bottomsColour: "#2A1747", extra: "none" };
      function openVault(chamber: DjinnChamber) {
        if (inWorld || !network) return;
        const S = models.VAULT_SPOTS;
        const vault = models.makeDjinnVault(chamber.place, chamber.cipher, chamber.floor.grid.length, chamber.floor.grid[0]?.length ?? 3);
        const opened = openPlace({
          kind: "vault",
          key: `vault:${chamber.id}`,
          at: { ...traveller.pos },
          group: vault.group,
          spots: S,
          kerbM: 8,
          keeper: { look: DJINN, at: S.keeper },
          you: { from: S.outside, to: S.rooms[0] },
          closeScene: () => setDjinnOpen(null),
          extra: { vault },
        });
        const w = inWorld as InWorld | null;
        if (opened && w) w.keeper.av.root.scale.setScalar(1.6); // bigger than life
      }

      /** A flat by the roadside: your motorbike or car where it stopped, the spare and toolbox on the kerb, a roadside mechanic. */
      function openFlatPlace(offer: FlatOffer, v: VehicleRow) {
        const S = models.ROAD_EVENT_SPOTS;
        const group = models.makeFlatScene();
        const vehicle = models.makeVehicleModel(offer.kind);
        vehicle.rotation.y = Math.PI / 2; // along the road
        vehicle.position.set(S.stand.x, 0, S.stand.z);
        group.add(vehicle);
        return openPlace({
          kind: "flat",
          key: `flat:${v.kind}`,
          at: { ...traveller.pos },
          group,
          spots: S,
          kerbM: 6,
          keeper: { look: { ...keeperLook(offer.mechanic), topColour: "#4A5A3A", extra: "cap" }, at: S.keeper },
          you: { from: S.outside, to: S.customer },
          closeScene: () => setFlatOpen(null),
        });
      }

      /** At the vulcanizer's: your bicycle on the stand, the compressor, the vulcanizer. */
      function openPumpPlace(offer: PumpOffer, spot: LngLat & { id: number }) {
        const S = models.VULCANIZER_SPOTS;
        const v = models.makeVulcanizer(offer.place.length > 22 ? local("Vulcanizer", "Tyre shop") : offer.place);
        const bike = models.makeVehicleModel("bicycle");
        bike.rotation.y = Math.PI / 2;
        bike.position.set(S.stand.x, 0.1, S.stand.z);
        v.group.add(bike);
        return openPlace({
          kind: "pump",
          key: `pump:${spot.id}`,
          at: spot,
          group: v.group,
          spots: S,
          kerbM: 6,
          keeper: { look: { ...keeperLook(offer.keeper), topColour: "#5B4636", extra: "cap" }, at: S.keeper },
          you: { from: S.outside, to: S.customer },
          closeScene: () => setPumpOpen(null),
          extra: { vulcanizer: v, vehicle: bike },
        });
      }

      /** At the mechanic's: the open workshop, your motorbike or car on the stand, the mechanic at the engine. */
      function openServicePlace(offer: ServiceOffer, spot: LngLat & { id: number }) {
        const S = models.SHOP_SPOTS;
        const group = models.makeOpenShop("workshop", offer.place.length > 22 ? "Mechanic" : offer.place);
        const vehicle = models.makeVehicleModel(offer.kind);
        vehicle.rotation.y = Math.PI / 2;
        vehicle.position.set(S.stand.x, 0.14, S.stand.z);
        group.add(vehicle);
        const sparkles = models.makeSparkles();
        sparkles.position.set(S.stand.x, 0.14, S.stand.z);
        sparkles.visible = false;
        group.add(sparkles);
        return openPlace({
          kind: "service",
          key: `service:${spot.id}`,
          at: spot,
          group,
          spots: { ...S },
          keeper: { look: { ...keeperLook(offer.mechanic), topColour: "#2F4A6E", extra: "cap" }, at: S.keeper },
          you: { from: S.outside, to: S.customer },
          closeScene: () => setServiceOpen(null),
          extra: { vehicle, sparkles },
        });
      }

      /** Walk out: back to the street (riding, if you rented), the camera rises, the place folds away. */
      function closePlace() {
        const w = inWorld;
        if (!w || w.closing !== null) return;
        w.closing = performance.now();
        w.you.seat = null;
        w.you.lying = false;
        w.you.tx = w.spots.outside.x;
        w.you.tz = w.spots.outside.z;
        w.closeScene();
      }

      function endPlace() {
        const w = inWorld;
        if (!w) return;
        layer.remove(w.entity);
        for (const e of w.hidden) e.object.visible = true;
        me.object.visible = true;
        inWorld = null;
        map.setMaxZoom(GAME_ZOOM);
        map.setPadding(chasePad());
        setInside(null);
        for (const el of document.querySelectorAll<HTMLElement>("[data-bubble]")) el.style.visibility = "hidden";
      }

      /** What the scene says is happening (the plate served, the fuel going in, the bike rented). */
      function sceneMoment(m: SceneMoment) {
        const w = inWorld;
        if (!w) return;
        w.moment = m;
        if (m.type === "served") {
          w.servedAt = performance.now();
          w.buka?.plate(null, { base: m.base, side: m.side });
        }
        if (m.type === "plate") w.buka?.plate(m.state);
        if (m.type === "meter") w.petrol?.meter(m.n);
        if (m.type === "ticket") w.hall?.ticket(true);
        if (w.vault) {
          if (m.type === "room") {
            const to = models.VAULT_SPOTS.rooms[m.n] ?? models.VAULT_SPOTS.rooms[0];
            w.you.tx = to.x;
            w.you.tz = to.z;
          }
          if (m.type === "cipher") w.vault.wheel(m.shift);
          if (m.type === "path") w.vault.path(m.path);
          if (m.type === "scales") w.vault.scales(m.stones, m.tilt);
          if (m.type === "won") w.vault.open();
          if (m.type === "whirlwind") w.servedAt = performance.now();
        }
        if (m.type === "won") {
          w.shrine?.reward(true);
          w.servedAt = performance.now(); // (the moment of winning: the host cheers)
        }
        if (m.type === "bag") w.bagAt = performance.now();
        if (m.type === "rented") {
          w.you.tx = w.spots.stand.x + 0.2;
          w.you.tz = w.spots.stand.z;
        }
      }

      const ease = (k: number) => k * k * (3 - 2 * k);

      /** One frame inside: the place growing in, people walking, sitting and working, the camera, the bubbles. */
      function placeStep(now: number, dt: number, t: number) {
        const w = inWorld!;
        const S = w.spots;
        const opening = ease(Math.min(1, (now - w.opened) / 1400));
        const leaving = w.closing === null ? 0 : ease(Math.min(1, (now - w.closing) / 1600));
        w.entity.scaleBy = SCENE_SCALE * Math.max(0.01, ease(Math.min(1, (now - w.opened) / 700)) * (1 - ease(Math.max(0, (leaving - 0.6) / 0.4))));
        const m = w.moment;

        // Where the keeper goes, by the event.
        let keeperSpot: { x: number; z: number } = S.keeper;
        let working = false;
        if (w.kind === "repair" && w.job) {
          const ready = !!w.job.readyAt && Date.now() >= w.job.readyAt;
          working = !!w.job.readyAt && !ready;
          if (working) keeperSpot = S.work;
        } else if (w.kind === "meal" && m?.type === "served" && now - w.servedAt < 4000) {
          keeperSpot = S.work; // bringing the plate to the table
        } else if (w.kind === "service" && m?.type === "pumping") {
          keeperSpot = S.work; // at the engine with a spanner
          working = true;
        } else if (w.kind === "pump" && m?.type === "pumping") {
          keeperSpot = S.work; // at the bicycle, working on the tyre
          working = true;
        } else if (w.kind === "fuel" && (m?.type === "pumping" || m?.type === "meter")) {
          keeperSpot = S.work; // at the pump, nozzle in the tank
          working = true;
        } else if ((w.kind === "ward" || w.kind === "roadside") && now - w.opened < 2600) {
          keeperSpot = { x: S.stand.x - 1.4, z: S.stand.z + 0.4 }; // by the bed while you wake
        }
        w.keeper.tx = keeperSpot.x;
        w.keeper.tz = keeperSpot.z;

        // Waking up: lying still for a moment, then up and over to talk.
        if (w.you.lying && now - w.opened > 2200 && w.closing === null) w.you.lying = false;

        const step = (p: Walker, speed: number) => {
          const dx = p.tx - p.x;
          const dz = p.tz - p.z;
          const d = Math.hypot(dx, dz);
          const still = p.lying || p.seat !== null;
          const go = still ? 0 : Math.min(d, speed * dt);
          if (d > 0.02 && !still) {
            p.x += (dx / d) * go;
            p.z += (dz / d) * go;
            p.face = Math.atan2(dx, dz);
          }
          p.av.root.position.set(p.x, 0.14 + (p.seat ?? 0) + (p.lying ? 0.75 : 0), p.z);
          p.av.root.rotation.y = p.face;
          models.animateAvatar(
            p.av,
            { mode: p.riding ?? "walk", phase: p.lying ? "fainted" : "idle", moving: d > 0.02 && !still ? 0.8 : 0, distance: go, sitting: p.seat !== null },
            dt,
            t,
          );
          return d <= 0.02;
        };
        const youThere = step(w.you, w.you.riding ? 4 : 2.6);
        const keeperThere = step(w.keeper, 2.2);

        // You: at the buka you sit down on the bench; at the renter's, you get on and ride.
        if (youThere && w.closing === null && w.kind === "meal" && S.seat && w.you.seat === null && Math.abs(w.you.x - S.seat.x) < 0.05) {
          w.you.seat = S.seat.y;
          w.you.face = 0;
        }
        if (w.kind === "hire" && m?.type === "rented" && youThere && !w.you.riding && w.vehicle) {
          w.vehicle.visible = false;
          w.you.riding = (w.vehicle.userData.kind as VehicleKind | undefined) ?? "bicycle";
          w.you.face = Math.PI / 2;
        }
        if (youThere && w.closing === null && w.you.seat === null && !w.you.lying && !w.you.riding) {
          w.you.face = Math.atan2(w.keeper.x - w.you.x, w.keeper.z - w.you.z); // talking to the keeper
        }
        if (keeperThere && !working) w.keeper.face = Math.atan2(w.you.x - w.keeper.x, w.you.z - w.keeper.z);
        if (keeperThere && working) {
          // Bent over the vehicle with a spanner, or holding the nozzle in the tank.
          w.keeper.face = Math.PI / 2;
          if (w.kind === "repair" || w.kind === "pump" || w.kind === "service") {
            w.keeper.av.rig.rotation.x = 0.45;
            w.keeper.av.armR.rotation.x = -1.4 + Math.sin(t * 9) * 0.45;
            w.keeper.av.armL.rotation.x = -1.1 + Math.sin(t * 9 + 1.5) * 0.25;
          } else {
            w.keeper.av.armR.rotation.x = -1.3;
          }
        }
        if (w.kind === "meal" && m?.type === "served" && keeperThere && keeperSpot === S.work) w.buka?.plate("full");
        if (w.kind === "service" && w.sparkles) w.sparkles.visible = m?.type === "filled"; // like new

        // The event's things.
        if (w.kind === "repair" && w.job && w.vehicle && w.sparkles) {
          const ready = !!w.job.readyAt && Date.now() >= w.job.readyAt;
          if (w.closing === null && !youThere && !w.job.readyAt) w.vehicle.position.set(w.you.x + 1.4, 0.14, w.you.z);
          else if (w.closing !== null && ready) w.vehicle.position.set(w.you.x + 1.4, 0.14, w.you.z); // you take it with you
          else w.vehicle.position.set(S.stand.x, 0.14, S.stand.z);
          w.vehicle.rotation.z = ready ? 0 : 0.28;
          w.sparkles.visible = ready && w.closing === null;
          w.sparkles.rotation.y += dt * 1.5;
        }
        if (w.petrol) w.petrol.hose.visible = keeperThere && working;
        if (w.vulcanizer && w.vehicle) {
          w.vulcanizer.running(keeperThere && working, t); // the compressor shakes while it runs
          w.vehicle.rotation.z = m?.type === "filled" ? 0 : 0.18; // leaning on the stand until done
        }
        if (w.terminal) {
          // Your bag: by you, then on the scale for a moment, then along the belt and away.
          const since = w.bagAt === undefined ? -1 : (now - w.bagAt) / 1000;
          w.terminal.bag(since < 0 ? "you" : since < 1.2 ? "scale" : since < 4.2 ? (since - 1.2) / 3 : null);
        }
        if (w.shrine) {
          // Purple smoke curling up from the lamp; the prize turning over it once won.
          w.shrine.smoke.forEach((s, i) => {
            const k = ((t * 0.45 + i * 0.25) % 1 + 1) % 1;
            s.position.y = 1.2 + k * 1.6;
            s.position.x = models.PLAZA_SPOTS.stand.x + 0.7 + Math.sin(t * 2 + i) * 0.25;
            (s.material as import("three").MeshBasicMaterial).opacity = 0.5 * (1 - k);
          });
          w.shrine.prize.rotation.y += dt * 2;
          w.shrine.prize.position.y = 1.9 + Math.sin(t * 3) * 0.12;
        }
        if (w.star) w.star.rotation.y += dt * (w.moment?.type === "won" ? 6 : 1.2);
        if (w.vault) {
          // The Djinn hovers, rising and sinking; the Wonder turns in its light once the door is open.
          w.keeper.av.root.position.y = 0.9 + Math.sin(t * 1.6) * 0.18;
          w.vault.prize.rotation.y += dt * 2;
          if (w.moment?.type === "whirlwind") {
            // The wind: you spin and lift off the cursed floor.
            w.you.face += dt * 14;
            w.you.av.root.rotation.y = w.you.face;
            w.you.av.root.position.y = 0.14 + Math.min(3, ((now - w.servedAt) / 1000) * 1.5);
          }
        }
        if (w.circle) {
          // Torches flicker; the key's light breathes over the chest.
          w.circle.flames.forEach((f, i) => f.scale.set(1, 0.8 + 0.35 * Math.abs(Math.sin(t * 9 + i * 1.7)), 1));
          (w.circle.glow.material as import("three").MeshBasicMaterial).opacity = 0.18 + 0.1 * Math.sin(t * 2.4);
        }
        if ((w.kind === "quiz" || w.kind === "trial" || w.kind === "vault") && w.moment?.type === "won" && keeperThere && now - w.servedAt < 1800) {
          w.keeper.av.armL.rotation.x = w.keeper.av.armR.rotation.x = -Math.PI; // hands up: well done!
        }
        if (w.lights) w.lights.forEach((l, i) => (l.visible = Math.floor(t * 4 + i) % 2 === 0)); // the patrol van's lights
        if (w.buka) {
          w.buka.steam.forEach((s, i) => {
            const k = ((t * 0.6 + i * 0.33) % 1 + 1) % 1;
            s.position.y = 1.6 + k * 1.2;
            (s.material as import("three").MeshBasicMaterial).opacity = 0.6 * (1 - k);
          });
        }

        // The camera: down from the street to look in from the doorway, and back up again on leaving; the place
        // sits above the reply strip, however tall its words make it.
        const strip = document.querySelector<HTMLElement>("[data-scene-strip]")?.offsetHeight;
        if (strip) w.pad += (strip - w.pad) * Math.min(1, 4 * dt);
        const k = w.closing === null ? opening : 1 - leaving;
        // Looking a little past the middle, so the place sits low above the replies; under a tall sheet (the chamber's
        // rooms), nearer the middle, or its far end goes under the status bar.
        const centre = insideAt(w, 0, -S.depth * (w.pad > 320 ? 0.48 : 0.62));
        const back = { lng: traveller.pos.lng, lat: traveller.pos.lat };
        const target = geo.compassFromHeading(w.facing + Math.PI);
        const turn = ((target - w.cam.bearing) % 360 + 540) % 360 - 180;
        map.jumpTo({
          center: [back.lng + (centre.lng - back.lng) * k, back.lat + (centre.lat - back.lat) * k],
          bearing: w.cam.bearing + turn * k,
          zoom: w.cam.zoom + (SCENE_ZOOM - w.cam.zoom) * k,
          pitch: w.cam.pitch + (SCENE_PITCH - w.cam.pitch) * k,
          padding: { top: chasePad().top * (1 - k), left: 0, right: 0, bottom: w.pad * k },
        });
        if (w.closing !== null) camBearing = w.cam.bearing + turn * k;

        // The bubbles over their heads (lower when sitting or lying).
        const bubble = (sel: string, p: Walker) => {
          const el = document.querySelector<HTMLElement>(`[data-bubble="${sel}"]`);
          if (!el) return;
          const spot = insideAt(w, p.x, p.z);
          const head = p.lying ? 1.5 : p.seat !== null ? 2.6 : 3.1;
          const screen = layer.screenOf(spot.lng, spot.lat, head * spot.metresPerUnit);
          if (!screen || w.closing !== null) {
            el.style.visibility = "hidden";
            return;
          }
          // Over their head, kept on screen (below the status chips).
          const half = el.offsetWidth / 2 + 8;
          el.style.left = `${Math.max(half, Math.min(window.innerWidth - half, screen.x))}px`;
          el.style.top = `${Math.max(el.offsetHeight + 100, screen.y)}px`;
          el.style.visibility = "visible";
        };
        bubble("them", w.keeper);
        bubble("you", w.you);

        if (w.closing !== null && leaving >= 1) endPlace();
      }

      async function refreshRepairs() {
        const { data } = await supabase.rpc("my_repairs");
        if (disposed) return;
        repairs = ((data ?? []) as RepairJson[]).map(toJob);
        showRepairs();
      }

      /** Find (or recall) the repair shop for a broken-down vehicle, and point the way (drawn, if `route`). */
      async function findRepairShop(kind: VehicleKind, route: boolean) {
        await savePosition();
        const { data } = await supabase.rpc("repair_shop", { p_kind: kind });
        const r = data as { ok: boolean; reason?: string; job?: RepairJson } | null;
        if (disposed || !r?.ok || !r.job) return;
        const job = toJob(r.job);
        await refreshRepairs();
        const away = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [job.lng, job.lat]);
        if (route) void planDirections({ lng: job.lng, lat: job.lat }, job.shop, true);
        adviceKey = "repair";
        advicePlace = { name: job.shop, lng: job.lng, lat: job.lat };
        setHud((h) => ({
          ...h,
          advice: {
            key: "repair",
            title: `Your ${vehicleName(kind)} needs a repair`,
            where: job.shop,
            text: `${job.shop} can fix your ${vehicleName(kind)}: ${geo.formatDistance(away)} away, ${job.price} coins. ${route ? "Follow the blue line, then go in." : "Tap for the way there."}`,
            place: advicePlace,
          },
        }));
      }

      /** At a shop the player's vehicle is booked into: the Enter button. */
      function repairTick(now: number) {
        if (now - lastRepairCheck < 500) return;
        lastRepairCheck = now;
        const at: [number, number] = [traveller.pos.lng, traveller.pos.lat];
        if (repairs.length && repairs.some((j) => !repairMarkers.has(j.id))) showRepairs(); // once the roads are known
        // At the shop's door (and within the 60 m of its spot the server allows).
        const shop =
          ride || visit || inWorld
            ? null
            : (repairs.find((j) => {
                const { door } = shopPlacement(j);
                return geo.distanceM(at, [door.lng, door.lat]) <= 30 && geo.distanceM(at, [j.lng, j.lat]) <= 58;
              }) ?? null);
        setHud((h) => (h.repairHere?.id === shop?.id && h.repairHere?.readyAt === shop?.readyAt ? h : { ...h, repairHere: shop }));
      }

      setRepairActions({
        agree: async (job) => {
          await savePosition(); // the server checks you're in the shop
          const { data, error } = await supabase.rpc("repair_agree", { p_job: job.id });
          const r = data as { ok: boolean; reason?: string; job?: RepairJson; balance?: number } | null;
          if (error || !r) return "error";
          if (!r.ok || !r.job) return r.reason === "coins" ? "coins" : r.reason === "far" ? "far" : "error";
          const done = toJob(r.job);
          repairs = repairs.map((j) => (j.id === done.id ? done : j));
          if (inWorld?.job?.id === done.id) inWorld.job = done; // the keeper gets to work
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          void refreshVehicles();
          return done;
        },
        collect: async (job) => {
          const { data } = await supabase.rpc("repair_collect", { p_job: job.id });
          const r = data as { ok: boolean; kind?: VehicleKind } | null;
          if (!r?.ok) return false;
          await refreshVehicles();
          await refreshRepairs();
          clearAdvice("repair");
          if (trip && geo.distanceM([trip.to.lng, trip.to.lat], [job.lng, job.lat]) < 60) endDirections();
          say(`Your ${vehicleName(job.kind)} is back in your pocket, as good as new. Take it out with the vehicle button.`);
          return true;
        },
      });
      void refreshRepairs();

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
          if (r.outcome === "won" && (r.relic || r.item === "tyre_kit")) countRelics();
          if (r.outcome === "won" && r.item === "cruise" && r.qty) {
            cruiseTokens = Math.min(8, cruiseTokens + r.qty);
            showCruise();
          }
          lampStale = true; // done with: the next one comes
          return { outcome: r.outcome, answer: r.answer, coins: r.coins, relic: r.relic, item: r.item, qty: r.qty };
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

      // ---- A strike (owner, 19 Oct 2026: "think of Mario Kart"): a relic or Wonder used on other players. On screen a
      // thunder flash, a bolt and the item spinning off; on the map the item spinning out from the player, up and away,
      // smaller and smaller until it's gone. For the one who used it, and for everyone it reaches.
      type Flight = { entity: import("@/game/ThreeMapLayer").MapEntity; item: ReturnType<typeof models.makeSpinItem>; start: number; from: LngLat; dir: { e: number; n: number } };
      const flights: Flight[] = [];
      const FLIGHT_MS = 2800;
      let strikeTimer = 0;
      let lastStrike = 0;
      function strike(icon: string, colour: string, mine: boolean) {
        const now = performance.now();
        if (now - lastStrike < 1200) return; // one at a time
        lastStrike = now;
        cue("thunder");
        setStrikeFx({ n: Date.now(), icon });
        window.clearTimeout(strikeTimer);
        strikeTimer = window.setTimeout(() => setStrikeFx(null), 1700);
        const el = container.current;
        if (el) {
          el.classList.remove("loota-strike-shake");
          void el.offsetWidth; // restart the shake
          el.classList.add("loota-strike-shake");
        }
        // Yours flies off ahead of you; someone else's spins past you and away, off to one side.
        const h = traveller.heading + (mine ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.9));
        const item = models.makeSpinItem(icon, colour);
        const from = { ...traveller.pos };
        flights.push({ entity: layer.add({ object: item.group, lng: from.lng, lat: from.lat }), item, start: now, from, dir: { e: Math.sin(h), n: -Math.cos(h) } });
      }
      function flightsTick(now: number, dt: number) {
        for (let i = flights.length - 1; i >= 0; i--) {
          const f = flights[i];
          const p = (now - f.start) / FLIGHT_MS;
          if (p >= 1) {
            layer.remove(f.entity);
            f.item.dispose();
            flights.splice(i, 1);
            continue;
          }
          const d = 30 + 320 * p * p; // faster and faster, away
          f.entity.lng = f.from.lng + (f.dir.e * d) / (111320 * Math.cos((f.from.lat * Math.PI) / 180));
          f.entity.lat = f.from.lat + (f.dir.n * d) / 110574;
          f.item.group.position.y = 4 + 30 * Math.sin(Math.PI * Math.min(1, p * 1.1)); // up in an arc
          f.item.spin(dt, (p < 0.12 ? p / 0.12 : 1) * (1 - p) * 1.4);
        }
      }
      /** Wonders that reach other players (the rest only help their holder). */
      const STRIKES = new Set(["cataclysm_orb", "orb_of_oblivion", "orb_of_return", "eye_of_the_djinn", "hourglass_of_ages", "thiefs_hand", "djinns_bargain", "sandstorm_crown", "mirror_of_many"]);

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
        let struck = false;
        for (const e of n.events) {
          // The holder heard when they used it; a Coin that saved you is told by what it saved you from.
          if (e.mine) continue;
          if (firstLook && Date.now() - at(e.at) > 120_000) continue; // old news
          if (!struck && STRIKES.has(e.wonder)) {
            struck = true;
            strike(wonderOf(e.wonder).icon, "#9B5DE5", false);
          }
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
        if (STRIKES.has(wonder)) strike(wonderOf(wonder).icon, "#9B5DE5", true);
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

      // ---- The metal detector (a live hunt): feel for the key's heat; its chest rises out of the ground within 60 m ----
      type Pulse = {
        ok: boolean;
        reason?: string;
        inArea?: boolean;
        key?: number;
        heat?: number;
        spot?: (LngLat & { scene?: string }) | null;
        trap?: LngLat | null;
        /** At the hunter's answer, and it isn't the key's place (the riddle clock starts again). */
        wrongPlace?: string;
        /** Whether the hunter owns a metal detector. */
        detector?: boolean;
      };
      let pulseAt = -Infinity;
      let pulseEvery = 6000;
      let pulsing = false;
      let heat: { level: number; key: number; trend: "warmer" | "colder" | "steady" } | null = null;
      let chest: { entity: import("@/game/ThreeMapLayer").MapEntity; body: import("three").Object3D; ring: import("three").Object3D; spot: LngLat; key: number; born: number; scene: KeyScene } | null = null;
      let chestHere = false;
      // The Masquerade's decoy (owner, 25 Oct 2026): it rises just like the key's chest; the heat is the tell.
      let trap: { entity: import("@/game/ThreeMapLayer").MapEntity; body: import("three").Object3D; ring: import("three").Object3D; spot: LngLat; key: number; born: number } | null = null;
      let trapHere = false;
      let lastBeat = 0;
      const pulseSoon = () => {
        pulseAt = -Infinity;
      };
      const keyWon = () => {
        hideChest();
        hideTrap();
        heat = null;
        showHeat();
        setKeyFly(Date.now());
        cue("key");
        window.setTimeout(() => setKeyFly(null), 1500);
      };
      window.addEventListener("loota:hunt-changed", pulseSoon);
      window.addEventListener("loota:key-earned", keyWon);

      function showHeat() {
        const view: Hud["heat"] = heat ? { level: heat.level, trend: heat.trend, chest: chestHere, trap: trapHere && !chestHere } : null;
        setHud((h) => (JSON.stringify(h.heat) === JSON.stringify(view) ? h : { ...h, heat: view }));
      }

      function showChest(spot: LngLat & { scene?: string }, key: number) {
        if (chest && chest.key === key) return;
        hideChest();
        const model = models.makeChest();
        model.body.position.y = -1.6;
        const scene = isKeyScene(spot.scene) ? spot.scene : "circle"; // where the key is: its scene for the trial
        chest = { entity: layer.add({ object: model.group, lng: spot.lng, lat: spot.lat, heading: 0 }), body: model.body, ring: model.ring, spot, key, born: performance.now(), scene };
        say("✨ Something glints in the ground… the key's chest rises! Get to it.", true);
        cue("chest");
      }

      function hideChest() {
        if (!chest) return;
        layer.remove(chest.entity);
        chest = null;
        chestHere = false;
      }

      function showTrap(spot: LngLat, key: number) {
        if (trap && trap.key === key) return;
        hideTrap();
        const model = models.makeChest();
        model.body.position.y = -1.6;
        trap = { entity: layer.add({ object: model.group, lng: spot.lng, lat: spot.lat, heading: 0 }), body: model.body, ring: model.ring, spot, key, born: performance.now() };
        say("✨ Something glints in the ground… a chest rises! Get to it.", true); // the same words: the heat is the tell
        cue("chest");
      }

      function hideTrap() {
        if (!trap) return;
        layer.remove(trap.entity);
        trap = null;
        trapHere = false;
      }

      /** "Open the chest" at the decoy: the Masquerade springs out, takes his coins and spins the hunter about. */
      async function springTrap() {
        if (!huntId || !trap) return;
        traveller.v = 0;
        const key = trap.key;
        const { data } = await supabase.rpc("spring_trap", { p_hunt: huntId, p_lng: traveller.pos.lng, p_lat: traveller.pos.lat, p_mode: traveller.mode });
        const r = data as { ok: boolean; reason?: string; lost?: number; balance?: number; dizzyS?: number } | null;
        if (disposed || !r) return;
        if (!r.ok) {
          if (r.reason === "no_trap") hideTrap();
          else say(r.reason === "far" ? "Get closer to the chest." : "The chest won't open. Try again.", true);
          return;
        }
        saved = { ...traveller.pos };
        hideTrap();
        showHeat();
        const dizzyS = r.dizzyS ?? 15;
        stuckUntil = Infinity; // held through the Masquerade's scene, then dizzy (actions.dizzy)
        if (r.balance != null) setHud((h) => ({ ...h, coins: r.balance! }));
        setTrapFlash(true);
        window.setTimeout(() => setTrapFlash(false), 1400);
        cue("trap");
        setTrapStory({ lines: trapBeat(huntId, key, r.lost ?? 0), dizzyS });
        say(`😵 The Masquerade's trap! ${r.lost ? `-${r.lost} coins, and ` : ""}you're dizzy for ${dizzyS} s. The key's own chest rises where the heat is Burning.`, true);
      }

      async function pulse(now: number) {
        if (!huntId) return;
        pulsing = true;
        pulseAt = now;
        const { data } = await supabase.rpc("key_pulse", { p_hunt: huntId, p_lng: traveller.pos.lng, p_lat: traveller.pos.lat, p_mode: traveller.mode });
        pulsing = false;
        const p = data as Pulse | null;
        if (disposed || !p) return;
        if (!p.ok) {
          if (p.reason === "position") return; // corrected by the next save
          pulseEvery = p.reason === "trial" ? 4000 : 30000; // in a trial (at the chest), or not hunting
          if (p.reason !== "trial") {
            hideChest();
            hideTrap();
          }
          heat = null;
          showHeat();
          return;
        }
        saved = { ...traveller.pos }; // the pulse saved it
        if (p.detector) detectorRef.current = true;
        if (p.wrongPlace) {
          window.dispatchEvent(new CustomEvent("loota:wrong-place", { detail: p.wrongPlace }));
          say(`🚫 ${p.wrongPlace}: no key here. Name another place!`, true);
        }
        if (!p.inArea) {
          pulseEvery = 8000;
          hideChest();
          hideTrap();
          if (heat) {
            heat = null;
            say("The heat fades: you've left the key's area.");
          }
          showHeat();
          return;
        }
        pulseEvery = 2500;
        const level = p.heat ?? 0;
        const key = p.key ?? 0;
        if (!heat || heat.key !== key) say(`🔥 You're in Key ${key}'s area! Search here is on your hunt card now. Feel for the heat: the edges glow and pulse faster as you get closer.`, true);
        const trend = heat && heat.key === key ? (level > heat.level + 0.01 ? "warmer" : level < heat.level - 0.01 ? "colder" : heat.trend) : "steady";
        heat = { level, key, trend };
        if (p.spot) showChest(p.spot, key);
        else hideChest();
        if (p.trap) showTrap(p.trap, key);
        else hideTrap();
        showHeat();
      }

      /** Every frame: ask when it's time, raise and turn the chest, buzz with the heat. */
      function pulseTick(now: number, t: number) {
        if (!huntId) return;
        if (!pulsing && !ride && !visit && traveller.phase === "idle" && now - pulseAt > pulseEvery) void pulse(now);
        if (chest) {
          const k = Math.min(1, (now - chest.born) / 1200);
          chest.body.position.y = -1.6 * (1 - k) ** 3;
          chest.body.rotation.y = t * 0.6;
          chest.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
          const here = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [chest.spot.lng, chest.spot.lat]) <= 40;
          if (here !== chestHere) {
            chestHere = here;
            showHeat();
          }
        }
        if (trap) {
          const k = Math.min(1, (now - trap.born) / 1200);
          trap.body.position.y = -1.6 * (1 - k) ** 3;
          trap.body.rotation.y = t * 0.6;
          trap.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
          const here = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [trap.spot.lng, trap.spot.lat]) <= 40;
          if (here !== trapHere) {
            trapHere = here;
            showHeat();
          }
        }
        // The metal detector (if bought) beeps once it's warm, faster and higher as the key gets closer.
        if (detectorRef.current && heat && heat.level > 0.3 && !frozen && !inWorld && now >= stuckUntil && now - lastBeat > 1500 - 1350 * heat.level) { // not in a trial or a scene
          lastBeat = now;
          cue("beep", heat.level);
        }
      }

      // Tired (owner, 25 Oct 2026: "let hear the heart beat if someone is tired"): under a quarter of their energy,
      // a heartbeat, heard and felt, faster and stronger as it runs out.
      let lastTiredBeat = 0;
      function tiredTick(now: number) {
        const e = traveller.energy;
        if (e >= 25 || frozen || inWorld || ride) return;
        const level = Math.min(1, (25 - e) / 25);
        if (now - lastTiredBeat > 1700 - 900 * level) {
          lastTiredBeat = now;
          cue("heartbeat", 0.3 + 0.7 * level);
        }
      }

      // ---- On the road in a hunt: now and then something stops the hunter (a checkpoint, a traveller, a seller) ----
      let sceneHold = false; // a scene is up: the hunter stands still
      let lastRoadRoll = performance.now(); // the first chance comes after ~45 s on the move
      let rolling = false;
      async function roadTick(now: number) {
        if (rolling || sceneHold || ride || visit || traveller.phase !== "idle" || traveller.v < 1) return;
        if (now - lastRoadRoll < 45000) return;
        rolling = true;
        lastRoadRoll = now;
        const { data } = await supabase.rpc("road_event_roll", { p_hunt: huntId ?? null }); // in a hunt or in free roam
        rolling = false;
        const e = (data as { ok: boolean; event: RoadEvent | null } | null)?.event;
        if (disposed || !e) return;
        sceneHold = true;
        traveller.v = 0;
        openRoadPlace(e);
        cue("stop");
        setRoadEvent(e);
      }
      /** The road scene is over: the hunter may move again (unless held), and the next chance comes later. */
      function roadDone() {
        sceneHold = false;
        lastRoadRoll = performance.now();
        if (pendingChase) {
          const c = pendingChase;
          pendingChase = null;
          startChase(c.event, c.chase);
        }
      }

      // ---- Cruise (owner, 25 Oct 2026: "move without pressing the keys… it can only go straight, users will need to
      // monitor it"): the hunter goes on by themselves, straight on at junctions unless asked to turn (swipe or ← →).
      // A token is 15 s of moving (red lights and jams don't use it up); it stops at a dead end, when the tokens run
      // out, or when something stops the hunter (a scene, a trial, a trip). Tokens lie in the side streets.
      const CRUISE_S = 15;
      let lastCruiseHud = 0;
      let cruiseTokens = 0;
      let cruiseOn = false;
      let cruiseLeft = 0; // seconds left of the token in use
      const showCruise = () =>
        setHud((h) => {
          const view = { tokens: cruiseTokens, on: cruiseOn, part: cruiseOn ? Math.round((cruiseLeft / CRUISE_S) * 20) / 20 : 0 };
          return h.cruise.tokens === view.tokens && h.cruise.on === view.on && h.cruise.part === view.part ? h : { ...h, cruise: view };
        });
      /** Spend a token (the server keeps the count). */
      function spendCruiseToken() {
        cruiseTokens = Math.max(0, cruiseTokens - 1);
        cruiseLeft = CRUISE_S;
        void supabase.rpc("use_cruise_token").then(({ data }) => {
          const r = data as { ok: boolean; tokens: number } | null;
          if (r) cruiseTokens = Math.min(cruiseTokens, r.tokens);
          if (r && !r.ok) stopCruise("Out of cruise tokens.");
          showCruise();
        });
      }
      function toggleCruise() {
        if (cruiseOn) {
          stopCruise("Cruise off.");
          return;
        }
        if (ride || visit) return;
        if (cruiseTokens <= 0) {
          say("No cruise tokens left: pick them up in the side streets (the teal discs), or buy some in your inventory.", true);
          return;
        }
        spendCruiseToken();
        cruiseOn = true;
        cue("go");
        say("🚗 Cruise on: straight on at junctions. Swipe or press ← → to turn there. Tap Cruise to stop.");
        showCruise();
      }
      function stopCruise(why?: string) {
        if (!cruiseOn) return;
        cruiseOn = false;
        cruiseLeft = 0;
        cue("tap");
        if (why) say(why);
        showCruise();
      }
      function cruiseTick(dt: number, canMove: boolean) {
        if (!cruiseOn) return;
        if (ride || visit || inWorld || sceneHold || huntHold || frozen) {
          stopCruise();
          return;
        }
        if (!canMove || traveller.v < 0.3) return; // waiting (a red light, a jam): the token keeps
        cruiseLeft -= dt;
        if (cruiseLeft > 0) return;
        if (cruiseTokens > 0) spendCruiseToken();
        else stopCruise("Your cruise tokens ran out.");
      }
      async function buyCruise(): Promise<string> {
        const { data } = await supabase.rpc("buy_cruise_tokens");
        const r = data as { ok: boolean; reason?: string; bought?: number; tokens?: number; balance?: number; price?: number } | null;
        if (r?.tokens != null) cruiseTokens = r.tokens;
        showCruise();
        if (r?.ok) {
          if (r.balance != null) setHud((h) => ({ ...h, coins: Number(r.balance) }));
          cue("coin");
          return `🚗 ${r.bought} cruise tokens: you have ${r.tokens}.`;
        }
        if (r?.reason === "full") return "Your cruise tokens are full (8).";
        if (r?.reason === "coins") return `That's ${r.price} coins.`;
        return "Couldn't buy them right now. Try again.";
      }
      void supabase.rpc("cruise_state").then(({ data }) => {
        const r = data as { tokens: number; daily: boolean } | null;
        if (disposed || !r) return;
        cruiseTokens = r.tokens;
        showCruise();
        if (r.daily) say("🎁 Your 2 free cruise tokens for today. Tap Cruise to ride on by yourself.");
      });

      // Tokens lying in the side streets: teal discs; pass within 15 m to pick one up.
      const drops = new Map<number, { entity: import("@/game/ThreeMapLayer").MapEntity; disc: import("three").Object3D; lng: number; lat: number; taking: boolean }>();
      let dropsAt = -Infinity;
      let dropsFrom: LngLat | null = null;
      async function refreshDrops() {
        dropsAt = performance.now();
        dropsFrom = { ...traveller.pos };
        const { data } = await supabase.rpc("cruise_drops_near");
        const list = (data as { id: number; lng: number; lat: number }[] | null) ?? [];
        if (disposed) return;
        const live = new Set(list.map((d) => d.id));
        for (const [id, d] of drops) {
          if (live.has(id) || d.taking) continue;
          layer.remove(d.entity);
          drops.delete(id);
        }
        for (const d of list) {
          if (drops.has(d.id)) continue;
          const model = models.makeCruiseToken();
          drops.set(d.id, { entity: layer.add({ object: model.group, lng: d.lng, lat: d.lat, heading: 0 }), disc: model.disc, lng: d.lng, lat: d.lat, taking: false });
        }
      }
      async function takeDrop(id: number) {
        const d = drops.get(id);
        if (!d || d.taking) return;
        d.taking = true;
        await savePosition(true); // the server checks where it last saw the hunter
        const { data } = await supabase.rpc("take_cruise_drop", { p_drop: id });
        const r = data as { ok: boolean; reason?: string; tokens?: number } | null;
        if (r?.ok || r?.reason === "gone") {
          layer.remove(d.entity);
          drops.delete(id);
        } else {
          d.taking = false;
        }
        if (r?.tokens != null) cruiseTokens = r.tokens;
        showCruise();
        if (r?.ok) {
          cue("coin");
          say(`🚗 +1 cruise token (${r.tokens}/8).`);
        } else if (r?.reason === "full") {
          say("Your cruise tokens are full (8): use some first.");
        }
      }
      function dropsTick(now: number, t: number) {
        const moved = dropsFrom ? geo.distanceM([dropsFrom.lng, dropsFrom.lat], [traveller.pos.lng, traveller.pos.lat]) : Infinity;
        if (now - dropsAt > 25_000 || (moved > 200 && now - dropsAt > 3000)) void refreshDrops();
        for (const [id, d] of drops) {
          d.disc.rotation.y = t * 2;
          d.disc.position.y = 0.9 + Math.sin(t * 2.5 + id) * 0.1;
          if (!d.taking && cruiseTokens < 8 && geo.distanceM([d.lng, d.lat], [traveller.pos.lng, traveller.pos.lat]) <= 15) void takeDrop(id);
        }
      }

      // ---- A police chase (owner, 25 Oct 2026: "if you escape police, they should give you a chase") ----
      // The police follow the very road the hunter takes (the trail behind them), at their own speed: an officer on
      // foot after a walker, a patrol car after a rider. Within a few metres: caught. A long enough lead, or holding
      // out to the end: lost them. The server settles it (police_chase_end).
      type ChaseSpec = NonNullable<RoadEventResult["chase"]>;
      let pendingChase: { event: number; chase: ChaseSpec } | null = null;
      /** The road behind the hunter: where they've been, with the distance travelled (the police follow it). */
      let trail: { lng: number; lat: number; d: number }[] = [];
      let chase: {
        event: number;
        chaser: "officer" | "patrol";
        speed: number; // m/s
        loseM: number;
        until: number; // performance.now() time
        policeD: number;
        entity: import("@/game/ThreeMapLayer").MapEntity;
        avatar: ReturnType<typeof models.buildAvatar> | null;
        car: ReturnType<typeof models.makePoliceCar> | null;
        lastSiren: number;
        lastHud: number;
        over: boolean;
      } | null = null;

      function trailTick() {
        const last = trail[trail.length - 1];
        const here = traveller.pos;
        if (!last) {
          trail.push({ lng: here.lng, lat: here.lat, d: 0 });
          return;
        }
        const step = geo.distanceM([last.lng, last.lat], [here.lng, here.lat]);
        if (step < 2) return;
        if (step > 150) {
          trail = [{ lng: here.lng, lat: here.lat, d: last.d + step }]; // jumped (thrown, a trip): a fresh trail
          return;
        }
        trail.push({ lng: here.lng, lat: here.lat, d: last.d + step });
        // Keep the last ~500 m (and never what's still ahead of the police).
        const keepFrom = Math.min(last.d - 500, chase ? chase.policeD - 20 : Infinity);
        while (trail.length > 2 && trail[1].d < keepFrom) trail.shift();
      }

      /** A point on the trail, `d` metres along it (its start if it's further back). */
      function trailAt(d: number) {
        if (d <= trail[0].d) return trail[0];
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1], b = trail[i];
          if (d <= b.d) {
            const f = (d - a.d) / (b.d - a.d || 1);
            return { lng: a.lng + (b.lng - a.lng) * f, lat: a.lat + (b.lat - a.lat) * f, d };
          }
        }
        return trail[trail.length - 1];
      }

      function startChase(event: number, spec: ChaseSpec) {
        if (chase) return;
        if (!trail.length) trailTick();
        const playerD = trail[trail.length - 1].d;
        const policeD = Math.max(trail[0].d, playerD - spec.gapM);
        const at = trailAt(policeD);
        let avatar: ReturnType<typeof models.buildAvatar> | null = null;
        let car: ReturnType<typeof models.makePoliceCar> | null = null;
        let object: import("three").Object3D;
        if (spec.chaser === "officer") {
          avatar = models.buildAvatar(OFFICER);
          object = avatar.root;
        } else {
          car = models.makePoliceCar();
          object = car.group;
        }
        const entity = layer.add({ object, lng: at.lng, lat: at.lat, heading: traveller.heading });
        const now = performance.now();
        chase = {
          event,
          chaser: spec.chaser,
          speed: spec.kmh / 3.6,
          loseM: spec.loseM,
          until: now + spec.seconds * 1000,
          policeD,
          entity,
          avatar,
          car,
          lastSiren: 0,
          lastHud: 0,
          over: false,
        };
        say(spec.chaser === "officer" ? "🚨 An officer is running after you! Sprint, and don't stop!" : "🚨 The police are after you! Keep moving: a red light or a jam and they'll catch you.", true);
      }

      function chaseTick(now: number, dt: number, t: number) {
        trailTick();
        if (!chase || chase.over) return;
        const c = chase;
        const playerD = trail[trail.length - 1].d;
        const before = trailAt(c.policeD);
        c.policeD = Math.min(playerD, c.policeD + c.speed * dt);
        const at = trailAt(c.policeD);
        const ahead = trailAt(c.policeD + 3);
        c.entity.lng = at.lng;
        c.entity.lat = at.lat;
        if (ahead.lng !== at.lng || ahead.lat !== at.lat) c.entity.heading = geo.headingOf([at.lng, at.lat], [ahead.lng, ahead.lat]);
        if (c.avatar) {
          const moved = geo.distanceM([before.lng, before.lat], [at.lng, at.lat]);
          models.animateAvatar(c.avatar, { mode: "walk", phase: "idle", moving: moved > 0.01 ? 1 : 0, distance: moved / layer.enlargement() }, dt, t);
        }
        c.car?.flash(Math.floor(t * 4) % 2 === 0);
        if (now - c.lastSiren > 900) {
          c.lastSiren = now;
          cue("siren");
        }
        const gap = playerD - c.policeD;
        const left = Math.max(0, Math.ceil((c.until - now) / 1000));
        if (now - c.lastHud > 200) {
          c.lastHud = now;
          setHud((h) => ({ ...h, chase: { gap: Math.round(gap), left, chaser: c.chaser } }));
        }
        if (gap <= (c.chaser === "patrol" ? 10 : 4)) void endChase(true);
        else if (gap >= c.loseM || now >= c.until) void endChase(false);
      }

      async function endChase(caught: boolean) {
        const c = chase;
        if (!c || c.over) return;
        c.over = true;
        setHud((h) => ({ ...h, chase: null }));
        if (caught) {
          traveller.v = 0;
          stuckUntil = Math.max(stuckUntil, performance.now() + 60_000);
          cue("stop");
        } else {
          cue("solved");
        }
        const { data } = await supabase.rpc("police_chase_end", { p_event: c.event, p_caught: caught });
        const r = data as { ok: boolean; fine?: number; balance?: number; holdS?: number } | null;
        if (r?.balance != null) setHud((h) => ({ ...h, coins: Number(r.balance) }));
        if (caught) {
          if (r?.holdS) stuckUntil = Math.max(stuckUntil, performance.now() + r.holdS * 1000);
          say(`🚨 Caught! "Running a checkpoint, eh?" That's ${r?.fine ?? 0} coins, and you wait 60 s while it's written up.`, true);
        } else {
          say("🏁 You lost them! No fine this time.", true);
        }
        // The police stay a moment (beside you if caught), then go.
        window.setTimeout(() => {
          layer.remove(c.entity);
          if (chase === c) chase = null;
        }, caught ? 6000 : 1500);
      }
      setRoadActions({
        answer: async (e, choice) => {
          const { data } = await supabase.rpc("road_event_answer", { p_event: e.id, p_choice: choice });
          const r = data as ({ ok: boolean; balance?: number; holdS?: number } & RoadEventResult) | null;
          if (disposed || !r?.ok) return null;
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          if (r.holdS) stuckUntil = Math.max(stuckUntil, performance.now() + r.holdS * 1000);
          if (r.outcome === "chase" && r.chase) pendingChase = { event: e.id, chase: r.chase }; // starts as the scene closes
          if (r.hint) say(`🧭 Key ${r.hint.key}'s area: ${r.hint.direction} of where you met ${e.npc}, ${r.hint.band} away.`, true);
          if (r.gift && r.gift.kind !== "coins") {
            countRelics(); // a relic, a tyre kit
            if (r.gift.kind === "keg") void loadCondition(); // a full jerry can
            if (r.gift.kind === "cruise") {
              cruiseTokens = Math.min(8, cruiseTokens + r.gift.tokens);
              showCruise();
            }
          }
          return r;
        },
        start: async (e) => {
          const { data } = await supabase.rpc("road_event_game_start", { p_event: e.id });
          return !!(data as { ok: boolean } | null)?.ok;
        },
        play: async (e, move) => {
          const { data } = await supabase.rpc("road_event_play", { p_event: e.id, p_move: move });
          const r = data as ({ ok: boolean; balance?: number } & RoadGameResult) | null;
          if (disposed || !r?.ok) return null;
          const balance = r.balance;
          if (balance != null) setHud((h) => ({ ...h, coins: balance }));
          return { won: r.won, reward: r.reward, answer: r.answer, san: r.san, late: r.late };
        },
        close: () => roadDone(),
      });

      // ---- Resting by the road: sitting at its edge, not in the lane, the bicycle standing beside ----
      let restBike: import("@/game/ThreeMapLayer").MapEntity | null = null;
      const restingNow = () => traveller.resting && traveller.phase === "idle" && traveller.v < 0.3 && !ride && !visit;
      /**
       * Where to sit while resting: off the road, on whichever side is furthest from any road (a dual carriageway's
       * other half, a parallel street), facing the road. Worked out once per spot.
       */
      let seat: { key: string; at: LngLat; bike: LngLat; heading: number } | null = null;
      function roadsideSeat() {
        const key = `${traveller.pos.lng.toFixed(6)},${traveller.pos.lat.toFixed(6)},${traveller.heading.toFixed(2)}`;
        if (seat?.key === key) return seat;
        const enlarge = layer.enlargement();
        const kx = 111320 * Math.cos((traveller.pos.lat * Math.PI) / 180);
        const ky = 110574;
        /** Metres from a spot to the nearest piece of road (within ~120 m). */
        const clearance = (p: LngLat) => {
          let best = Infinity;
          if (!network) return best;
          const px = p.lng * kx, py = p.lat * ky;
          for (const e of network.edges) {
            const a = network.nodes[e.a], b = network.nodes[e.b];
            const ax = a.lng * kx, ay = a.lat * ky, bx = b.lng * kx, by = b.lat * ky;
            if (Math.min(ax, bx) - px > 120 || px - Math.max(ax, bx) > 120 || Math.min(ay, by) - py > 120 || py - Math.max(ay, by) > 120) continue;
            const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9;
            const f = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
            best = Math.min(best, Math.hypot(ax + f * (bx - ax) - px, ay + f * (by - ay) - py));
          }
          return best;
        };
        // Both sides, a little out and further out: the clearest spot (the nearer one if it's clear enough).
        let pick = { side: 1, off: 2.4, clear: -1 };
        for (const off of [2.4, 3.4]) {
          for (const side of [1, -1]) {
            const clear = clearance(besideBus(traveller.pos, traveller.heading, side * off * enlarge, 0));
            if (clear > pick.clear + 0.5) pick = { side, off, clear };
          }
          if (pick.clear >= 1.6 * enlarge) break; // clear of the road: no need to go further
        }
        const at = besideBus(traveller.pos, traveller.heading, pick.side * pick.off * enlarge, 0);
        const bike = besideBus(traveller.pos, traveller.heading, pick.side * (pick.off - 0.2) * enlarge, 1.7 * enlarge);
        seat = { key, at, bike, heading: traveller.heading + (pick.side * Math.PI) / 2 }; // facing the road
        return seat;
      }

      /** Waiting for a bus: the spot on the kerb among the others waiting, facing the door (not where the bus pulls in). */
      function busKerb(): { at: LngLat; heading: number } | null {
        if (!ride || ride.trip.mode !== "bus" || ride.s > 0) return null;
        const path = ride.trip.path;
        const stop = { lng: path[0][0], lat: path[0][1] };
        const heading = geo.headingOf(path[0], path[1]);
        const enlarge = layer.enlargement();
        const at = besideBus(stop, heading, 3.6 * enlarge, -0.5 * enlarge);
        const door = besideBus(stop, heading, 1.6 * enlarge, 1.5 * enlarge);
        return { at, heading: geo.headingOf([at.lng, at.lat], [door.lng, door.lat]) };
      }

      /** Where the hunter is drawn: on the road; on the kerb waiting for a bus; sitting at the roadside resting. Where they are doesn't change. */
      function placeMe() {
        const sitting = restingNow();
        const kerb = busKerb();
        if (kerb) {
          me.lng = kerb.at.lng;
          me.lat = kerb.at.lat;
          me.heading = kerb.heading;
        } else if (sitting) {
          const spot = roadsideSeat();
          me.lng = spot.at.lng;
          me.lat = spot.at.lat;
          me.heading = spot.heading;
          if (traveller.mode === "bicycle") {
            const stand = spot.bike;
            if (!restBike) {
              const bike = models.makeVehicleModel("bicycle");
              bike.rotation.z = 0.12; // leaning on its stand
              restBike = layer.add({ object: bike, lng: stand.lng, lat: stand.lat, heading: traveller.heading });
            }
            restBike.lng = stand.lng;
            restBike.lat = stand.lat;
            restBike.heading = traveller.heading;
          }
        } else {
          me.lng = traveller.pos.lng;
          me.lat = traveller.pos.lat;
          me.heading = traveller.heading;
        }
        if (restBike && (!sitting || traveller.mode !== "bicycle")) {
          layer.remove(restBike);
          restBike = null;
        }
      }

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
        const canMove = !frozen && !huntHold && !sceneHold && !inWorld && now >= stuckUntil && Date.now() >= frozenUntil && !ride && !visit && !!onRoad;
        const { distance, events } = movement.step(traveller, { go: c.go || touchGo || cruiseOn, sprint: c.sprint }, dt, t, canMove);
        cruiseTick(dt, canMove);
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
            // A red light ahead: stop at the line until it's green.
            const red = blockedBy ? null : redLightAhead(distance);
            if (red) holdAtRed(red, now);
            const held = !!blockedBy || !!red;
            if (turned && !held) setTurn(0);
            if (passed && !held) justPassed = passed;
            else if (justPassed && !held) justPassed.metresSince += distance;
            onRoad = held ? before : position;
            if (!held) noteProgress(now, distance);
            if (deadEnd && !held) {
              traveller.v = 0;
              if (now - lastDeadEndCheck > 2000) {
                // Often just the edge of what's loaded: reload the roads and keep going if they continue.
                lastDeadEndCheck = now;
                lastNetworkCheck = now;
                buildRoads();
              } else if (onRoad) {
                onRoad = roads.reverse(onRoad);
                noteDeadEnd(now);
                if (cruiseOn) stopCruise("This road ends here: cruise off.");
                else say("This road ends here. Keep going to head back, or pick another way.");
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

        flightsTick(now, dt);
        // On foot while the vehicle stands at the roadside: the jerry can in hand.
        avatar.jerrycan.visible = traveller.mode === "walk" && !!keg && owned.some((v) => v.stranded_at);
        models.animateAvatar(
          avatar,
          {
            mode: traveller.mode,
            phase: traveller.phase,
            moving: traveller.v / movement.baseSpeed(traveller.mode),
            distance: distance / layer.enlargement(),
            sitting: restingNow(),
          },
          dt,
          t,
        );
        placeMe();
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
        if (inWorld) placeStep(now, dt, t);
        else map.jumpTo({ center: [traveller.pos.lng, traveller.pos.lat], bearing: camBearing, zoom: ride ? rideZoom() : undefined, padding: chasePad() });

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
        skyAndTrafficTick(now);
        lampTick(now);
        repairTick(now);
        ticketTick(now);
        journeyTick(now);
        djinnTick(now);
        wondersTick(now);
        pocketTick(now);
        pulseTick(now, t);
        tiredTick(now);
        chaseTick(now, dt, t);
        dropsTick(now, t);
        if (cruiseOn && now - lastCruiseHud > 500) {
          lastCruiseHud = now;
          showCruise();
        }
        void roadTick(now);

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
        // Traffic jams, over the roads. (Moved over the route below: a jam on your way shows inside the blue line.)
        map.addSource("traffic", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer(
          {
            id: "traffic",
            type: "line",
            source: "traffic",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["match", ["get", "jam"], 2, "#D62828", "#F28C28"],
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 6, 20, 9],
              "line-opacity": 0.9,
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
        // Jams over the route, narrower than it: on your way, an orange or red stripe inside the blue line.
        map.moveLayer("traffic", firstSymbol);
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
        window.removeEventListener("loota:hunt-changed", pulseSoon);
        window.removeEventListener("loota:key-earned", keyWon);
        window.removeEventListener("loota:trial", trialEvent);
        window.removeEventListener("loota:trial-step", trialStep);
        map.remove();
      };
    })().catch(() => setFailed(true));

    return () => {
      disposed = true;
      cleanup();
    };
  }, [startLng, startLat, startMode, lookKey, playerId, username, huntId]);

  // The "do it here" buttons answer only a deliberate tap (owner, 28 Oct 2026: "my hands are mistakenly pressing the
  // prompts on the screen like refuel"): not in their first moment on screen (a tap meant for the map as one appears
  // under the thumb), and not the end of a hold (a thumb resting there to move) or of a swipe.
  const hereKey = [
    hud.dome?.siege ? "siege" : "",
    hud.djinnHere?.place,
    hud.heat?.chest || hud.heat?.trap ? "chest" : "",
    hud.ticketHere?.name,
    hud.repairHere?.shop,
    hud.detourHere?.title,
    ...hud.actions.map((a) => a.id),
  ].join("|");
  const hereArmedAt = useRef(0);
  const herePress = useRef<{ at: number; x: number; y: number } | null>(null);
  useEffect(() => {
    hereArmedAt.current = performance.now() + HERE_ARM_MS;
  }, [hereKey]);
  const hereDown = (e: ReactPointerEvent) => {
    herePress.current = { at: performance.now(), x: e.clientX, y: e.clientY };
  };
  const hereClick = (e: ReactMouseEvent) => {
    if (e.detail === 0) return; // from the keyboard: always meant
    const press = herePress.current;
    herePress.current = null;
    const now = performance.now();
    const meant = now >= hereArmedAt.current && !!press && now - press.at <= HERE_TAP_MS && Math.hypot(e.clientX - press.x, e.clientY - press.y) <= 12;
    if (!meant) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // On a phone the status cards (a taxi coming, a trip, directions…) fold into a row of icons with a short badge
  // (owner, 28 Oct 2026: "we cannot keep too many toast on the screen on mobile… calling a taxi, we can just show taxi
  // icon and the time badge"). One card opens at a time: the one tapped, else one waiting for the player (Get in,
  // Board), else a new one for a few seconds so it's noticed.
  const phone = useSyncExternalStore(onPhoneChange, isPhone, () => false);
  const statusCards: StatusPill[] = [];
  if (hud.journey && !inside && !hud.ride && !hud.care)
    statusCards.push({
      id: "journey",
      icon: "🧭",
      badge: `${hud.journey.step}/${hud.journey.total}`,
      tone: "bg-[#14324A] ring-1 ring-[#5FA8E6]",
      call: !!hud.journey.board,
      label: `Your journey to ${hud.journey.place}`,
      place: hud.journey.place,
    });
  if (hud.guide && !inside)
    statusCards.push({
      id: "guide",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ transform: `rotate(${hud.guide.arrow}deg)` }}>
          <path d="M12 2l7 9h-4.5v11h-5V11H5z" />
        </svg>
      ),
      badge: hud.guide.step.match(/^In ([\d.,]+ ?k?m)/i)?.[1] ?? "now",
      tone: "bg-[#1E9E62]",
      call: false,
      label: hud.guide.step,
    });
  if (hud.care) statusCards.push({ id: "care", icon: hud.care.icon, badge: shortTime(hud.care.status), tone: "bg-[#D62828]", call: false, label: hud.care.title });
  if (hud.pickup && !inside && !hud.ride && !hud.care)
    statusCards.push({
      id: "pickup",
      icon: hud.pickup.icon,
      badge: hud.pickup.action ? "here" : (shortTime(hud.pickup.status) ?? hud.pickup.status.match(/[\d.,]+ ?k?m\b/)?.[0] ?? null),
      tone: "bg-[#1E9E62]",
      call: !!hud.pickup.action,
      label: hud.pickup.title,
    });
  if (hud.advice && !inside && !hud.care) statusCards.push({ id: "advice", icon: "⚠", badge: null, tone: "bg-[#3B2F0A] ring-1 ring-gold text-gold", call: false, label: hud.advice.title });
  if (hud.stuck && !inside && !hud.ride) statusCards.push({ id: "stuck", icon: "🧭", badge: "Stuck?", tone: "bg-ink ring-1 ring-gold", call: false, label: "Going nowhere?" });
  if (hud.ride && !inside)
    statusCards.push({
      id: "ride",
      icon: hud.ride.icon,
      badge: [hud.ride.toGo, shortTime(hud.ride.status)].filter(Boolean).join(" · ") || null,
      tone: "bg-[#2F6FEB]",
      call: false,
      label: hud.ride.title,
      place: hud.ride.to,
    });
  const cardIds = statusCards.map((c) => c.id).join("|");
  const [cardChoice, setCardChoice] = useState<string | null>(null); // tapped open, or "none" (all folded)
  const [cardPeek, setCardPeek] = useState<string | null>(null);
  const seenCards = useRef<string[]>([]);
  useEffect(() => {
    const ids = cardIds ? cardIds.split("|") : [];
    const fresh = ids.find((id) => !seenCards.current.includes(id));
    seenCards.current = ids;
    if (!fresh) return;
    setCardChoice(null);
    setCardPeek(fresh);
    const timer = window.setTimeout(() => setCardPeek((p) => (p === fresh ? null : p)), CARD_PEEK_MS);
    return () => window.clearTimeout(timer);
  }, [cardIds]);
  const openCard = !phone
    ? null
    : cardChoice === "none"
      ? null
      : (statusCards.find((c) => c.id === cardChoice) ?? statusCards.find((c) => c.call) ?? statusCards.find((c) => c.id === cardPeek))?.id ?? null;
  /** Whether a status card shows in full: always on a laptop; on a phone, the one open. */
  const cardShown = (id: string) => !phone || openCard === id;

  if (failed) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="max-w-sm">This device couldn&apos;t start the 3D map. Try a recent version of Chrome, Edge or Safari.</p>
        <Link href="/lobby" className="text-gold">Back to the lobby</Link>
      </div>
    );
  }

  const energyColour = hud.energy < 20 ? "#D93B3B" : hud.energy < 50 ? "#F4B41A" : "#1E9E62";
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
        {/* Top bar: back (with the logo), energy, the hunt's clock, coins, bag (help is with the tools below) */}
        <div className="flex items-center gap-1.5">
          <Link
            href="/lobby"
            aria-label="Back to the lobby"
            title="Back to the lobby"
            className="pointer-events-auto flex h-11 shrink-0 items-center gap-0.5 rounded-xl bg-ink pl-1 pr-2 text-paper"
          >
            <BackIcon />
            <LootaLogo height={28} priority />
          </Link>
          {/* Energy: a ring that empties (owner, 25 Oct 2026: smaller, a circle) */}
          <div
            className="pointer-events-auto relative flex size-11 shrink-0 items-center justify-center rounded-full bg-ink"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={hud.energy}
            aria-label={`Energy ${hud.energy} of 100`}
            title={`Energy ${hud.energy}`}
          >
            <svg viewBox="0 0 44 44" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
              <circle cx="22" cy="22" r="18" fill="none" stroke="#29324A" strokeWidth="4" />
              <circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                stroke={energyColour}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${(2 * Math.PI * 18 * Math.max(0, Math.min(100, hud.energy))) / 100} ${2 * Math.PI * 18}`}
                className="transition-[stroke-dasharray] duration-500"
              />
            </svg>
            <span className="relative flex flex-col items-center leading-none">
              <svg width="10" height="10" viewBox="0 0 24 24" fill={energyColour} aria-hidden="true">
                <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
              </svg>
              <span className="text-[11px] font-extrabold">{hud.energy}</span>
            </span>
          </div>
          {/* The hunt's clock, in the middle */}
          <div className="flex min-w-0 flex-1 justify-center">
            {huntClock && <HuntClock startsAt={huntClock.startsAt} endsAt={huntClock.endsAt} allDay={huntClock.allDay} goldenUntil={goldenUntil} />}
          </div>
          <button
            type="button"
            onClick={() => setCoinShop({ notice: null })}
            className="pointer-events-auto flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm font-bold"
            aria-label={`${hud.coins} coins: buy more`}
            title="Coins: buy more"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2.4" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
            </svg>
            {hud.coins.toLocaleString("en-NG")}
          </button>
          <button
            type="button"
            onClick={() => {
              setBagOwned(actions.current?.vehicles() ?? []);
              setBagOpen(true);
            }}
            aria-label={`Inventory${hud.relics > 0 ? `: ${hud.relics} relics` : ""}`}
            title="Inventory: gear, papers, relics"
            className={`${tool} relative bg-ink text-[#C3A6FF]`}
          >
            <BagIcon />
            {hud.relics > 0 && <span className={`${badge} bg-paper text-ink`}>{hud.relics}</span>}
          </button>
        </div>

        <div className="flex items-start gap-2">
          {/* Left: what's going on (small chips), then the cards */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {(hud.clock ||
              hud.vehicle ||
              hud.radar ||
              hud.dome ||
              hud.rain ||
              hud.hunters > 0 ||
              hud.turn !== 0 ||
              hud.wonders.frozen ||
              hud.wonders.sand ||
              hud.wonders.eye ||
              hud.wonders.cloaked ||
              hud.wonders.mirrored ||
              hud.heat ||
              hud.lounge) && (
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
                {hud.redLight !== null && (
                  <div className={`${chip} bg-danger`} aria-label={`Red light: green in ${hud.redLight} seconds`} title="Stopped at a red light">
                    <span aria-hidden="true">🚦</span>
                    Red light · {hud.redLight} s
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
                    {/* How much it holds you back: your speed now, and your vehicle's usual top speed. */}
                    {hud.vehicle && (
                      <span className="font-semibold opacity-90 max-sm:hidden">
                        · {hud.speedKmh} of {MODES[hud.vehicle.kind].kmh} km/h
                      </span>
                    )}
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
                {hud.lounge && loungeHiddenFor === hud.lounge.id && !ticketOpen && (
                  <button type="button" onClick={() => setLoungeHiddenFor(null)} className={`${chip} bg-[#2F6FEB] text-paper`} aria-label="Back to the lounge">
                    <span aria-hidden="true">🛋</span>
                    Lounge · {hud.lounge.left > 20 ? `boards in ${mmss(hud.lounge.left - 20)}` : "boarding!"}
                  </button>
                )}
                {hud.heat && (
                  <div
                    className={`${chip} ${hud.heat.level >= 0.7 ? "bg-danger" : hud.heat.level >= 0.35 ? "bg-[#F28C28] text-ink" : "bg-[#7A3A10]"}`}
                    aria-label={`The key's heat: ${Math.round(hud.heat.level * 100)}%`}
                    title="Hotter as you get closer to the key"
                  >
                    <span aria-hidden="true">🔥</span>
                    {hud.heat.level >= 0.85 ? "Burning!" : hud.heat.level >= 0.6 ? "Hot" : hud.heat.level >= 0.3 ? "Warm" : "In the area"}
                    {hud.heat.trend !== "steady" && <span className="font-semibold opacity-90">· {hud.heat.trend === "warmer" ? "↑ warmer" : "↓ colder"}</span>}
                    {hud.heat.level >= 0.6 && !hud.heat.chest && !hud.heat.trap && <span className="font-semibold opacity-90 max-sm:hidden">· the chest rises within 60 m</span>}
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

            {/* On a phone: the status cards as icons with a badge; tap one to open it (the cards below). */}
            {phone && statusCards.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="What's going on">
                {statusCards.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-pill={c.id}
                    onClick={() => setCardChoice(openCard === c.id ? "none" : c.id)}
                    aria-expanded={openCard === c.id}
                    aria-label={`${c.label}${c.badge ? ` · ${c.badge}` : ""}`}
                    className={`pointer-events-auto flex min-h-9 items-center gap-1 rounded-full px-2.5 text-sm font-bold text-paper shadow-lg ${c.place ? "py-1 pl-3 pr-3.5" : ""} ${c.tone} ${
                      c.call ? "loota-lamp-glow ring-2 ring-gold" : ""
                    } ${openCard === c.id ? "outline outline-2 outline-offset-1 outline-paper/70" : ""}`}
                  >
                    <span className="flex items-center text-base leading-none" aria-hidden="true">
                      {c.icon}
                    </span>
                    {/* Where to, in small letters above the badge (owner, 29 Oct 2026: "travelling without showing the address one is going" makes no sense) */}
                    {c.place ? (
                      <span className="flex min-w-0 flex-col items-start leading-tight">
                        <span data-pill-place className="max-w-[11rem] truncate text-[10px] font-semibold text-paper/85">
                          {c.place}
                        </span>
                        {c.badge && <span className="text-xs tabular-nums">{c.badge}</span>}
                      </span>
                    ) : (
                      c.badge && <span className="text-xs tabular-nums">{c.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* A journey under way: which step, and the Board button at the stop. */}
            {hud.journey && !inside && !hud.ride && !hud.care && cardShown("journey") && (
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
            {hud.guide && !inside && cardShown("guide") && (
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
            {hud.care && cardShown("care") && (
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
            {hud.pickup && !inside && !hud.ride && !hud.care && cardShown("pickup") && (
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
            {hud.advice && !inside && !hud.care && cardShown("advice") && (
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

            {/* Going nowhere: the offer to be put on a road that leads out. */}
            {hud.stuck && !inside && !hud.ride && cardShown("stuck") && (
              <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl bg-ink p-2.5 text-sm text-paper ring-1 ring-gold" role="alert" aria-label="Stuck">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-bold text-gold">🧭 Going nowhere?</span>
                  <span className="text-xs text-paper/80">We&apos;ll put you on a road that leads out.</span>
                </span>
                <button type="button" onClick={() => actions.current?.getOut()} className="h-10 shrink-0 rounded-xl bg-gold px-3 text-sm font-bold text-ink">
                  Get me out
                </button>
                <button type="button" aria-label="Dismiss" onClick={() => actions.current?.notStuck()} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-paper/70">
                  <CloseIcon />
                </button>
              </div>
            )}

            {/* On a bus, train or plane: where to, and when it leaves or arrives. */}
            {hud.ride && !inside && cardShown("ride") && (
              <div className="pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-[#2F6FEB] p-3 text-paper" role="status" aria-label="Your trip">
                <span className="text-2xl" aria-hidden="true">
                  {hud.ride.icon}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-display text-base font-extrabold leading-tight">{hud.ride.title}</span>
                  <span className="truncate text-xs text-paper/85">{hud.ride.status}</span>
                </div>
                {/* With a Fast Pass to offer, the buttons get a row of their own (the title and the wait stay readable). */}
                <div className={`flex shrink-0 gap-2 ${hud.ride.pass ? "w-full justify-end" : ""}`}>
                  {hud.ride.pass && (
                    <button
                      type="button"
                      onClick={() => actions.current?.fastPass()}
                      aria-label="Use a Fast Pass: skip the wait"
                      className="shrink-0 rounded-lg bg-[#C3A6FF] px-2 py-1 text-xs font-bold text-ink"
                    >
                      🎟️ Fast Pass
                    </button>
                  )}
                  {hud.ride.canCancel && (
                    <button type="button" onClick={() => actions.current?.cancelTrip()} className="shrink-0 rounded-lg bg-ink/30 px-2 py-1 text-xs font-bold">
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            {helpOpen && (
              <div className="pointer-events-auto flex max-h-[64dvh] max-w-md flex-col gap-3 overflow-y-auto rounded-2xl bg-ink p-4 text-sm ring-1 ring-line" role="note" aria-label="How to play">
                <div className="flex items-center justify-between">
                  <p className="font-display text-lg font-extrabold">How to play</p>
                  <button type="button" aria-label="Close" onClick={() => setHelpOpen(false)} className="flex size-8 items-center justify-center rounded-lg bg-ink-2 text-paper">
                    ✕
                  </button>
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-gold">A hunt, step by step</p>
                <ol className="flex flex-col gap-2">
                  {[
                    ["📜", "Name the place", "You have 15 seconds to type the place the riddle points to. Miss it and you wait a minute."],
                    ["🗺️", "Get there", "The way to your answer is drawn. Nobody knows if it's right until they arrive: the wrong place means a new 15 seconds."],
                    ["🔥", "Follow the heat", "In the area the edges glow: Warm, Hot, then Burning as you close in. A metal detector (in your inventory, 300 coins) beeps faster and reaches farther."],
                    ["🗝️", "Open the chest", "Within 60 m of the key it rises out of the ground."],
                    ["🧩", "Beat the Key Trial", "A puzzle or quick questions against the clock. Fail and you're thrown 2 km away."],
                  ].map(([icon, title, text], i) => (
                    <li key={title} className="flex gap-3 rounded-xl bg-ink-2 p-2.5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink text-lg" aria-hidden="true">{icon}</span>
                      <span>
                        <b>
                          {i + 1}. {title}
                        </b>
                        <span className="block text-muted">{text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="rounded-xl bg-[#3B1F4F] p-2.5">
                  🎭 <b>Beware the Masquerade:</b> a chest that rises where the heat isn&apos;t <b>Burning</b> is his trap.
                </p>
                <p className="rounded-xl bg-[#0B1630] p-2.5 text-[#C9D6FF]">
                  🌙 <b>Hunting hours:</b> 9 am to 9 pm, Lagos time. From 9 pm the hunt rests and you roam freely; your keys and place are kept.
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wider text-gold">Moving</p>
                <MoveDemo />
                <p className="text-muted">Keyboard: hold ↑ to go, ↓ to turn round, tap ← → to turn at the next junction, Shift to sprint.</p>
                <p className="rounded-xl bg-[#2EC4B6]/15 p-2.5">
                  🚗 <b>Cruise</b> (the teal button) takes you on by yourself, straight on at junctions: swipe or press ← → to turn there. Each token is 15 s of moving; pick them up in the side streets (teal discs), get 2 free a day, or buy them in your inventory.
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wider text-gold">Your buttons</p>
                <ul className="flex flex-col gap-1.5">
                  <li className="flex items-center gap-2"><span className="text-paper"><DirectionsIcon /></span> Directions: search a place or tap the map</li>
                  <li className="flex items-center gap-2"><span className="text-paper"><VehicleIcon kind={hud.vehicle?.kind ?? null} /></span> Walk, or ride a bicycle, motorbike or car</li>
                  <li className="flex items-center gap-2"><span className="text-paper"><BusIcon /></span> Bus, train, plane or taxi (gold at a stop)</li>
                  <li className="flex items-center gap-2"><span className="text-gold"><LampIcon /></span> The lamp: Detours and finds (it glows); the Djinn between hunts (purple smoke)</li>
                  <li className="flex items-center gap-2"><span className="text-[#C3A6FF]"><BagIcon /></span> Inventory: gear, papers, relics</li>
                  <li className="flex items-center gap-2"><span className="text-[#2EC4B6]"><RadioIcon /></span> Radio: live stations from where you are (and Nigeria&apos;s) while you move</li>
                </ul>
                <details className="rounded-xl bg-ink-2 p-2.5">
                  <summary className="cursor-pointer font-bold">Good to know</summary>
                  <div className="mt-2 flex flex-col gap-2 text-muted">
                    <p>
                      <b className="text-paper">Look around:</b> on a phone, drag up or down to tilt the view (a sideways swipe turns); with a mouse, drag sideways to turn the view.
                    </p>
                    <p>Things you can do where you stand (eat, rest, refuel, check in) appear as gold buttons above the street name.</p>
                    <p>
                      <b className="text-paper">Night and day</b> follow the real sun: at night taxis cost more and buses come less often.
                    </p>
                    <p>
                      <b className="text-paper">Traffic:</b> at rush hour main roads jam (red: standstill, orange: slow). Cars crawl, motorbikes weave
                      through; walkers and cyclists aren&apos;t held up.
                    </p>
                  </div>
                </details>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSound(!sound);
                      setSoundState(!sound);
                    }}
                    aria-pressed={sound}
                    className="rounded-xl bg-ink-2 px-3 py-2 text-sm font-bold"
                  >
                    {sound ? "🔊 Sound: on" : "🔇 Sound: off"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHelpOpen(false);
                      setTourAgain(true);
                    }}
                    className="rounded-xl bg-ink-2 px-3 py-2 text-sm font-bold"
                  >
                    ▶ Show the welcome tour again
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHelpOpen(false);
                      actions.current?.getOut();
                    }}
                    className="rounded-xl bg-ink-2 px-3 py-2 text-sm font-bold"
                  >
                    🧭 Stuck? Get me out
                  </button>
                </div>
                <button type="button" onClick={() => setHelpOpen(false)} className="h-11 rounded-xl bg-gold font-bold text-ink">
                  Got it
                </button>
              </div>
            )}

            {radioOpen && !inside && <RadioPanel onClose={() => setRadioOpen(false)} />}
            {storyOpen && huntId && huntStory.story && !inside && <StoryScroll huntId={huntId} story={huntStory.story} reload={huntStory.reload} onClose={() => setStoryOpen(false)} />}

            {/* The hunt (riddle, keys, Search here) */}
            {/* (Out of the way in a scene, but kept: its race news and timers carry on.) */}
            {!huntId && openHunt && !inviteOff && !inside && !touring && !helpOpen && <HuntInvite hunt={openHunt} onDismiss={() => setInviteOff(true)} />}
            {huntId && huntShown && (
              <div className={inside && inside !== "trial" ? "hidden" : "contents"}>
                <HuntPanel huntId={huntId} actions={huntActions} onHide={hideHunt} scene={inside === "trial"} keeper={trialKeeper} inArea={!!hud.heat} />
              </div>
            )}
          </div>

          {/* Right: the tools, as icons */}
          <nav className={`flex shrink-0 flex-col gap-2 ${inside ? "invisible" : ""}`} aria-label="Tools">
            {/* Help, at the top of the tools (owner, 26 Oct 2026: the inventory takes the end of the top bar) */}
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
            {/* Loota Radio (owner, 27 Oct 2026: "so users can listen as they move so it is not just boring") */}
            <button
              type="button"
              data-tool="radio"
              aria-label={radio.status === "off" ? "Radio" : "Radio: playing"}
              title="Radio"
              aria-expanded={radioOpen}
              onClick={() => setRadioOpen((o) => !o)}
              className={`${tool} relative ${radioOpen ? "bg-gold text-ink" : radio.status === "off" ? "bg-ink text-paper" : "bg-ink text-[#2EC4B6]"}`}
            >
              <RadioIcon />
              {radio.status !== "off" && <span className="absolute -right-1 -top-1 size-3 animate-pulse rounded-full bg-[#2EC4B6] ring-2 ring-ink" aria-hidden="true" />}
            </button>
            {huntId && huntStory.story && (
              <button
                type="button"
                data-tool="story"
                aria-label={`The story${huntStory.unseen ? ": not read yet" : ""}`}
                title="The story"
                aria-expanded={storyOpen}
                onClick={() => {
                  setStoryOpen((o) => !o);
                  if (huntStory.story?.chapters.length) huntStory.seen();
                }}
                className={`${tool} relative ${storyOpen ? "bg-gold text-ink" : huntStory.unseen ? "loota-lamp-glow bg-ink text-gold" : "bg-ink text-paper"}`}
              >
                <ScrollIcon />
                {huntStory.unseen && <span className="absolute -right-1 -top-1 size-3 rounded-full bg-gold ring-2 ring-ink" aria-hidden="true" />}
              </button>
            )}
            {huntId && (
              <button
                type="button"
                data-tool="leaderboard"
                aria-label={`Leaderboard${boardLit ? ": a key was just taken" : ""}`}
                title="Leaderboard"
                onClick={openBoard}
                className={`${tool} relative ${boardLit ? "loota-lamp-glow bg-gold text-ink" : "bg-ink text-paper"}`}
              >
                <TrophyIcon />
                {boardLit && <span className="absolute -right-1 -top-1 size-3 rounded-full bg-ink ring-2 ring-ink" aria-hidden="true" />}
              </button>
            )}
          </nav>
        </div>
      </div>

      {hud.street && !inside && (
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
        className={`absolute bottom-9 left-3 ${
          hud.ride || hud.care ? "right-3" : canSprint(hud.mode) ? "right-[176px]" : "right-[96px]" // clear of CRUISE (and SPRINT)
        } rounded-2xl bg-ink px-4 py-3 text-sm sm:left-1/2 sm:right-auto sm:w-[min(520px,calc(100%-24px))] sm:-translate-x-1/2 sm:text-center ${
          hud.alert ? "ring-2 ring-gold" : ""
        } ${hud.hint && !hud.rush ? "" : "invisible"}`}
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        {hud.hint}
      </p>

      {/* News: the hunt's, and everyone's finds and lamp prizes. */}
      <NewsToasts hidden={!!inside && inside !== "trial"} />

      {/* The bus rush: quick questions over the map while the crowd pushes for the door. */}
      {hud.rush && (
        <div
          className="pointer-events-auto absolute inset-x-3 bottom-24 z-10 mx-auto flex max-w-md flex-col gap-2 rounded-2xl bg-ink/90 p-3 text-paper shadow-xl ring-2 ring-gold"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
          role="group"
          aria-label="Bus rush"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-display text-sm font-extrabold text-gold">
              🚌 {hud.rush.outcome ? (hud.rush.outcome.boarded ? "You're on!" : "Bus full!") : "RUSH! Push through the crowd"}
            </span>
            <span className="flex gap-1" aria-label="Your answers">
              {Array.from({ length: hud.rush.total }, (_, i) => {
                const m = hud.rush!.marks[i];
                return (
                  <span
                    key={i}
                    className={`flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      m === "right" ? "bg-[#1E9E62]" : m === "wrong" || m === "late" ? "bg-danger" : m === "done" ? "bg-paper/50" : i === hud.rush!.index ? "bg-gold text-ink" : "bg-paper/15"
                    }`}
                  >
                    {m === "right" ? "✓" : m === "wrong" ? "✗" : m === "late" ? "…" : ""}
                  </span>
                );
              })}
            </span>
          </div>
          {hud.rush.outcome ? (
            <p className="text-sm font-semibold">
              {hud.rush.outcome.boarded
                ? `You squeezed in! ${hud.rush.outcome.score} of ${hud.rush.outcome.of} right.`
                : `The bus filled up before you reached the door (${hud.rush.outcome.score} of ${hud.rush.outcome.of}). Next bus in ${Math.floor((hud.rush.outcome.next ?? 0) / 60)}:${String((hud.rush.outcome.next ?? 0) % 60).padStart(2, "0")}.`}
            </p>
          ) : (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-paper/15">
                <div className="h-full rounded-full bg-gold transition-[width] duration-100" style={{ width: `${(100 * hud.rush.left) / hud.rush.per}%` }} />
              </div>
              <p className="text-center font-display text-2xl font-extrabold">{hud.rush.q}</p>
              <div className="grid grid-cols-3 gap-2">
                {hud.rush.choices.map((c, i) => (
                  <button
                    key={`${hud.rush!.index}-${i}`}
                    type="button"
                    disabled={hud.rush!.index >= hud.rush!.total}
                    onClick={() => actions.current?.rushAnswer(i)}
                    className="h-12 rounded-xl bg-gold font-display text-xl font-extrabold text-ink active:scale-95 disabled:opacity-50"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Rain from a Rain Charm: falling streaks over the map, a little darker. */}
      {hud.rain && <div className="loota-rain pointer-events-none absolute inset-0" aria-hidden="true" />}

      {bagOpen && (
        <BagPanel
          cruiseTokens={hud.cruise.tokens}
          onBuyCruise={() => actions.current?.buyCruise() ?? Promise.resolve("The map isn't ready yet.")}
          detector={detector}
          onBuyDetector={buyDetector}
          leads={hud.leads}
          owned={bagOwned}
          keg={hud.keg}
          tyreKits={hud.tyreKits}
          onUseItem={(item) => actions.current?.useItem(item) ?? Promise.resolve("The map isn't ready yet.")}
          coins={hud.coins}
          onAddon={async (kind, id) => {
            await actions.current?.buyAddon(kind, id);
            setBagOwned(actions.current?.vehicles() ?? []);
          }}
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
          onRide={(kind, how, addons) => {
            actions.current?.ride(kind, how, addons);
            setGarage(null);
          }}
          onAddon={(kind, id) => {
            void actions.current?.buyAddon(kind, id).then(() => setGarage(actions.current?.vehicles() ?? []));
          }}
          onGetOff={() => {
            actions.current?.getOff();
            setGarage(null);
          }}
          onMechanic={() => {
            actions.current?.act("mechanic");
            setGarage(null);
          }}
          onRepairShop={(kind) => {
            actions.current?.findRepairShop(kind);
            setGarage(null);
          }}
          onWayTo={(kind) => {
            actions.current?.wayToParked(kind);
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

      {roadEvent && roadActions && (
        <RoadEventScene
          event={roadEvent}
          you={JSON.parse(lookKey) as AvatarLook}
          vehicle={hud.vehicle?.kind ?? null}
          actions={roadActions}
          world={inside === "road"}
          onClose={() => {
            if (inside === "road") return actions.current?.leaveShop();
            roadActions.close();
            setRoadEvent(null);
          }}
        />
      )}
      {rentOpen && rentalActions && (
        <RentalScene
          offer={rentOpen}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={rentalActions}
          world={inside === "hire"}
          onMoment={onMoment}
          onClose={() => (inside === "hire" ? actions.current?.leaveShop() : setRentOpen(null))}
        />
      )}
      {fuelOpen && fuelActions && (
        <FuelScene
          offer={fuelOpen}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={fuelActions}
          world={inside === "fuel"}
          onMoment={onMoment}
          onClose={() => (inside === "fuel" ? actions.current?.leaveShop() : setFuelOpen(null))}
        />
      )}
      {mealOpen && mealActions && (
        <MealScene
          offer={mealOpen}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={mealActions}
          world={inside === "meal"}
          onMoment={onMoment}
          onClose={() => (inside === "meal" ? actions.current?.leaveShop() : setMealOpen(null))}
        />
      )}
      {coinShop && (
        <CoinShop
          coins={hud.coins}
          notice={coinShop.notice}
          onPaid={(balance) => setHud((h) => ({ ...h, coins: balance }))}
          onClose={() => setCoinShop(null)}
        />
      )}
      {serviceOpen && serviceActions && (
        <ServiceScene
          offer={serviceOpen}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={serviceActions}
          world={inside === "service"}
          onMoment={onMoment}
          onClose={() => (inside === "service" ? actions.current?.leaveShop() : setServiceOpen(null))}
        />
      )}
      {flatOpen && flatActions && (
        <FlatScene
          offer={flatOpen}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={flatActions}
          world={inside === "flat"}
          onClose={() => (inside === "flat" ? actions.current?.leaveShop() : setFlatOpen(null))}
        />
      )}
      {/* The lounge once checked in and through (not while still at the desk) */}
      {hud.lounge && loungeHiddenFor !== hud.lounge.id && !ticketOpen && (
        <LoungeScene view={hud.lounge} you={JSON.parse(lookKey) as AvatarLook} onHide={() => setLoungeHiddenFor(hud.lounge?.id ?? null)} />
      )}
      {pourOpen && pourActions && (
        <PourScene
          offer={pourOpen}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={pourActions}
          onClose={() => {
            setPourOpen(null);
            actions.current?.endHold();
          }}
        />
      )}
      {pumpOpen && pumpActions && (
        <PumpScene
          offer={pumpOpen}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={pumpActions}
          world={inside === "pump"}
          onMoment={onMoment}
          onClose={() => (inside === "pump" ? actions.current?.leaveShop() : setPumpOpen(null))}
        />
      )}
      {quizOpen && (
        <QuizScene
          offer={quizOpen.offer}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={quizOpen.actions}
          world={inside === "quiz"}
          onMoment={onMoment}
          onClose={() => (inside === "quiz" ? actions.current?.leaveShop() : setQuizOpen(null))}
        />
      )}
      {ticketOpen && ticketActions && (
        <TicketScene
          offer={ticketOpen}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={ticketActions}
          world={inside === "ticket"}
          onMoment={onMoment}
          onClose={() => (inside === "ticket" ? actions.current?.leaveShop() : setTicketOpen(null))}
        />
      )}
      {discharge && (
        <NurseScene
          discharge={discharge}
          you={JSON.parse(lookKey) as AvatarLook}
          world={inside === "ward" || inside === "roadside"}
          onClose={() => (inside === "ward" || inside === "roadside" ? actions.current?.leaveShop() : setDischarge(null))}
        />
      )}
      {repairOpen && repairActions && (
        <RepairScene
          job={repairOpen}
          you={JSON.parse(lookKey) as AvatarLook}
          actions={repairActions}
          world={inside === "repair"}
          onClose={() => (inside === "repair" ? actions.current?.leaveShop() : setRepairOpen(null))}
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

      {djinnOpen && djinnActions && (
        <DjinnPanel
          actions={djinnActions}
          chamber={djinnOpen.chamber}
          world={inside === "vault"}
          onMoment={onMoment}
          onClose={() => (inside === "vault" ? actions.current?.leaveShop() : setDjinnOpen(null))}
        />
      )}

      {/* Carried off by the Djinn's whirlwind; a trap springing. */}
      {whirlwind && (
        <div className="loota-whirlwind-screen pointer-events-none absolute inset-0 z-30 flex items-center justify-center" aria-hidden="true">
          <span className="text-7xl">🌪</span>
        </div>
      )}
      {trapFlash && <div className="loota-trap-flash pointer-events-none absolute inset-0 z-20" aria-hidden="true" />}
      {hud.chase && (
        <>
          <div className="loota-police pointer-events-none absolute inset-0 z-10" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-x-0 top-[124px] z-20 flex justify-center" role="status" aria-label="Police chase">
            <span className="flex items-center gap-2 rounded-full bg-ink/95 px-4 py-1.5 text-sm font-extrabold text-paper ring-2 ring-[#3D7BFF]">
              🚨 {hud.chase.chaser === "officer" ? "Officer" : "Police"} {hud.chase.gap} m behind
              <span className="tabular-nums text-gold">· {hud.chase.left}s</span>
            </span>
          </div>
        </>
      )}
      {trapStory && (
        <StoryScene
          lines={trapStory.lines}
          mood="sly"
          onDone={() => {
            actions.current?.dizzy(trapStory.dizzyS);
            setTrapStory(null);
          }}
        />
      )}
      {dizzyUntil && !trapStory && (
        <div className="loota-dizzy pointer-events-none absolute inset-x-0 top-24 z-20 flex justify-center" aria-label="Dizzy" role="status">
          <span className="rounded-full bg-[#9B5DE5] px-4 py-1.5 font-display text-base font-extrabold text-paper shadow-lg">😵 Dizzy! The world is spinning…</span>
        </div>
      )}

      {/* The metal detector: the edges glow and pulse faster as the key gets closer. */}
      {hud.heat && (
        <div
          className="loota-heat pointer-events-none absolute inset-0"
          style={{ opacity: 0.12 + 0.6 * hud.heat.level, animationDuration: `${(1.6 - 1.25 * hud.heat.level).toFixed(2)}s` }}
          aria-hidden="true"
        />
      )}
      {keyFly && (
        <span key={keyFly} className="loota-key-fly pointer-events-none fixed z-40 text-6xl" aria-hidden="true">
          🗝
        </span>
      )}

      {/* The Djinn's Wonders: news of every use, and what they do to you. */}
      {hud.wonders.sand && <div className="loota-sand pointer-events-none absolute inset-0" aria-hidden="true" />}
      {hud.wonders.frozen && <div className="loota-frost pointer-events-none absolute inset-0" aria-hidden="true" />}
      {wonderBanner?.flash && <div key={`flash-${wonderBanner.n}`} className="loota-cataclysm-flash pointer-events-none absolute inset-0 z-30" aria-hidden="true" />}
      {touring && <WelcomeTour username={username} coins={hud.coins} openHunt={huntId ? null : openHunt} onDone={endTour} />}
      {strikeFx && (
        <div key={strikeFx.n} className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true" data-strike>
          <div className="loota-strike-flash absolute inset-0" />
          <svg className="loota-strike-bolt absolute left-1/2 top-0 h-[62%] -translate-x-1/2" viewBox="0 0 100 300" fill="none">
            <path d="M62 0 L28 128 L54 128 L22 300 L84 104 L56 104 L80 0 Z" fill="#FFF6B0" stroke="#F4B41A" strokeWidth="4" strokeLinejoin="round" />
          </svg>
          <span className="loota-strike-item absolute left-1/2 top-1/2 text-7xl">{strikeFx.icon}</span>
        </div>
      )}
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

      {transitOpen && transitActions && (
        <TransitPanel actions={transitActions} coins={hud.coins} onClose={() => setTransitOpen(false)} />
      )}

      {/* What can be done right here: check in, eat, rest, refuel, kegs, tyres, repairs; and the siege at a dome's edge. */}
      {!inside && (hud.dome?.siege || hud.actions.length > 0 || hud.detourHere || hud.djinnHere || hud.repairHere || hud.ticketHere || hud.heat?.chest || hud.heat?.trap) && (
        <div
          className="pointer-events-none absolute inset-x-3 bottom-[156px] flex flex-wrap items-end justify-center gap-2 sm:bottom-[144px]"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
          onPointerDownCapture={hereDown}
          onClickCapture={hereClick}
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
          {(hud.heat?.chest || hud.heat?.trap) && (
            <button
              type="button"
              onClick={hud.heat.trap ? () => actions.current?.springTrap() : openChest}
              aria-label="Open the key's chest"
              className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-full bg-gold px-4 font-display text-base font-extrabold text-ink shadow-lg ring-2 ring-[#FFD45C] active:scale-95"
            >
              🗝 Open the chest
            </button>
          )}
          {hud.ticketHere && (
            <button
              type="button"
              onClick={() => actions.current?.enterTicket()}
              aria-label={hud.ticketHere.kind === "plane" ? `Check in at ${hud.ticketHere.name}` : `The ticket office at ${hud.ticketHere.name}`}
              className={`${here} gap-1.5`}
            >
              {hud.ticketHere.kind === "plane" ? "🛫 Check in" : "🎫 Ticket office"}
              {hud.ticketHere.away > 0 && <span className="text-xs font-semibold text-ink/70">· {hud.ticketHere.away} m</span>}
            </button>
          )}
          {hud.repairHere && (
            <button
              type="button"
              onClick={() => hud.repairHere && actions.current?.enterShop(hud.repairHere)}
              aria-label={`Go into ${hud.repairHere.shop}`}
              title={hud.repairHere.shop}
              className={`${here} gap-1.5`}
            >
              🔧 {hud.repairHere.readyAt ? "Back to the shop" : "Go in"}
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
          {hud.actions.map((a) => (
            <button key={a.id} type="button" disabled={hud.busy} onClick={() => actions.current?.act(a.id)} aria-label={a.label} title={a.label} className={`${here} gap-1`}>
              <span aria-hidden="true">{a.icon}</span>
              {a.short}
            </button>
          ))}
        </div>
      )}

      {/* Cruise (owner, 25 Oct 2026): beside Sprint, or in its place on a motorbike or in a car. */}
      {!hud.ride && !hud.care && (
        <div
          className={`absolute ${canSprint(hud.mode) ? "bottom-11 right-[104px]" : "bottom-9 right-5"}`}
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <button
            type="button"
            onClick={() => actions.current?.toggleCruise()}
            aria-pressed={hud.cruise.on}
            aria-label={`Cruise ${hud.cruise.on ? "on" : "off"}: ${hud.cruise.tokens} tokens`}
            title="Cruise: go on by yourself (straight on at junctions)"
            className={`pointer-events-auto relative flex size-[64px] flex-col items-center justify-center rounded-full leading-none shadow-lg ${hud.cruise.on ? "bg-[#2EC4B6] text-ink" : "bg-ink text-paper"} ${hud.cruise.tokens === 0 && !hud.cruise.on ? "opacity-60" : ""}`}
          >
            {/* The ring: the tokens held (off), or what's left of the one in use (on) */}
            <svg viewBox="0 0 64 64" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
              <circle cx="32" cy="32" r="29" fill="none" stroke={hud.cruise.on ? "#0F1420" : "#29324A"} strokeOpacity={hud.cruise.on ? 0.25 : 1} strokeWidth="4" />
              <circle
                cx="32"
                cy="32"
                r="29"
                fill="none"
                stroke={hud.cruise.on ? "#0F1420" : "#2EC4B6"}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 29 * (hud.cruise.on ? hud.cruise.part : hud.cruise.tokens / 8)} ${2 * Math.PI * 29}`}
              />
            </svg>
            <span className="relative text-[11px] font-extrabold tracking-wide">CRUISE</span>
            <span className="relative mt-0.5 text-[11px] font-bold opacity-80">×{hud.cruise.tokens}</span>
          </button>
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

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

/** Free roam follows the roads with no destination; route goes to a tapped place. */
type Style = "roam" | "route";

type Hud = {
  energy: number;
  speedKmh: number;
  leftM: number | null;
  mode: Mode;
  style: Style;
  following: boolean;
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
  /** A purchase or vehicle change is on its way to the server. */
  busy: boolean;
  /** Moving by itself towards a tapped spot or along a route. */
  auto: boolean;
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SAVE_EVERY_MS = 4000;
const ROAM_HINTS = {
  keys: "Free roam: hold ↑ to move and ↓ to go back. ← or → turns at the next junction; Shift runs. Or click the map to walk there.",
  touch: "Free roam: tap the map to walk there along the roads (tap behind you to go back). Hold SPRINT to run.",
};
const ROUTE_HINT = "Tap the map to choose where to go.";

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
 * The live 3D map: the player's hunter, free roam on roads or tap-to-route
 * travel, the chase camera, and saving position to the server.
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
    setStyle: (s: Style) => void;
    follow: () => void;
    turn: (dir: -1 | 1) => void;
    turnAround: () => void;
    stop: () => void;
  } | null>(null);
  const huntActions = useRef<HuntActions | null>(null);
  const [failed, setFailed] = useState(false);
  const [hud, setHud] = useState<Hud>({
    energy: 100,
    speedKmh: 0,
    leftM: null,
    mode: startMode,
    style: "roam",
    following: true,
    hint: "Finding the nearest road…",
    alert: false,
    coins: initialCoins,
    relics: 0,
    leads: 0,
    nearest: null,
    turn: 0,
    vehicle: null,
    services: { fuel: null, food: null },
    busy: false,
    auto: false,
  });
  const [bagOpen, setBagOpen] = useState(false);
  const [garage, setGarage] = useState<OwnedVehicle[] | null>(null); // the Vehicles panel, when open

  const lookKey = JSON.stringify(look);
  const startLng = start.lng;
  const startLat = start.lat;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      // Map and 3D code only ever run in the browser.
      const [{ Map: MapLibre, setWorkerUrl }, geo, movement, models, roads, { ThreeMapLayer }, { fetchRoute }, { createClient }, { styleMapForGame }] =
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
        ]);
      if (disposed || !container.current) return;
      // Served from public/ by scripts/copy-map-worker.mjs (the bundler doesn't serve MapLibre's worker).
      setWorkerUrl("/maplibre-gl-worker.mjs");

      const supabase = createClient();
      const small = window.matchMedia("(max-width: 600px)").matches;
      // Mouse and keyboard, or touch: the hints describe the controls the player has.
      const roamHint = window.matchMedia("(pointer: fine)").matches ? ROAM_HINTS.keys : ROAM_HINTS.touch;
      const traveller = movement.createTraveller({ lng: startLng, lat: startLat }, startMode);

      const map = new MapLibre({
        container: container.current,
        style: MAP_STYLE,
        center: [startLng, startLat],
        zoom: small ? 20.5 : 19.5,
        pitch: small ? 55 : 60,
        bearing: geo.compassFromHeading(traveller.heading),
        maxPitch: 70,
        keyboard: false, // the keyboard drives the hunter instead
        attributionControl: { compact: true },
      });

      const layer = new ThreeMapLayer(() => traveller.pos, small ? 40 : 32);
      const avatar = models.buildAvatar(JSON.parse(lookKey) as AvatarLook);
      avatar.root.add(layer.billboard(models.makeNameplate("YOU", "#2F6FEB")));
      const me = layer.add({ object: avatar.root, lng: startLng, lat: startLat, heading: traveller.heading });
      const marker = models.makeDestinationMarker();
      const destination = layer.add({ object: marker.group, lng: startLng, lat: startLat });

      const say = (hint: string, alert = false) => setHud((h) => ({ ...h, hint, alert }));
      const showRoute = (coords: [number, number][] | null) => {
        const source = map.getSource("route") as import("maplibre-gl").GeoJSONSource | undefined;
        source?.setData(
          coords
            ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }
            : { type: "FeatureCollection", features: [] },
        );
      };

      let style: Style = "roam";
      let following = true;
      let camBearing = geo.compassFromHeading(traveller.heading);

      // ---- Free roam on roads ----------------------------------------------
      let network: import("@/game/roads").RoadNetwork | null = null;
      let onRoad: import("@/game/roads").RoadPosition | null = null;
      // Where the player wants to go: straight on by default, towards a clicked
      // spot, or a left/right turn waiting for the next junction.
      let aimTarget: LngLat | null = null;
      let aimClosest = Infinity; // closest the roads have brought the player to aimTarget
      let pendingTurn: -1 | 0 | 1 = 0;
      let lastNetworkCheck = 0;
      let lastDeadEndCheck = 0;

      function buildRoads() {
        const features = map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" });
        if (!features.length) return false;
        // Keep facing the way the player chose on the road (e.g. just turned round), not the way the body still points.
        const facing = network && onRoad ? roads.positionOf(network, onRoad).heading : traveller.heading;
        network = roads.buildNetwork(features as import("@/game/roads").RoadFeature[], traveller.mode, traveller.pos);
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

      /** Walk (or ride) to a tapped spot along the roads, turning round first if it's behind. */
      function headTowards(point: LngLat) {
        aimTarget = point;
        aimClosest = Infinity;
        setTurn(0);
        const heading = geo.headingOf([traveller.pos.lng, traveller.pos.lat], [point.lng, point.lat]);
        if (network && onRoad && roads.wantsUTurn(network, onRoad, heading)) onRoad = roads.reverse(onRoad);
      }

      // ---- Go to a place ---------------------------------------------------
      let target: LngLat | null = null;
      let planId = 0;

      async function planRoute(to: LngLat) {
        if (traveller.phase !== "idle") return;
        const id = ++planId;
        say("Finding a route…");
        const { route, fallback } = await fetchRoute(traveller.pos, to, traveller.mode);
        if (disposed || id !== planId || style !== "route") return;
        movement.setRoute(traveller, route);
        const end = route.coords[route.coords.length - 1];
        target = { lng: end[0], lat: end[1] };
        destination.lng = end[0];
        destination.lat = end[1];
        marker.group.visible = true;
        showRoute(route.coords);
        say(
          fallback
            ? "Routing is unavailable right now, so this is a straight line."
            : `On your way: ${geo.formatDistance(route.total)} by ${traveller.mode === "walk" ? "foot" : VEHICLES[traveller.mode].name.toLowerCase()}.${
                movement.canSprint(traveller.mode) ? " Hold SPRINT to go faster." : ""
              }`,
        );
      }

      function clearRoute() {
        planId++;
        movement.setRoute(traveller, null);
        target = null;
        marker.group.visible = false;
        showRoute(null);
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
        clearRoute();
        if (result.reason === "vehicle" && result.mode) {
          // The server's record of what you're riding wins (e.g. a rental that ended while you were away).
          traveller.mode = result.mode;
          await refreshVehicles();
          say(result.mode === "walk" ? "Your rental has ended, so you're on foot again." : `You're on your ${VEHICLES[result.mode].name.toLowerCase()}.`, true);
        } else {
          say("Your position was corrected to the last valid spot.", true);
        }
        if (style === "roam") buildRoads();
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
        if (style === "roam") buildRoads(); // cars keep off footpaths, bikes off steps
        else if (traveller.route && target) void planRoute(target);
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
              headTowards({ lng: started.lng, lat: started.lat });
              const away = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [started.lng, started.lat]);
              say(`Your ${vehicleName(kind)} is parked ${geo.formatDistance(away)} away (green tag). Walking you there; then open Vehicles and ride it.`, true);
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
          if (style !== "roam") actions.current?.setStyle("roam");
          headTowards({ lng: vehicle.lng, lat: vehicle.lat });
          say(`Walking to your ${vehicleName(vehicle.kind)} (green tag). When you get there, open Vehicles and ride it.`);
        },
        refuel: () => void refuelHere(),
        eat() {
          if (foodHere) void eatHere(foodHere);
        },
        setStyle(next) {
          if (next === style) return;
          style = next;
          clearRoute();
          aimTarget = null;
          setTurn(0);
          if (style === "roam") buildRoads();
          setHud((h) => ({ ...h, style: next, hint: next === "roam" ? roamHint : ROUTE_HINT, alert: false }));
        },
        turn(dir) {
          if (style !== "roam") return;
          aimTarget = null;
          setTurn(pendingTurn === dir ? 0 : dir); // pressing the same way again cancels
        },
        turnAround() {
          if (style !== "roam" || !onRoad) return;
          onRoad = roads.reverse(onRoad);
          aimTarget = null;
          setTurn(0);
        },
        stop() {
          aimTarget = null;
          if (style === "route") clearRoute();
          say(style === "roam" ? roamHint : ROUTE_HINT);
        },
        follow() {
          following = true;
          camBearing = map.getBearing();
          setHud((h) => ({ ...h, following: true }));
        },
      };

      // ---- Hunts: searching where you stand, trials and being thrown out ----
      let frozen = false; // standing still during a Key Trial

      /** Put the hunter at a spot the server has already recorded (e.g. thrown 2 km after a failed trial). */
      function placeAt(lng: number, lat: number) {
        traveller.pos = { lng, lat };
        traveller.v = 0;
        saved = { lng, lat };
        clearRoute();
        aimTarget = null;
        setTurn(0);
        network = null; // rebuilt around the new spot once its map tiles load
        onRoad = null;
        lastNetworkCheck = 0;
        actions.current?.follow();
      }

      huntActions.current = {
        async search(hunt) {
          traveller.v = 0;
          aimTarget = null;
          if (style === "route") clearRoute();
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
          if (value) {
            traveller.v = 0;
            aimTarget = null;
            if (style === "route") clearRoute();
          }
        },
        say,
      };

      // The player's own drag or rotate pauses the chase camera.
      const stopFollowing = (e: { originalEvent?: unknown }) => {
        if (!e.originalEvent) return;
        following = false;
        setHud((h) => ({ ...h, following: false }));
      };
      map.on("dragstart", stopFollowing);
      map.on("rotatestart", stopFollowing);
      map.on("click", (e) => {
        const tapped = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        if (style === "route") void planRoute(tapped);
        else headTowards(tapped);
      });
      map.on("error", (e) => {
        if (/style|Failed to fetch/i.test(String(e.error?.message))) say("Couldn't load the map. Check your connection.", true);
      });

      // ---- Game loop -------------------------------------------------------
      let frame = 0;
      let last = performance.now();
      let lastHud = 0;
      let lastServices = 0;
      let roamHintShown = false;

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t = now / 1000;
        const c = controls.current;

        if (style === "roam") {
          // Keep a road network around the player as they travel, and refresh it
          // as more map tiles load (the first build may only see one tile).
          const stale =
            !network ||
            now - lastNetworkCheck > 5000 ||
            geo.distanceM([network.centre.lng, network.centre.lat], [traveller.pos.lng, traveller.pos.lat]) > 300;
          if (stale && now - lastNetworkCheck > 1000) {
            lastNetworkCheck = now;
            const hadRoad = !!onRoad;
            if (buildRoads() && !hadRoad && !roamHintShown) {
              roamHintShown = true;
              say(roamHint);
            }
          }
        }

        // A tapped spot or a planned route moves the hunter by itself; keys move them in free roam.
        const canMove = !frozen && (style === "roam" ? !!onRoad : !!traveller.route);
        const auto = style === "roam" ? !!aimTarget : !!traveller.route;
        const { distance, events } = movement.step(traveller, { go: c.go || auto, sprint: c.sprint }, dt, t, canMove);
        for (const event of events) {
          if (event === "fainted") say("You fainted from exhaustion! Rest before your energy runs out. (In a hunt: ambulance and hospital bill.)", true);
          if (event === "recovered") say("Back on your feet.");
        }

        if (style === "roam" && network && onRoad && aimTarget) {
          // Stop on reaching the tapped spot, or once the roads stop bringing the player closer.
          const away = geo.distanceM([traveller.pos.lng, traveller.pos.lat], [aimTarget.lng, aimTarget.lat]);
          aimClosest = Math.min(aimClosest, away);
          if (away < 25) {
            aimTarget = null;
            say("You're there.");
          } else if (away > aimClosest + 60) {
            aimTarget = null;
            say("This is as close as these roads go. Tap another spot to keep going.");
          }
        }

        if (style === "roam" && network && onRoad) {
          const p0 = roads.positionOf(network, onRoad);
          if (distance > 0) {
            // Straight on, unless heading for a tapped spot.
            const here: [number, number] = [traveller.pos.lng, traveller.pos.lat];
            const aim = aimTarget ? geo.headingOf(here, [aimTarget.lng, aimTarget.lat]) : p0.heading;
            const { position, deadEnd, turned } = roads.advance(network, onRoad, distance, aim, pendingTurn);
            if (turned) setTurn(0);
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
                aimTarget = null;
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
        } else if (style === "route" && movement.advanceRoute(traveller, distance, dt, t)) {
          showRoute(null);
          target = null;
          void savePosition();
          say("You've arrived! Tap the map to go somewhere else.");
        }
        if (traveller.phase === "idle" && !traveller.route) marker.group.visible = false;

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
          if (picking.has(id) || (retryAfter.get(id) ?? 0) > now) continue;
          if (geo.distanceM([traveller.pos.lng, traveller.pos.lat], [item.lng, item.lat]) < PICKUP_RADIUS_M) void pickUp(id);
        }
        if (now - lastSync > 15000 || (syncedAt && geo.distanceM([syncedAt.lng, syncedAt.lat], [traveller.pos.lng, traveller.pos.lat]) > 200)) {
          lastSync = now;
          void syncWorld();
        }

        if (following) {
          // Chase camera: keep the camera behind the hunter.
          const want = geo.compassFromHeading(traveller.heading);
          const diff = ((want - camBearing) % 360 + 540) % 360 - 180;
          camBearing += diff * Math.min(1, 2.5 * dt);
          map.jumpTo({ center: [traveller.pos.lng, traveller.pos.lat], bearing: camBearing });
        } else {
          map.triggerRepaint();
        }

        if (now - lastSave > SAVE_EVERY_MS) {
          lastSave = now;
          void savePosition();
        }

        // Petrol stations and food within reach, and the rental meter ticking.
        if (now - lastServices > 2000) {
          lastServices = now;
          scanServices();
          if (rental) showVehicle();
        }

        if (now - lastHud > 100) {
          lastHud = now;
          const energy = Math.round(traveller.energy);
          const speedKmh = Math.round((traveller.v / movement.TIME_SCALE) * 3.6);
          const leftM = traveller.route ? Math.round(traveller.route.total - traveller.s) : null;

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
            h.leftM === leftM &&
            h.nearest?.metres === nearest?.metres &&
            h.nearest?.angle === nearest?.angle &&
            h.auto === auto
              ? h
              : { ...h, energy, speedKmh, leftM, nearest, auto },
          );
        }
      };

      map.on("load", () => {
        map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        map.addLayer(
          {
            id: "route-line",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#F4B41A", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 20, 14], "line-opacity": 0.9 },
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
      const keyDown = (e: KeyboardEvent) => {
        if (holdKeys[e.code]) {
          e.preventDefault();
          controls.current[holdKeys[e.code]] = true;
          if (e.repeat) return;
          if (backKeys.has(e.code)) actions.current?.turnAround();
          else if (holdKeys[e.code] === "go") aimTarget = null; // steering by keys replaces a tapped spot
        } else if (tapKeys[e.code]) {
          e.preventDefault();
          if (!e.repeat) tapKeys[e.code]();
        }
      };
      const keyUp = (e: KeyboardEvent) => {
        if (!holdKeys[e.code]) return;
        e.preventDefault();
        controls.current[holdKeys[e.code]] = false;
      };
      window.addEventListener("keydown", keyDown);
      window.addEventListener("keyup", keyUp);

      cleanup = () => {
        void savePosition();
        cancelAnimationFrame(frame);
        window.removeEventListener("keydown", keyDown);
        window.removeEventListener("keyup", keyUp);
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
        </div>

        {/* Row 2: how you travel, and what's nearby */}
        <div className="flex flex-wrap items-center gap-2">
        <div className="pointer-events-auto flex h-11 rounded-xl bg-ink p-1" role="group" aria-label="Travel style">
          <button type="button" aria-pressed={hud.style === "roam"} onClick={() => actions.current?.setStyle("roam")} className={segment(hud.style === "roam")}>
            Free roam
          </button>
          <button type="button" aria-pressed={hud.style === "route"} onClick={() => actions.current?.setStyle("route")} className={segment(hud.style === "route")}>
            Go to a place
          </button>
        </div>
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
        {hud.leftM !== null && (
          <div className="pointer-events-auto flex h-11 items-center gap-2 rounded-xl bg-ink px-3 text-sm">
            <span className="font-bold">{hud.leftM >= 1000 ? `${(hud.leftM / 1000).toFixed(1)} km` : `${Math.round(hud.leftM)} m`}</span>
            <span className="text-muted">to go · {hud.speedKmh} km/h</span>
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
        {hud.auto && (
          <button
            type="button"
            onClick={() => actions.current?.stop()}
            className="pointer-events-auto flex h-11 items-center gap-2 rounded-xl bg-ink px-3 text-sm font-bold"
          >
            {hud.mode === "walk" ? "Walking there" : "On the way"}
            <span className="rounded-md bg-line px-2 py-0.5 text-xs">Stop ✕</span>
          </button>
        )}
        {!hud.following && (
          <button type="button" onClick={() => actions.current?.follow()} className="pointer-events-auto h-11 rounded-xl bg-ink px-4 text-sm font-bold">
            Follow me
          </button>
        )}
        </div>

        {/* Row 3: the hunt (riddle, keys, Search here) */}
        {huntId && <HuntPanel huntId={huntId} actions={huntActions} />}
      </div>

      <p
        role="status"
        className={`absolute bottom-9 left-3 right-[104px] rounded-2xl bg-ink px-4 py-3 text-sm sm:left-1/2 sm:right-auto sm:w-[min(520px,calc(100%-24px))] sm:-translate-x-1/2 sm:text-center ${
          hud.alert ? "ring-2 ring-gold" : ""
        }`}
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

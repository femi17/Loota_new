"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import type { AvatarLook } from "@/lib/avatar";
import type { LngLat } from "@/game/geo";
import type { Mode } from "@/game/movement";
import { PICKUP_RADIUS_M, RELICS, type Lead, type RelicId, type WorldItem } from "@/game/items";
import { BagPanel } from "./BagPanel";

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
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SAVE_EVERY_MS = 4000;
const STEER_RATE = (110 * Math.PI) / 180; // radians per second while ◀ or ▶ is held

const HINTS: Record<Style, string> = {
  roam: "Free roam: hold GO to move along the road. Tap the map to aim, or steer with ◀ ▶ at junctions.",
  route: "Tap the map to choose where to go.",
};

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
}: {
  look: AvatarLook;
  start: LngLat;
  startMode: Mode;
  initialCoins: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef({ go: false, sprint: false, left: false, right: false });
  const actions = useRef<{ setMode: (m: Mode) => void; setStyle: (s: Style) => void; follow: () => void } | null>(null);
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
  });
  const [bagOpen, setBagOpen] = useState(false);

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
      let aim = traveller.heading;
      let lastNetworkCheck = 0;
      let lastDeadEndCheck = 0;

      function buildRoads() {
        const features = map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" });
        if (!features.length) return false;
        network = roads.buildNetwork(features as import("@/game/roads").RoadFeature[], traveller.mode, traveller.pos);
        onRoad = roads.snapToNetwork(network, traveller.pos, traveller.heading);
        if (!onRoad) return false;
        const p = roads.positionOf(network, onRoad);
        traveller.pos = { lng: p.lng, lat: p.lat };
        return true;
      }

      function aimAt(heading: number) {
        aim = heading;
        if (network && onRoad && roads.wantsUTurn(network, onRoad, aim)) onRoad = roads.reverse(onRoad);
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
            ? "Routing is unavailable right now, so this is a straight line. Hold GO to move."
            : `Route ready: ${geo.formatDistance(route.total)} by ${traveller.mode === "walk" ? "foot" : "bicycle"}. Hold GO, or SPRINT to go faster.`,
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
        const result = data as { ok: boolean; lng: number; lat: number };
        saved = { lng: result.lng, lat: result.lat };
        if (!result.ok) {
          // Moved faster than the game allows: go back to the last accepted spot.
          traveller.pos = { ...saved };
          traveller.v = 0;
          clearRoute();
          if (style === "roam") buildRoads();
          say("Your position was corrected to the last valid spot.", true);
        }
      }

      const saveOnHide = () => {
        if (document.visibilityState === "hidden") void savePosition();
      };
      document.addEventListener("visibilitychange", saveOnHide);

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
        setMode(mode) {
          if (traveller.phase !== "idle" || mode === traveller.mode) return;
          traveller.mode = mode;
          setHud((h) => ({ ...h, mode }));
          if (style === "roam") buildRoads(); // bicycles can't use steps, for example
          else if (traveller.route && target) void planRoute(target);
        },
        setStyle(next) {
          if (next === style) return;
          style = next;
          clearRoute();
          if (style === "roam") buildRoads();
          setHud((h) => ({ ...h, style: next, hint: HINTS[next], alert: false }));
        },
        follow() {
          following = true;
          camBearing = map.getBearing();
          setHud((h) => ({ ...h, following: true }));
        },
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
        else aimAt(geo.headingOf([traveller.pos.lng, traveller.pos.lat], [tapped.lng, tapped.lat]));
      });
      map.on("error", (e) => {
        if (/style|Failed to fetch/i.test(String(e.error?.message))) say("Couldn't load the map. Check your connection.", true);
      });

      // ---- Game loop -------------------------------------------------------
      let frame = 0;
      let last = performance.now();
      let lastHud = 0;

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
            if (buildRoads() && !hadRoad) say(HINTS.roam);
          }
          const steer = (c.left ? 1 : 0) - (c.right ? 1 : 0);
          if (steer && traveller.phase === "idle") aimAt(aim + steer * STEER_RATE * dt);
        }

        const canMove = style === "roam" ? !!onRoad : !!traveller.route;
        const { distance, events } = movement.step(traveller, c, dt, t, canMove);
        for (const event of events) {
          if (event === "fainted") say("You fainted from exhaustion! Rest before your energy runs out. (In a hunt: ambulance and hospital bill.)", true);
          if (event === "recovered") say("Back on your feet. Hold GO to continue.");
        }

        if (style === "roam" && network && onRoad && distance > 0) {
          const { position, deadEnd } = roads.advance(network, onRoad, distance, aim);
          onRoad = position;
          const p = roads.positionOf(network, onRoad);
          traveller.pos = { lng: p.lng, lat: p.lat };
          traveller.heading = geo.turnTowards(traveller.heading, p.heading, Math.min(1, 8 * dt));
          if (deadEnd) {
            traveller.v = 0;
            if (now - lastDeadEndCheck > 2000) {
              // Often just the edge of what's loaded: reload the roads and keep going if they continue.
              lastDeadEndCheck = now;
              lastNetworkCheck = now;
              buildRoads();
            } else if (onRoad) {
              onRoad = roads.reverse(onRoad);
              aim = roads.positionOf(network, onRoad).heading;
              say("This road ends here. Hold GO to head back, or tap the map to aim somewhere else.");
            }
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
            h.nearest?.angle === nearest?.angle
              ? h
              : { ...h, energy, speedKmh, leftM, nearest },
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

      const keys: Record<string, keyof typeof controls.current> = {
        Space: "go",
        ShiftLeft: "sprint",
        ShiftRight: "sprint",
        ArrowLeft: "left",
        KeyA: "left",
        ArrowRight: "right",
        KeyD: "right",
      };
      const onKey = (down: boolean) => (e: KeyboardEvent) => {
        const control = keys[e.code];
        if (!control) return;
        e.preventDefault();
        controls.current[control] = down;
      };
      const keyDown = onKey(true);
      const keyUp = onKey(false);
      window.addEventListener("keydown", keyDown);
      window.addEventListener("keyup", keyUp);

      cleanup = () => {
        void savePosition();
        cancelAnimationFrame(frame);
        window.removeEventListener("keydown", keyDown);
        window.removeEventListener("keyup", keyUp);
        document.removeEventListener("visibilitychange", saveOnHide);
        actions.current = null;
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
          {(["walk", "bicycle"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={hud.mode === m} onClick={() => actions.current?.setMode(m)} className={segment(hud.mode === m)}>
              {m === "walk" ? "Walk" : "Bicycle"}
            </button>
          ))}
        </div>
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
        {!hud.following && (
          <button type="button" onClick={() => actions.current?.follow()} className="pointer-events-auto h-11 rounded-xl bg-ink px-4 text-sm font-bold">
            Follow me
          </button>
        )}
        </div>
      </div>

      <p
        role="status"
        className={`absolute left-3 right-[136px] rounded-2xl bg-ink px-4 py-3 text-sm sm:bottom-36 sm:left-1/2 sm:right-auto sm:w-[min(520px,calc(100%-24px))] sm:-translate-x-1/2 sm:text-center ${
          hud.style === "roam" ? "bottom-[116px]" : "bottom-9" // above the ◀ ▶ buttons in free roam
        } ${hud.alert ? "ring-2 ring-gold" : ""}`}
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        {hud.hint}
      </p>

      {hud.style === "roam" && (
        <div className="absolute bottom-9 left-3 flex gap-3" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
          <HoldButton
            label="Steer left"
            onHold={(down) => {
              controls.current.left = down;
            }}
            className="size-[64px] rounded-full border-2 border-line bg-ink text-2xl data-[down=true]:border-gold data-[down=true]:bg-gold data-[down=true]:text-ink"
          >
            ◀
          </HoldButton>
          <HoldButton
            label="Steer right"
            onHold={(down) => {
              controls.current.right = down;
            }}
            className="size-[64px] rounded-full border-2 border-line bg-ink text-2xl data-[down=true]:border-gold data-[down=true]:bg-gold data-[down=true]:text-ink"
          >
            ▶
          </HoldButton>
        </div>
      )}

      {bagOpen && <BagPanel leads={hud.leads} onClose={() => setBagOpen(false)} />}

      <div className="absolute bottom-9 right-5 flex flex-col items-center gap-3" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
        <HoldButton
          onHold={(down) => {
            controls.current.sprint = down;
          }}
          className="size-[72px] rounded-full border-[3px] border-gold bg-ink text-[13px] font-extrabold tracking-wide data-[down=true]:bg-gold data-[down=true]:text-ink"
        >
          SPRINT
        </HoldButton>
        <HoldButton
          onHold={(down) => {
            controls.current.go = down;
          }}
          className="size-[104px] rounded-full bg-gold font-display text-lg font-extrabold leading-tight text-ink data-[down=true]:bg-gold-hover"
        >
          HOLD
          <br />
          TO GO
        </HoldButton>
      </div>
    </div>
  );
}

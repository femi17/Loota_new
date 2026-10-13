"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import type { AvatarLook } from "@/lib/avatar";
import type { LngLat } from "@/game/geo";
import type { Mode } from "@/game/movement";

type Hud = {
  energy: number;
  speedKmh: number;
  leftM: number | null;
  mode: Mode;
  following: boolean;
  hint: string;
  alert: boolean;
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** A button that reports while it's held down (mouse, touch or pen), for GO and SPRINT. */
function HoldButton({ onHold, className, children }: { onHold: (down: boolean) => void; className: string; children: ReactNode }) {
  const set = (e: ReactPointerEvent<HTMLButtonElement>, down: boolean) => {
    e.currentTarget.dataset.down = String(down);
    onHold(down);
  };
  return (
    <button
      type="button"
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

/** The live 3D map: the player's hunter at home, tap-to-route travel and the chase camera. */
export function GameMap({ look, home }: { look: AvatarLook; home: LngLat }) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef({ go: false, sprint: false });
  const actions = useRef<{ setMode: (m: Mode) => void; follow: () => void } | null>(null);
  const [failed, setFailed] = useState(false);
  const [hud, setHud] = useState<Hud>({
    energy: 100,
    speedKmh: 0,
    leftM: null,
    mode: "walk",
    following: true,
    hint: "Tap the map to choose where to go.",
    alert: false,
  });

  const lookKey = JSON.stringify(look);
  const homeLng = home.lng;
  const homeLat = home.lat;

  useEffect(() => {
    const home = { lng: homeLng, lat: homeLat };
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      // Map and 3D code only ever run in the browser.
      const [{ Map: MapLibre, setWorkerUrl }, geo, movement, models, { ThreeMapLayer }, { fetchRoute }] = await Promise.all([
        import("maplibre-gl"),
        import("@/game/geo"),
        import("@/game/movement"),
        import("@/game/models3d"),
        import("@/game/ThreeMapLayer"),
        import("@/game/routing"),
      ]);
      if (disposed || !container.current) return;
      // Served from public/ by scripts/copy-map-worker.mjs (the bundler doesn't serve MapLibre's worker).
      setWorkerUrl("/maplibre-gl-worker.mjs");

      const small = window.matchMedia("(max-width: 600px)").matches;
      const traveller = movement.createTraveller(home);
      const lookNow = JSON.parse(lookKey) as AvatarLook;

      const map = new MapLibre({
        container: container.current,
        style: MAP_STYLE,
        center: [home.lng, home.lat],
        zoom: small ? 20.5 : 19.5,
        pitch: small ? 55 : 60,
        bearing: geo.compassFromHeading(traveller.heading),
        maxPitch: 70,
        keyboard: false, // Space and Shift drive the hunter instead
        attributionControl: { compact: true },
      });

      const layer = new ThreeMapLayer(() => traveller.pos, small ? 40 : 32);
      const avatar = models.buildAvatar(lookNow);
      avatar.root.add(models.makeNameplate("YOU", "#2F6FEB"));
      const me = layer.add({ object: avatar.root, lng: home.lng, lat: home.lat, heading: traveller.heading });
      const marker = models.makeDestinationMarker();
      const destination = layer.add({ object: marker.group, lng: home.lng, lat: home.lat });

      const say = (hint: string, alert = false) => setHud((h) => ({ ...h, hint, alert }));
      const showRoute = (coords: [number, number][] | null) => {
        const source = map.getSource("route") as import("maplibre-gl").GeoJSONSource | undefined;
        source?.setData(
          coords
            ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }
            : { type: "FeatureCollection", features: [] },
        );
      };

      let following = true;
      let camBearing = geo.compassFromHeading(traveller.heading);
      let target: LngLat | null = null;
      let planId = 0;

      async function planRoute(to: LngLat) {
        if (traveller.phase !== "idle") return;
        const id = ++planId;
        say("Finding a route…");
        const { route, fallback } = await fetchRoute(traveller.pos, to, traveller.mode);
        if (disposed || id !== planId) return;
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

      actions.current = {
        setMode(mode) {
          if (traveller.phase !== "idle" || mode === traveller.mode) return;
          traveller.mode = mode;
          setHud((h) => ({ ...h, mode }));
          if (traveller.route && target) void planRoute(target); // re-route for the new mode
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
      map.on("click", (e) => void planRoute({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
      map.on("error", (e) => {
        if (/style|Failed to fetch/i.test(String(e.error?.message))) say("Couldn't load the map. Check your connection.", true);
      });

      let frame = 0;
      let last = performance.now();
      let lastHud = 0;

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t = now / 1000;

        const { distance, events } = movement.step(traveller, controls.current, dt, t);
        for (const event of events) {
          if (event === "fainted") say("You fainted from exhaustion! Rest before your energy runs out. (In a hunt: ambulance and hospital bill.)", true);
          if (event === "recovered") say(traveller.route ? "Back on your feet. Hold GO to continue." : "Back on your feet.");
          if (event === "arrived") {
            showRoute(null);
            target = null;
            say("You've arrived! Tap the map to go somewhere else.");
          }
        }
        if (traveller.phase === "idle" && !traveller.route) marker.group.visible = false;

        const base = movement.baseSpeed(traveller.mode);
        models.animateAvatar(
          avatar,
          { mode: traveller.mode, phase: traveller.phase, moving: traveller.v / base, distance: distance / layer.enlargement() },
          dt,
          t,
        );
        me.lng = traveller.pos.lng;
        me.lat = traveller.pos.lat;
        me.heading = traveller.heading;
        marker.halo.scale.setScalar(1 + Math.sin(t * 4) * 0.1);

        if (following) {
          // Chase camera: keep the camera behind the hunter.
          const want = geo.compassFromHeading(traveller.heading);
          const diff = ((want - camBearing) % 360 + 540) % 360 - 180;
          camBearing += diff * Math.min(1, 2.5 * dt);
          map.jumpTo({ center: [traveller.pos.lng, traveller.pos.lat], bearing: camBearing });
        } else {
          map.triggerRepaint();
        }

        if (now - lastHud > 100) {
          lastHud = now;
          setHud((h) => ({
            ...h,
            energy: Math.round(traveller.energy),
            speedKmh: Math.round(((traveller.v / movement.TIME_SCALE) * 3.6)),
            leftM: traveller.route ? traveller.route.total - traveller.s : null,
          }));
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
        // Flat map (design decision): no 3D buildings, footprints at every zoom.
        if (map.getLayer("building-3d")) map.setLayoutProperty("building-3d", "visibility", "none");
        if (map.getLayer("building")) map.setLayerZoomRange("building", 13, 24);
        map.addLayer(layer);
        frame = requestAnimationFrame(loop);
      });

      const keys: Record<string, keyof typeof controls.current> = { Space: "go", ShiftLeft: "sprint", ShiftRight: "sprint" };
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
        cancelAnimationFrame(frame);
        window.removeEventListener("keydown", keyDown);
        window.removeEventListener("keyup", keyUp);
        actions.current = null;
        map.remove();
      };
    })().catch(() => setFailed(true));

    return () => {
      disposed = true;
      cleanup();
    };
  }, [homeLng, homeLat, lookKey]);

  if (failed) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="max-w-sm">This device couldn&apos;t start the 3D map. Try a recent version of Chrome, Edge or Safari.</p>
        <Link href="/lobby" className="text-gold">Back to the lobby</Link>
      </div>
    );
  }

  const energyColour = hud.energy < 20 ? "bg-danger" : hud.energy < 50 ? "bg-gold" : "bg-[#1E9E62]";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-map">
      {/* MapLibre sets its container to position: relative, so it gets its own full-size box. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-center gap-2" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <Link href="/lobby" aria-label="Back to the lobby" className="pointer-events-auto flex size-11 items-center justify-center rounded-xl bg-ink text-paper">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div className="pointer-events-auto flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-ink px-3 sm:max-w-xs" aria-label={`Energy ${hud.energy} of 100`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#1E9E62" aria-hidden="true">
            <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
          </svg>
          <div className="h-2 flex-1 overflow-hidden rounded bg-line">
            <div className={`h-full ${energyColour}`} style={{ width: `${hud.energy}%` }} />
          </div>
          <span className="w-7 text-right text-sm font-bold">{hud.energy}</span>
        </div>
        <div className="pointer-events-auto flex h-11 rounded-xl bg-ink p-1" role="group" aria-label="Travel mode">
          {(["walk", "bicycle"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={hud.mode === m}
              onClick={() => actions.current?.setMode(m)}
              className={`rounded-lg px-3 text-sm font-bold ${hud.mode === m ? "bg-gold text-ink" : "text-paper"}`}
            >
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
      </div>

      <p
        role="status"
        className={`absolute bottom-9 left-3 right-[136px] rounded-2xl bg-ink px-4 py-3 text-sm sm:bottom-36 sm:left-1/2 sm:right-auto sm:w-[min(520px,calc(100%-24px))] sm:-translate-x-1/2 sm:text-center ${hud.alert ? "ring-2 ring-gold" : ""}`}
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        {hud.hint}
      </p>

      {!hud.following && (
        <button
          type="button"
          onClick={() => actions.current?.follow()}
          className="absolute left-3 top-[68px] h-11 rounded-xl bg-ink px-4 text-sm font-bold"
        >
          Follow me
        </button>
      )}

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

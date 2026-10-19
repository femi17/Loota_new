"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { LootaLogo } from "@/components/Logo";
import { normalizeLook } from "@/lib/avatar";
import { ordinal } from "@/game/hunt";
import type { Mode } from "@/game/movement";

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
};
type Dome = { id: string; lng: number; lat: number; radiusM: number; endsAt: string; key: number; raisedBy: string | null; needed: number; attackers: number };
type ShowEvent = { at: string; kind: string; who: string | null; whoId: string | null; text: string };
type State = {
  hunt: { id: string; title: string; prize: string; winners: number; startsAt: string; endsAt: string; phase: string; keys: number };
  hunters: Hunter[];
  domes: Dome[];
  events: ShowEvent[];
};
/** What the camera shows: the whole field, or one hunter up close. */
type View = { kind: "field" } | { kind: "follow"; id: string };

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const POLL_MS = 4000;
const LIVE_FRESH_MS = 15_000; // a live position newer than this beats the saved one
const BANNER_MS = 7000;

const eventKey = (e: ShowEvent) => `${e.at}|${e.text}`;
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
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
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
      const [{ Map: MapLibre, setWorkerUrl, LngLatBounds, Marker }, models, { ThreeMapLayer }, { createClient }, { styleMapForGame }, geo] = await Promise.all([
        import("maplibre-gl"),
        import("@/game/models3d"),
        import("@/game/ThreeMapLayer"),
        import("@/lib/supabase/client"),
        import("@/game/mapStyle"),
        import("@/game/geo"),
      ]);
      if (disposed || !container.current) return;
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

      // ---- Where each hunter is: live updates if fresh, otherwise their last saved spot.
      let latest: State | null = null;
      const live = new Map<string, { lng: number; lat: number; mode: Mode; at: number }>();
      const shown = new Map<string, { lng: number; lat: number; heading: number }>();
      const target = (h: Hunter) => {
        const l = live.get(h.id);
        if (l && Date.now() - l.at < LIVE_FRESH_MS) return { lng: l.lng, lat: l.lat, mode: l.mode };
        return h.lng != null && h.lat != null ? { lng: h.lng, lat: h.lat, mode: h.mode ?? "walk" } : null;
      };
      const channel = supabase.channel(`hunt:${huntId}`, { config: { broadcast: { self: false } } });
      channel.on("broadcast", { event: "pos" }, ({ payload }) => {
        const p = payload as { id: string; lng: number; lat: number; mode: Mode };
        if (typeof p.lng === "number") live.set(p.id, { lng: p.lng, lat: p.lat, mode: p.mode, at: Date.now() });
      });
      channel.subscribe();

      // ---- The show's state, every few seconds; new events make a banner.
      const seen = new Set<string>();
      let first = true;
      let focusUntil = 0;
      async function poll() {
        const { data, error } = await supabase.rpc("broadcast_state", { p_hunt: huntId });
        if (disposed) return;
        if (error || !data) {
          if (first) setFailed(true);
          return;
        }
        latest = data as State;
        setState(latest);
        const fresh = latest.events.filter((e) => !seen.has(eventKey(e)));
        fresh.forEach((e) => seen.add(eventKey(e)));
        if (first) {
          first = false;
          return; // events from before the broadcast opened don't get banners
        }
        const big = fresh.find((e) => e.kind !== "joined") ?? fresh[0]; // newest first; joins are the least exciting
        if (big) {
          setBanner(big);
          window.setTimeout(() => setBanner((b) => (b === big ? null : b)), BANNER_MS);
          // Auto: go to whoever made it happen.
          if (autoRef.current && big.whoId) {
            setView({ kind: "follow", id: big.whoId });
            focusUntil = Date.now() + 20_000;
          }
        }
      }
      void poll();
      const pollTimer = window.setInterval(() => void poll(), POLL_MS);

      // Auto, when nothing new is happening: the whole field, then each of the top 3 in turn.
      let autoStep = 0;
      const autoTimer = window.setInterval(() => {
        if (!autoRef.current || Date.now() < focusUntil || !latest) return;
        const leaders = latest.hunters.filter((h) => target(h)).slice(0, 3);
        const steps: View[] = [{ kind: "field" }, ...leaders.map((h) => ({ kind: "follow", id: h.id }) as View)];
        autoStep = (autoStep + 1) % steps.length;
        setView(steps[autoStep]);
      }, 18_000);

      // ---- The followed hunter in 3D.
      let followPos: { lng: number; lat: number } | null = null;
      const layer = new ThreeMapLayer(() => followPos ?? { lng: map.getCenter().lng, lat: map.getCenter().lat }, 44);
      let followed: { id: string; avatar: ReturnType<typeof models.buildAvatar>; entity: import("@/game/ThreeMapLayer").MapEntity } | null = null;
      let orbit = 0;
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

        // Glide every hunter towards where they are.
        for (const h of s.hunters) {
          const goal = target(h);
          if (!goal) continue;
          const cur = shown.get(h.id);
          if (!cur) {
            shown.set(h.id, { lng: goal.lng, lat: goal.lat, heading: 0 });
            continue;
          }
          const k = Math.min(1, 3 * dt);
          const moved = geo.distanceM([cur.lng, cur.lat], [goal.lng, goal.lat]);
          if (moved > 0.5) cur.heading = geo.turnTowards(cur.heading, geo.headingOf([cur.lng, cur.lat], [goal.lng, goal.lat]), Math.min(1, 5 * dt));
          cur.lng += (goal.lng - cur.lng) * k;
          cur.lat += (goal.lat - cur.lat) * k;
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
          const label = `${h.name} · ${h.keysHeld}/${s.hunt.keys}`;
          if (m.label !== label) {
            m.label = label;
            m.el.querySelector(".name")!.textContent = label;
          }
          m.el.dataset.kind = h.place ? "finished" : h.inTrial ? "trial" : h.id === leaderId ? "leader" : "hunter";
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
          if (h && p) {
            followPos = { lng: p.lng, lat: p.lat };
            if (!followed || followed.id !== h.id) {
              if (followed) layer.remove(followed.entity);
              const avatar = models.buildAvatar(normalizeLook(h.look));
              avatar.root.add(layer.billboard(models.makeNameplate(h.name, "#F4B41A")));
              followed = { id: h.id, avatar, entity: layer.add({ object: avatar.root, lng: p.lng, lat: p.lat, heading: p.heading }) };
            }
            const before = { lng: followed.entity.lng, lat: followed.entity.lat };
            followed.entity.lng = p.lng;
            followed.entity.lat = p.lat;
            followed.entity.heading = p.heading;
            const stepM = geo.distanceM([before.lng, before.lat], [p.lng, p.lat]);
            const mode = live.get(h.id)?.mode ?? h.mode ?? "walk";
            models.animateAvatar(followed.avatar, { mode, phase: "idle", moving: stepM > 0.02 ? 1 : 0, distance: stepM / layer.enlargement() }, dt, t / 1000);
            // Glide in close and circle slowly around them (done by hand each frame:
            // re-centring would cancel the map's own animations).
            if (viewKey !== lastView) orbit = map.getBearing();
            orbit += dt * 6;
            const k = Math.min(1, 2.2 * dt);
            const c = map.getCenter();
            map.jumpTo({
              center: [c.lng + (p.lng - c.lng) * Math.min(1, 4 * dt), c.lat + (p.lat - c.lat) * Math.min(1, 4 * dt)],
              zoom: map.getZoom() + (17.5 - map.getZoom()) * k,
              pitch: map.getPitch() + (60 - map.getPitch()) * k,
              bearing: orbit,
            });
          }
        } else {
          followPos = null;
          if (followed) {
            layer.remove(followed.entity);
            followed = null;
          }
          // Keep everyone in shot.
          if (viewKey !== lastView || t - lastFit > 8000) {
            lastFit = t;
            const points = s.hunters.map((h) => shown.get(h.id)).filter((p): p is { lng: number; lat: number; heading: number } => !!p);
            for (const d of s.domes) points.push({ lng: d.lng, lat: d.lat, heading: 0 });
            if (points.length) {
              const bounds = new LngLatBounds();
              points.forEach((p) => bounds.extend([p.lng, p.lat]));
              map.fitBounds(bounds, { padding: { top: 140, bottom: 170, left: 80, right: 400 }, maxZoom: 15, pitch: 45, bearing: 0, duration: 2000 });
            }
          }
        }
        lastView = viewKey;
      };

      map.on("load", () => {
        styleMapForGame(map);
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
        void supabase.removeChannel(channel);
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
  const keyDots = (held: number, total: number) => "●".repeat(Math.min(held, total)) + "○".repeat(Math.max(0, total - held));

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-map">
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>

      {/* Title card */}
      {hunt && (
        <div className="pointer-events-none absolute left-5 top-5 flex max-w-md flex-col gap-1 rounded-2xl bg-ink/90 px-5 py-4 text-paper shadow-lg">
          <div className="flex items-center gap-2 text-xs font-extrabold tracking-widest">
            {hunt.phase === "live" ? (
              <span className="flex items-center gap-1.5 rounded bg-danger px-2 py-0.5 text-white">
                <span className="size-2 animate-pulse rounded-full bg-white" /> LIVE
              </span>
            ) : (
              <span className="rounded bg-line px-2 py-0.5 uppercase">{hunt.phase}</span>
            )}
            <LootaLogo height={30} tone="gold" />
          </div>
          <h1 className="font-display text-2xl font-extrabold leading-tight">{hunt.title}</h1>
          <p className="text-sm">
            <span className="text-paper/70">Prize: </span>
            <b>{hunt.prize}</b>
          </p>
          <p className="text-sm text-paper/70">
            {hunt.keys} keys · {hunt.winners} winners · {state?.hunters.length ?? 0} hunters
            {hunt.phase === "live" ? ` · ends in ${timeLeft(hunt.endsAt, now)}` : ""}
          </p>
          {state?.domes.map((d) => (
            <p key={d.id} className="mt-1 rounded-lg bg-[#3A1E5C] px-2 py-1 text-sm">
              🔒 {d.raisedBy ?? "Someone"}&apos;s dome over Key {d.key} · {timeLeft(d.endsAt, now)} · siege {d.attackers}/{d.needed}
            </p>
          ))}
        </div>
      )}

      {/* Leaderboard (click a name to follow them) */}
      {state && (
        <div className="absolute right-5 top-5 flex w-[340px] flex-col gap-1 rounded-2xl bg-ink/90 p-4 text-paper shadow-lg">
          <h2 className="mb-1 font-display text-lg font-extrabold">Leaderboard</h2>
          {state.hunters.length === 0 && <p className="text-sm text-paper/70">No hunters yet.</p>}
          {state.hunters.slice(0, 12).map((h, i) => (
            <button
              key={h.id}
              type="button"
              onClick={() => {
                setAuto(false);
                setView({ kind: "follow", id: h.id });
              }}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${following?.id === h.id ? "bg-gold text-ink" : "hover:bg-ink-2"}`}
            >
              <span className="w-6 font-bold">{i + 1}</span>
              <span className="flex-1 truncate font-bold">{h.name}</span>
              {h.inTrial && <span className="rounded bg-[#9B5DE5] px-1.5 text-xs text-white">TRIAL</span>}
              <span className="font-mono tracking-tighter">{h.place ? `🏁 ${ordinal(h.place)}` : keyDots(h.keysHeld, state.hunt.keys)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Big banner for what just happened */}
      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-1/4 flex justify-center px-6">
          <p className="max-w-3xl animate-[pulse_1.2s_ease-in-out_2] rounded-3xl bg-gold px-8 py-5 text-center font-display text-3xl font-extrabold text-ink shadow-2xl">
            {banner.text}
          </p>
        </div>
      )}

      {/* Ticker */}
      {state && state.events.length > 0 && (
        <div className="pointer-events-none absolute bottom-5 left-5 right-[380px] flex flex-col gap-1">
          {state.events.slice(0, 4).map((e, i) => (
            <p key={eventKey(e)} className={`w-fit max-w-full truncate rounded-xl px-4 py-2 text-paper ${i === 0 ? "bg-ink text-base font-bold" : "bg-ink/75 text-sm"}`}>
              <span className="mr-2 text-paper/60">{ago(e.at, now)}</span>
              {e.text}
            </p>
          ))}
        </div>
      )}

      {/* Controls (H hides them) */}
      {controls && (
        <div className="absolute bottom-5 right-5 flex w-[340px] flex-wrap items-center gap-2 rounded-2xl bg-ink/90 p-3 text-sm text-paper">
          <button
            type="button"
            onClick={() => {
              setAuto(false);
              setView({ kind: "field" });
            }}
            className={`rounded-lg px-3 py-2 font-bold ${view.kind === "field" && !auto ? "bg-gold text-ink" : "bg-ink-2"}`}
          >
            Whole field
          </button>
          <button
            type="button"
            onClick={() => setAuto((a) => !a)}
            className={`rounded-lg px-3 py-2 font-bold ${auto ? "bg-gold text-ink" : "bg-ink-2"}`}
          >
            Auto {auto ? "on" : "off"}
          </button>
          <span className="text-xs text-paper/70">{following ? `Following ${following.name}` : "Whole field"} · H hides</span>
        </div>
      )}
    </div>
  );
}

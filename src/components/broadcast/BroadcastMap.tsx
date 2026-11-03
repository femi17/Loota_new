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
/** A jump this far between two positions (a flight, a hop) is a cut, not a slide across the map. */
const JUMP_M = 1500;
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
  // The leaderboard folds to its 🏆 button (folded to start with on a phone).
  const [board, setBoard] = useState(true);
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

      // ---- Where each hunter is: live updates if fresh, otherwise their last saved spot.
      let latest: State | null = null;
      const live = new Map<string, { lng: number; lat: number; mode: Mode; at: number }>();
      const shown = new Map<string, { lng: number; lat: number; heading: number }>();
      // Every position heard, per hunter. Each is drawn a little in the past, gliding between the two positions around
      // that moment, so they walk and ride smoothly instead of leaping to each new one and waiting (owner, 3 Nov 2026:
      // "the movement on there leaps like a frog"). `gap`: the usual time between their positions.
      // `delay`: how far behind they're drawn; it follows the gap between positions gently (a sudden change would make
      // them dash or stall).
      type Track = { samples: { t: number; lng: number; lat: number }[]; gap: number; arrived: number; delay: number };
      const tracks = new Map<string, Track>();
      const delayFor = (gap: number) => Math.min(5000, gap * 1.3 + 250);
      const delayOf = (tr: Track) => tr.delay;
      const heard = (id: string, lng: number, lat: number) => {
        const now = performance.now();
        let tr = tracks.get(id);
        if (!tr) tracks.set(id, (tr = { samples: [], gap: 1000, arrived: now, delay: delayFor(1000) }));
        const last = tr.samples[tr.samples.length - 1];
        if (last) {
          // Late: the hunter has been waiting at the last spot heard; go on from there, not with a dash to catch up.
          const drawn = now - delayOf(tr);
          if (drawn > last.t) last.t = drawn;
          tr.gap = tr.gap * 0.7 + Math.min(6000, Math.max(300, now - tr.arrived)) * 0.3;
          if (geo.distanceM([last.lng, last.lat], [lng, lat]) > JUMP_M) tr.samples = [];
        }
        tr.arrived = now;
        tr.samples.push({ t: now, lng, lat });
        if (tr.samples.length > 10) tr.samples.shift();
      };
      const placeAt = (tr: Track, now: number, dtMs: number) => {
        const list = tr.samples;
        const want = delayFor(tr.gap);
        tr.delay += Math.max(-0.15 * dtMs, Math.min(0.15 * dtMs, want - tr.delay));
        const r = now - tr.delay;
        if (r <= list[0].t) return list[0];
        for (let i = 1; i < list.length; i++) {
          if (r > list[i].t) continue;
          const a = list[i - 1], b = list[i];
          const f = (r - a.t) / (b.t - a.t || 1);
          return { lng: a.lng + (b.lng - a.lng) * f, lat: a.lat + (b.lat - a.lat) * f };
        }
        return list[list.length - 1];
      };
      // For the browser tests (in development only): where each hunter is drawn now.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __broadcastShown?: () => object }).__broadcastShown = () => ({ ...Object.fromEntries(shown), drawnAt: drawnAt });
      let drawnAt = 0; // the last frame's time
      const freshLive = (id: string) => {
        const l = live.get(id);
        return !!l && Date.now() - l.at < LIVE_FRESH_MS;
      };
      const channel = supabase.channel(`hunt:${huntId}`, { config: { broadcast: { self: false } } });
      channel.on("broadcast", { event: "pos" }, ({ payload }) => {
        const p = payload as { id: string; lng: number; lat: number; mode: Mode };
        if (typeof p.lng !== "number" || typeof p.lat !== "number") return;
        live.set(p.id, { lng: p.lng, lat: p.lat, mode: p.mode, at: Date.now() });
        heard(p.id, p.lng, p.lat);
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
        // Saved spots, for hunters not heard live just now.
        for (const h of latest.hunters) if (h.lng != null && h.lat != null && !freshLive(h.id)) heard(h.id, h.lng, h.lat);
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
        // Auto: go to whoever made it happen.
        if (autoRef.current && e.whoId) {
          setView({ kind: "follow", id: e.whoId });
          focusUntil = Date.now() + 20_000;
        }
        // Shorter when more are waiting.
        bannerTimer = window.setTimeout(() => !disposed && nextBanner(), queue.length ? BANNER_MS / 2 : BANNER_MS);
      }
      let bannerTimer = 0;
      void poll();
      const pollTimer = window.setInterval(() => void poll(), POLL_MS);

      // Auto, when nothing new is happening: the whole field, then each of the top 3 in turn.
      let autoStep = 0;
      const autoTimer = window.setInterval(() => {
        if (!autoRef.current || Date.now() < focusUntil || !latest) return;
        const leaders = latest.hunters.filter((h) => tracks.has(h.id)).slice(0, 3);
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

        drawnAt = t;
        // Every hunter where they were a moment ago, between the positions heard.
        for (const h of s.hunters) {
          const tr = tracks.get(h.id);
          if (!tr?.samples.length) continue;
          const at = placeAt(tr, t, dt * 1000);
          const cur = shown.get(h.id);
          if (!cur) {
            shown.set(h.id, { lng: at.lng, lat: at.lat, heading: 0 });
            continue;
          }
          const moved = geo.distanceM([cur.lng, cur.lat], [at.lng, at.lat]);
          if (moved > 0.05) cur.heading = geo.turnTowards(cur.heading, geo.headingOf([cur.lng, cur.lat], [at.lng, at.lat]), Math.min(1, 8 * dt));
          cur.lng = at.lng;
          cur.lat = at.lat;
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
              const phone = window.innerWidth < 640;
              map.fitBounds(bounds, { padding: phone ? { top: 100, bottom: 150, left: 70, right: 70 } : { top: 90, bottom: 110, left: 60, right: 260 }, maxZoom: 15, pitch: 45, bearing: 0, duration: 2000 });
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
        window.clearTimeout(bannerTimer);
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

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-map">
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

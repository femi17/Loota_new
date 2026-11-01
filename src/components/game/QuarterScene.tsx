"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createClient } from "@/lib/supabase/client";
import type { AvatarLook } from "@/lib/avatar";
import { animateAvatar, buildAvatar } from "@/game/models3d";
import { outTo, roomAt, routeTo, type Built, type HouseObjectView, type HouseRoomView, type HouseStyle, type Plan } from "@/game/house3d";
import { buildQuarter } from "@/game/quarter3d";
import type { Penalty } from "./PenaltyCard";

type Item = { id: string; name: string; icon: string };
type QuarterView = {
  ok: boolean;
  reason?: string;
  key: number;
  title: string;
  style: HouseStyle;
  layout?: string | null;
  /** The plot the hunter stands on, and the one they dug. */
  room: string | null;
  dug?: string | null;
  outUntil: string | null;
  rooms: HouseRoomView[];
  objects: HouseObjectView[];
  items: Item[];
  at: { lng: number; lat: number };
};
type Point = { x: number; z: number };
type Dug = Partial<QuarterView> & { locked?: boolean; text?: string; trap?: boolean; used?: { name: string } | null; penalty?: Penalty & { balance: number | null; energy: number | null }; until?: string; dodge?: { prompt: string; options: string[]; seconds: number } };

const SPEED = 3.2; // metres a second, walking about
const AVATAR = 0.8; // the hunter's size in the quarter
const FOLLOW_M = 15; // on the street, about this many metres across the screen round the hunter
const REFUSED: Record<string, string> = {
  away: "You've moved away from this place.",
  no_house: "There's nothing to search here.",
  not_live: "The hunt isn't on right now.",
  not_hunting: "You're not in this hunt.",
  dodge: "Answer the challenge first!",
};

const within = (p: Point, r: { x: number; z: number; w: number; d: number }, pad = 0) => Math.abs(p.x - r.x) <= r.w / 2 + pad && Math.abs(p.z - r.z) <= r.d / 2 + pad;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
/** Where the hunter may stand: the street (and the way in), or a plot, crossing its hedge only at its gate. */
function walkable(plan: Plan, from: Point, to: Point, locked: (i: number) => boolean) {
  const onStreet = (p: Point) => plan.walks.some((w) => within(p, w, -0.3)) || within(p, plan.porch, 0.2);
  const a = roomAt(plan, from), b = roomAt(plan, to);
  if (b >= 0) {
    if (a === b) return within(to, plan.rooms[b], -0.45);
    return !locked(b) && dist(to, plan.rooms[b].door) < 1.3;
  }
  if (a >= 0) return dist(from, plan.rooms[a].door) < 1.3 && (onStreet(to) || dist(to, plan.rooms[a].door) < 1.3);
  return onStreet(to);
}

/**
 * The key's quarter (owner, 1 Nov 2026: "we create our own open street, which is still inside the key location… where
 * user can walk freely on their own to figure where the treasure is actually buried"). The hunter walks the street and
 * the plots freely (tap where to go; arrow keys or WASD on a computer); stepping onto a plot is free; ⛏ Dig is the
 * choice: a trap's challenge, nothing, or the chest. Only the server knows which plot is which.
 */
export function QuarterScene({
  huntId,
  look,
  onClose,
  onOpenChest,
  onPenalty,
  onMoved,
}: {
  huntId: string;
  look: AvatarLook;
  onClose: () => void;
  /** The chest, dug up: open it (the map's usual search, which starts the Key Trial). */
  onOpenChest: () => void;
  /** A trap: the penalty card shows; the quarter closes. */
  onPenalty: (p: Penalty & { balance: number | null; energy: number | null }) => void;
  /** The server stood the hunter at the place. */
  onMoved: (at: { lng: number; lat: number }) => void;
}) {
  const [supabase] = useState(createClient);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<QuarterView | null>(null);
  const [say, setSay] = useState<string>("Walk about: tap the street or a plot (or its name below). When you think you know where the key is buried, stand on that plot and dig.");
  const [standing, setStanding] = useState(-1); // the plot the hunter is on (-1: the street)
  const [wide, setWide] = useState(false); // the whole quarter asked for
  const wideRef = useRef(wide);
  useEffect(() => {
    wideRef.current = wide;
  }, [wide]);
  const [busy, setBusy] = useState(false);
  const [gained, setGained] = useState<Item | null>(null);
  const [dodge, setDodge] = useState<{ room: number; prompt: string; options: string[]; seconds: number } | null>(null);
  const scene = useRef<{ built: Built; walkTo: (path: Point[]) => Promise<void>; at: () => Point; shake: () => void; trap: (kind: string, room: number) => void } | null>(null);
  const viewRef = useRef<QuarterView | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // The quarter from the server; then the 3D scene round it.
  useEffect(() => {
    let live = true;
    void supabase.rpc("house_view", { p_hunt: huntId }).then(({ data }) => {
      if (!live) return;
      const v = data as QuarterView | null;
      if (!v?.ok) {
        // A challenge left unanswered last time: its trap springs now.
        const left = (v as { penalty?: Penalty & { balance: number | null; energy: number | null } } | null)?.penalty;
        if (left) return onPenalty(left);
        setSay(REFUSED[v?.reason ?? ""] ?? "This place won't open right now.");
        return;
      }
      onMoved(v.at);
      setView(v);
    });
    return () => {
      live = false;
    };
    // Once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huntId]);

  // Stepping onto a plot (or off it): the server notes it (and opens a gate with the thing it needs).
  const stepRef = useRef<(i: number) => Promise<boolean>>(async () => true);
  useEffect(() => {
    stepRef.current = async (i: number) => {
      const v = viewRef.current;
      if (!v) return false;
      const { data } = await supabase.rpc("house_step", { p_hunt: huntId, p_room: i >= 0 ? v.rooms[i].id : null });
      const r = data as (Partial<QuarterView> & { locked?: boolean; text?: string; used?: { name: string } | null; reason?: string }) | null;
      if (!r?.ok) {
        setSay(REFUSED[r?.reason ?? ""] ?? "You can't go there right now.");
        return false;
      }
      if (r.locked) {
        setSay(`🔒 ${v.rooms[i].name}: ${r.text}`);
        return false;
      }
      setView((old) => (old ? { ...old, ...(r as QuarterView) } : old));
      if (i >= 0) {
        if (r.used) scene.current?.built.setLocked(v.rooms[i].id, false);
        setSay(r.used ? `You use ${r.used.name}: the gate of ${v.rooms[i].name} opens.` : `📍 ${v.rooms[i].name}. Look around, or dig if you think it's here.`);
      }
      return true;
    };
  });

  const built = !!view;
  useEffect(() => {
    const v = viewRef.current;
    const el = host.current;
    if (!built || !v || !el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    world.background = new THREE.Color("#1B2230");
    world.add(new THREE.HemisphereLight("#FFF4E0", "#3A4250", 2.0));
    const sun = new THREE.DirectionalLight("#FFFFFF", 1.4);
    sun.position.set(6, 12, 8);
    world.add(sun);
    const quarter = buildQuarter(v.rooms, v.objects, v.style, v.title, v.layout);
    world.add(quarter.group);
    const plan = quarter.plan;
    const B = plan.bounds;
    const centre = new THREE.Vector3(plan.centre.x, 0, plan.centre.z);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
    // Looking in from the front-right, a little from above; framed in the screen left between the bars.
    const camOff = new THREE.Vector3(Math.sin(Math.PI / 4), 1.15, Math.cos(Math.PI / 4)).normalize().multiplyScalar(40);
    camera.position.copy(centre).add(camOff);
    camera.lookAt(centre);
    camera.updateMatrixWorld();
    const boxAround = (x0: number, x1: number, z0: number, z1: number) => {
      const out: THREE.Vector3[] = [];
      for (const x of [x0, x1]) for (const y of [0, 3.8]) for (const z of [z0, z1]) out.push(new THREE.Vector3(x, y, z));
      return out;
    };
    const screen = { w: 1, h: 1, top: 0, free: 1 };
    const goal = { cx: 0, cy: 0, sc: 0 };
    const cur = { cx: 0, cy: 0, sc: 0 };
    /** Frame a box: its middle in the middle of the free screen, filling it. */
    const frameOn = (corners: THREE.Vector3[], fill: number) => {
      const xs: number[] = [], ys: number[] = [];
      for (const c of corners) {
        const p = c.clone().applyMatrix4(camera.matrixWorldInverse);
        xs.push(p.x);
        ys.push(p.y);
      }
      goal.sc = Math.max((Math.max(...xs) - Math.min(...xs)) / screen.w, (Math.max(...ys) - Math.min(...ys)) / screen.free) * fill;
      goal.cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      goal.cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (!cur.sc) Object.assign(cur, goal);
    };
    const project = () => {
      const t = cur.cy + (screen.top + screen.free / 2) * cur.sc;
      Object.assign(camera, { left: cur.cx - (screen.w / 2) * cur.sc, right: cur.cx + (screen.w / 2) * cur.sc, top: t, bottom: t - screen.h * cur.sc });
      camera.updateProjectionMatrix();
    };
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      const root = el.parentElement;
      const head = root?.querySelector<HTMLElement>("[data-house-head]")?.offsetHeight ?? 0;
      const bottom = root?.querySelector<HTMLElement>("[data-house-foot]")?.offsetHeight ?? 0;
      root?.style.setProperty("--house-head", `${head}px`);
      const top = Math.round(head * 0.55);
      Object.assign(screen, { w, h, top, free: Math.max(120, h - top - bottom) });
    };
    fit();
    const sizes = new ResizeObserver(() => fit());
    sizes.observe(el);
    for (const bar of el.parentElement?.querySelectorAll("[data-house-head], [data-house-foot]") ?? []) sizes.observe(bar);

    // The hunter, at the way in (or on the plot they were on)
    const av = buildAvatar(look);
    av.root.scale.setScalar(AVATAR);
    av.root.position.set(plan.start.x, 0.1, plan.start.z);
    av.root.rotation.y = Math.atan2(plan.entrance.x - plan.start.x, plan.entrance.z - plan.start.z);
    world.add(av.root);
    if (v.room) {
      const i = v.rooms.findIndex((r) => r.id === v.room);
      if (i >= 0) av.root.position.set(plan.rooms[i].inside.x, 0.1, plan.rooms[i].inside.z);
    }
    if (v.dug) quarter.setChest(v.rooms.find((r) => r.id === v.dug && r.chest)?.id ?? null);
    let path: Point[] = [];
    let arrive: (() => void) | null = null;
    let shakeUntil = 0;
    const walkTo = (p: Point[]) =>
      new Promise<void>((resolve) => {
        arrive?.();
        path = p.slice();
        arrive = resolve;
      });

    // Arrow keys / WASD: walk where the screen points (up is away from you), within the street and the plots.
    const keys = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      const k = { ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d", ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r" }[e.code];
      if (!k || (e.target as HTMLElement)?.tagName === "INPUT") return;
      e.preventDefault();
      if (e.type === "keydown") keys.add(k);
      else keys.delete(k);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    const ahead = new THREE.Vector3(-camOff.x, 0, -camOff.z).normalize(); // "up" on the screen, on the ground
    const rightward = new THREE.Vector3(-ahead.z, 0, ahead.x);

    // Trap animations (owner, 31 Oct 2026: like the movies): each runs for a second or so; true when done.
    const fx: ((t: number) => boolean)[] = [];
    const soft = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const trap = (kind: string, i: number) => {
      const t0 = performance.now();
      const room = plan.rooms[i];
      const me = av.root.position.clone();
      const ease = (t: number) => Math.min(1, Math.max(0, (t - t0) / 1000));
      shakeUntil = t0 + 900;
      if (kind === "collapse" || kind === "fall") {
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.02, 24), soft("#050505", 0.95));
        hole.position.set(me.x, 0.15, me.z);
        world.add(hole);
        fx.push((t) => {
          const k = ease(t);
          hole.scale.setScalar(Math.min(1, k * 3));
          if (k > 0.3) av.root.position.y = 0.1 - (k - 0.3) * 4;
          return k >= 1;
        });
      } else if (kind === "flood") {
        const water = new THREE.Mesh(new THREE.BoxGeometry(room.w, 1, room.d), soft("#2E7FBF", 0.55));
        water.position.set(room.x, 0, room.z);
        world.add(water);
        fx.push((t) => {
          const k = ease(t);
          water.scale.y = 0.05 + k * 1.6;
          water.position.y = (0.05 + k * 1.6) / 2;
          return k >= 1;
        });
      } else if (kind === "smoke" || kind === "gas" || kind === "fire") {
        const color = kind === "gas" ? "#7FBF5E" : kind === "fire" ? "#F07A28" : "#B9B9B9";
        const puffs = Array.from({ length: 9 }, (_, j) => {
          const puff = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), soft(color, 0.6));
          puff.position.set(me.x + Math.cos(j) * 0.4, 0.5 + (j % 3) * 0.4, me.z + Math.sin(j) * 0.4);
          world.add(puff);
          return puff;
        });
        fx.push((t) => {
          const k = ease(t);
          puffs.forEach((p, j) => {
            p.scale.setScalar(1 + k * 3);
            p.position.y += 0.01 * (j % 3 + 1);
            (p.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k * 0.5);
          });
          return k >= 1;
        });
      } else if (kind === "darts" || kind === "swarm") {
        const bits = Array.from({ length: 14 }, (_, j) => {
          const b = new THREE.Mesh(kind === "darts" ? new THREE.BoxGeometry(0.05, 0.05, 0.35) : new THREE.SphereGeometry(0.09, 6, 4), soft(kind === "darts" ? "#C8A45C" : "#1A1A1A", 1));
          b.position.set(room.x + (j % 5 - 2) * 0.5, 1 + (j % 3) * 0.3, room.z - room.d / 2);
          b.userData.from = b.position.clone();
          world.add(b);
          return b;
        });
        fx.push((t) => {
          const k = ease(t);
          bits.forEach((b, j) => {
            const kk = Math.min(1, k * 1.4 - j * 0.03);
            if (kk > 0) b.position.lerpVectors(b.userData.from as THREE.Vector3, new THREE.Vector3(me.x, 1.1 + Math.sin(j) * 0.2, me.z), kk);
            b.lookAt(me.x, 1.1, me.z);
          });
          return k >= 1;
        });
      } else if (kind === "net" || kind === "cage") {
        const net = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 1.4), new THREE.MeshBasicMaterial({ color: kind === "cage" ? "#3A3A3A" : "#C9B27E", wireframe: true }));
        net.position.set(me.x, 5, me.z);
        world.add(net);
        fx.push((t) => {
          const k = ease(t);
          net.position.y = Math.max(1.1, 5 - k * 8);
          return k >= 1;
        });
      } else if (kind === "boulder") {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 1), new THREE.MeshLambertMaterial({ color: "#7E7A70" }));
        rock.position.set(room.x, 0.9, room.z - room.d / 2 + 0.9);
        const from = rock.position.clone();
        world.add(rock);
        fx.push((t) => {
          const k = ease(t);
          rock.position.lerpVectors(from, new THREE.Vector3(me.x, 0.9, me.z), Math.min(1, k * 1.2));
          rock.rotation.x -= 0.15;
          return k >= 1;
        });
      } else {
        // The Masquerade, a mirror, a storm, a snake: the light flickers
        fx.push((t) => {
          const k = ease(t);
          world.background = new THREE.Color(Math.floor(k * 12) % 2 ? "#3A0A0A" : "#1B2230");
          return k >= 1;
        });
      }
    };

    let raf = 0;
    let last = performance.now();
    let lastPlot = -2;
    let stepping = false;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (let j = fx.length - 1; j >= 0; j--) if (fx[j](now)) fx.splice(j, 1);
      let moved = 0;
      const next = path[0];
      if (next) {
        const dx = next.x - av.root.position.x, dz = next.z - av.root.position.z;
        const d = Math.hypot(dx, dz);
        const step = SPEED * dt;
        if (d <= step) {
          av.root.position.x = next.x;
          av.root.position.z = next.z;
          path.shift();
          moved = d;
          if (!path.length) {
            const done = arrive;
            arrive = null;
            done?.();
          }
        } else {
          av.root.position.x += (dx / d) * step;
          av.root.position.z += (dz / d) * step;
          av.root.rotation.y = Math.atan2(dx, dz);
          moved = step;
        }
      } else if (keys.size && !busyRef.current && !stepping) {
        const dir = new THREE.Vector3();
        if (keys.has("u")) dir.add(ahead);
        if (keys.has("d")) dir.sub(ahead);
        if (keys.has("r")) dir.add(rightward);
        if (keys.has("l")) dir.sub(rightward);
        if (dir.lengthSq() > 0) {
          dir.normalize().multiplyScalar(SPEED * dt);
          const from = { x: av.root.position.x, z: av.root.position.z };
          const to = { x: from.x + dir.x, z: from.z + dir.z };
          const locked = (i: number) => viewRef.current?.rooms[i]?.locked === true;
          if (walkable(plan, from, to, locked)) {
            av.root.position.x = to.x;
            av.root.position.z = to.z;
            av.root.rotation.y = Math.atan2(dir.x, dir.z);
            moved = dir.length();
          } else {
            const into = roomAt(plan, to);
            if (into >= 0 && locked(into) && dist(to, plan.rooms[into].door) < 1.3) setSay(`🔒 ${viewRef.current?.rooms[into]?.name}: the gate is shut. Tap it.`);
          }
        }
      }
      animateAvatar(av, { mode: "walk", phase: "idle", moving: moved > 0 ? 1 : 0, distance: moved / AVATAR }, dt, now / 1000);

      // Onto a plot or off it: tell the server; the camera frames the plot, or follows the hunter on the street.
      const at = { x: av.root.position.x, z: av.root.position.z };
      const here = roomAt(plan, at);
      if (here !== lastPlot) {
        const was = lastPlot;
        lastPlot = here;
        setStanding(here);
        if (here >= 0 && wideRef.current) setWide(false);
        // Walked (not routed): the server hears of it now. A routed walk tells it on the way (the tap does).
        if (!path.length && was !== -2 && !busyRef.current) {
          stepping = true;
          void stepRef.current(here).finally(() => (stepping = false));
        }
      }
      if (wideRef.current) frameOn(boxAround(B.minX - 1, B.maxX + 1, B.minZ - 1, B.maxZ + 1), 1.04);
      else if (here >= 0) {
        const r = plan.rooms[here];
        frameOn(boxAround(r.x - r.w / 2 - 0.6, r.x + r.w / 2 + 0.6, r.z - r.d / 2 - 0.6, r.z + r.d / 2 + 0.6), 1.05);
      } else frameOn(boxAround(at.x - FOLLOW_M / 2, at.x + FOLLOW_M / 2, at.z - FOLLOW_M / 2, at.z + FOLLOW_M / 2), 0.75);
      const k = 1 - Math.exp(-4 * dt);
      cur.cx += (goal.cx - cur.cx) * k;
      cur.cy += (goal.cy - cur.cy) * k;
      cur.sc += (goal.sc - cur.sc) * k;
      project();
      camera.position.copy(centre).add(camOff);
      if (now < shakeUntil) camera.position.x += (Math.random() - 0.5) * 0.5;
      camera.lookAt(centre);
      renderer.render(world, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Taps: whatever was touched, if it's showing (with the spot on the ground)
    const ray = new THREE.Raycaster();
    const tapAt = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(quarter.targets, true).find((h) => {
        for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (!o.visible) return false;
        return true;
      });
      const data = hit?.object.userData as { tap?: string; id?: string } | undefined;
      if (data?.tap) window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: { tap: data.tap, id: data.id, x: hit!.point.x, z: hit!.point.z } }));
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) tapAt(e);
      down = null;
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    scene.current = {
      built: quarter,
      walkTo,
      at: () => ({ x: av.root.position.x, z: av.root.position.z }),
      shake: () => (shakeUntil = performance.now() + 700),
      trap,
    };
    return () => {
      cancelAnimationFrame(raf);
      sizes.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.dispose();
      renderer.domElement.remove();
      scene.current = null;
    };
  }, [built, look]);

  /** Walk onto plot i (stopping at a shut gate); true once on it. */
  const goOnto = async (i: number) => {
    const s = scene.current;
    const v = viewRef.current;
    if (!s || !v) return false;
    if (roomAt(s.built.plan, s.at()) === i) return true;
    await s.walkTo(routeTo(s.built.plan, s.at(), i, false));
    if (!(await stepRef.current(i))) return false;
    await s.walkTo([s.built.plan.rooms[i].inside]);
    return true;
  };

  // A tap in the quarter: walk there (the server hears where you stand).
  useEffect(() => {
    const onTap = async (e: Event) => {
      const { tap, id, x, z } = (e as CustomEvent<{ tap: string; id: string; x?: number; z?: number }>).detail;
      const v = viewRef.current;
      const s = scene.current;
      if (!v || !s || busy) return;
      const pl = s.built.plan;
      if (tap === "out") {
        setSay("That's the way out. Tap Leave when you're done here.");
        await s.walkTo([...outTo(pl, s.at()), pl.entrance, pl.start]);
        return void stepRef.current(-1);
      }
      if (tap === "hall") {
        // Anywhere on the street: there (kept off the kerb)
        const w = pl.walks.find((wk) => within({ x: x ?? 0, z: z ?? 0 }, wk)) ?? pl.walks[0];
        const to = { x: Math.max(w.x - w.w / 2 + 0.4, Math.min(w.x + w.w / 2 - 0.4, x ?? w.x)), z: Math.max(w.z - w.d / 2 + 0.4, Math.min(w.z + w.d / 2 - 0.4, z ?? w.z)) };
        const leaving = roomAt(pl, s.at()) >= 0;
        await s.walkTo([...outTo(pl, s.at()), to]);
        if (leaving) void stepRef.current(-1);
        return;
      }
      if (tap === "chest") {
        setSay("You kneel by the chest…");
        return onOpenChest();
      }
      const roomId = tap === "room" ? id : v.objects.find((o) => o.id === id)?.room;
      const i = v.rooms.findIndex((r) => r.id === roomId);
      if (i < 0) return;
      setBusy(true);
      try {
        if (!(await goOnto(i))) return;
        if (tap === "room" && x !== undefined && z !== undefined) {
          // Tapped somewhere on the plot: there (inside its hedge)
          const r = pl.rooms[i];
          await s.walkTo([{ x: Math.max(r.x - r.w / 2 + 0.7, Math.min(r.x + r.w / 2 - 0.7, x)), z: Math.max(r.z - r.d / 2 + 0.7, Math.min(r.z + r.d / 2 - 0.7, z)) }]);
        }
        if (tap === "object") {
          const r = pl.rooms[i];
          await s.walkTo([{ x: (r.inside.x + r.x) / 2, z: (r.inside.z + r.z) / 2 }]);
          const { data } = await supabase.rpc("house_touch", { p_hunt: huntId, p_object: id });
          const t = data as (Partial<QuarterView> & { text?: string; gained?: Item | null }) | null;
          if (!t?.ok) return setSay("You can't reach that from here.");
          setView((old) => (old ? { ...old, ...(t as QuarterView) } : old));
          setSay(t.text ?? "");
          if (t.gained) {
            setGained(t.gained);
            setTimeout(() => setGained(null), 2600);
          }
        }
      } finally {
        setBusy(false);
      }
    };
    window.addEventListener("loota:house-tap", onTap);
    return () => window.removeEventListener("loota:house-tap", onTap);
  }, [busy, huntId, onClose, onOpenChest, supabase]);

  /** ⛏ Dig here: the server decides (a trap's challenge, nothing, or the chest). */
  async function dig() {
    const s = scene.current;
    const v = viewRef.current;
    if (!s || !v || busy) return;
    const i = roomAt(s.built.plan, s.at());
    if (i < 0) return;
    setBusy(true);
    try {
      const { data } = await supabase.rpc("house_enter", { p_hunt: huntId, p_room: v.rooms[i].id });
      const r = data as Dug | null;
      if (!r?.ok) {
        if (r?.reason === "out") setSay(`Catch your breath first: ${Math.max(1, Math.ceil((Date.parse(r.until ?? "") - Date.now()) / 1000))} s.`);
        else setSay(REFUSED[r?.reason ?? ""] ?? "The ground won't give here.");
        return;
      }
      if (r.locked) return setSay(`🔒 ${v.rooms[i].name}: ${r.text}`);
      if (r.trap && r.dodge) {
        s.shake();
        setSay(`Your spade hits something that clicks…`);
        setDodge({ room: i, ...r.dodge });
        return;
      }
      if (r.trap && r.penalty) {
        const pen = r.penalty;
        s.trap(pen.scene, i);
        setSay("…");
        setTimeout(() => onPenalty(pen), 1300);
        return;
      }
      const next = { ...v, ...(r as QuarterView) };
      setView(next);
      const found = next.rooms.find((room) => room.chest);
      s.built.setChest(found?.id ?? null);
      setSay(found ? "⛏ Your spade strikes wood: a chest! Tap it to open it." : `⛏ You dig in ${v.rooms[i].name}… only earth. It isn't here.`);
    } finally {
      setBusy(false);
    }
  }

  // The challenge: one answer, in time (the server knows the right one and the time).
  const answering = useRef(false);
  async function answer(choice: number) {
    const d = dodge;
    const s = scene.current;
    if (!d || answering.current) return;
    answering.current = true;
    setDodge(null);
    try {
      const { data } = await supabase.rpc("house_dodge", { p_hunt: huntId, p_choice: choice });
      const r = data as { ok: boolean; dodged?: boolean; penalty?: Penalty & { balance: number | null; energy: number | null } } | null;
      const name = viewRef.current?.rooms[d.room]?.name ?? "this plot";
      if (r?.dodged) {
        setSay(`💨 You dodged it! You jump clear of ${name}. It's a trap, though: not there.`);
        if (s) await s.walkTo(outTo(s.built.plan, s.at()));
      } else if (r?.penalty) {
        const pen = r.penalty;
        s?.trap(pen.scene, d.room);
        setSay(choice === 0 ? "Too slow…" : "Wrong!");
        setTimeout(() => onPenalty(pen), 1300);
      }
    } finally {
      answering.current = false;
    }
  }
  // Out of time: the trap springs (0 is never the answer).
  useEffect(() => {
    if (!dodge) return;
    const t = setTimeout(() => void answer(0), dodge.seconds * 1000);
    return () => clearTimeout(t);
    // The timer belongs to this challenge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dodge]);

  const on = view && standing >= 0 ? view.rooms[standing] : null;
  const canDig = !!on && !busy && !dodge && view?.dug !== on.id;
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 bg-[#1B2230] text-paper" role="dialog" aria-modal="true" aria-label="The key's place" data-busy={busy}>
      {/* The quarter fills the screen; the bars float over it (it's framed in the space between them). */}
      <div ref={host} className="absolute inset-0 touch-none" data-house />
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-[#1B2230] via-[#1B2230]/85 to-transparent pb-3" data-house-head>
        <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Key {view?.key ?? ""}</p>
            <h2 className="truncate font-display text-xl font-extrabold">{view?.title ?? "The key's place"}</h2>
          </div>
          <button
            type="button"
            onClick={() => setWide((w) => !w)}
            aria-label={wide ? "Back to where you are" : "See the whole place"}
            title={wide ? "Back to where you are" : "See the whole place"}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-line bg-[#1B2230]/70 text-lg"
          >
            {wide ? "🔍" : "🗺️"}
          </button>
          <button type="button" onClick={onClose} className="h-10 shrink-0 rounded-xl border-[1.5px] border-line px-3 text-sm font-bold">
            Leave
          </button>
        </div>
        {view && view.items.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-2" aria-label="What you carry">
            {view.items.map((it) => (
              <span key={it.id} className="flex shrink-0 items-center gap-1 rounded-full bg-ink-2 px-3 py-1 text-xs font-bold ring-1 ring-line">
                <span aria-hidden="true">{it.icon}</span>
                {it.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-3 top-[calc(var(--house-head,5rem)+0.25rem)] flex flex-col gap-3">
        {dodge && (
          <div className="pointer-events-auto flex flex-col gap-3 rounded-2xl bg-ink/95 p-4 shadow-xl ring-2 ring-danger" role="alertdialog" aria-label="Dodge the trap">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-danger-text">A trap! Dodge it</p>
            <p className="font-display text-xl font-extrabold">{dodge.prompt}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div className="loota-dodge-bar h-full bg-danger" style={{ animationDuration: `${dodge.seconds}s` }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {dodge.options.map((o, j) => (
                <button key={j} type="button" onClick={() => void answer(j + 1)} className="h-12 rounded-xl bg-ink-2 text-lg font-bold ring-1 ring-line active:bg-gold active:text-ink">
                  {o.trim()}
                </button>
              ))}
            </div>
          </div>
        )}
        {gained && (
          <p className="rounded-2xl bg-gold px-4 py-3 text-center font-bold text-ink shadow-lg">
            {gained.icon} {gained.name}: into your bag
          </p>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col" data-house-foot>
        {canDig && (
          <button
            type="button"
            onClick={() => void dig()}
            className="mx-auto mb-3 flex h-14 items-center gap-2 rounded-2xl bg-gold px-6 font-display text-lg font-extrabold text-ink shadow-lg active:scale-95"
          >
            ⛏ Dig here
          </button>
        )}
        <div className="bg-ink/90 backdrop-blur-sm">
          {view && (
            <div className="flex gap-2 overflow-x-auto border-t border-line px-3 py-2" aria-label="Plots">
              {view.rooms.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={busy}
                  onClick={() => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: { tap: "room", id: r.id } }))}
                  className={`h-11 shrink-0 rounded-xl px-3 text-sm font-bold disabled:opacity-60 ${standing === i ? "bg-gold text-ink" : "bg-ink-2 text-paper ring-1 ring-line"}`}
                >
                  {r.locked ? "🔒 " : view.dug === r.id ? "⛏ " : "📍 "}
                  {r.name}
                </button>
              ))}
            </div>
          )}
          <p className="min-h-[3.5rem] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 text-base leading-relaxed" aria-live="polite" data-house-say>
            {say}
          </p>
        </div>
      </div>
    </div>
  );
}

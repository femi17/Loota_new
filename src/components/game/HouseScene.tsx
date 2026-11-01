"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createClient } from "@/lib/supabase/client";
import type { AvatarLook } from "@/lib/avatar";
import { animateAvatar, buildAvatar } from "@/game/models3d";
import { buildHouse, outTo, roomAt, routeTo, type Built, type HouseObjectView, type HouseRoomView, type HouseStyle } from "@/game/house3d";
import type { Penalty } from "./PenaltyCard";

type Item = { id: string; name: string; icon: string };
type HouseView = {
  ok: boolean;
  reason?: string;
  key: number;
  title: string;
  style: HouseStyle;
  /** Its floor plan (none: picked from its name). */
  layout?: string | null;
  room: string | null;
  outUntil: string | null;
  rooms: HouseRoomView[];
  objects: HouseObjectView[];
  items: Item[];
  at: { lng: number; lat: number };
};
type Point = { x: number; z: number };

const SPEED = 2.6; // metres a second, walking indoors
const AVATAR = 0.72; // the hunter's size in the house
const REFUSED: Record<string, string> = {
  away: "You've moved away from the house.",
  no_house: "There's no house here.",
  not_live: "The hunt isn't on right now.",
  not_hunting: "You're not in this hunt.",
  dodge: "Answer the challenge first!",
};

/**
 * Inside a story key's house (owner, 31 Oct 2026: "a scene, like an open house, like sims"). The hunter walks the hall
 * and tries the rooms: one holds the chest, some are traps (a soft penalty: thrown out), some hold things to touch
 * (nothing glows) and carry to another room. Only the server knows which is which.
 */
export function HouseScene({
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
  /** The chest in the right room: open it (the map's usual search, which starts the Key Trial). */
  onOpenChest: () => void;
  /** A trap: the penalty card shows; the house closes. */
  onPenalty: (p: Penalty & { balance: number | null; energy: number | null }) => void;
  /** The server stood the hunter at the house's spot. */
  onMoved: (at: { lng: number; lat: number }) => void;
}) {
  const [supabase] = useState(createClient);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<HouseView | null>(null);
  const [say, setSay] = useState<string>("Tap a room (or its name below) to walk in. Tap things to look at them.");
  // Close up and following the hunter, or the whole house (owner, 1 Nov 2026: "on mobile it is so tiny"): close on a phone.
  const [near, setNear] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const nearRef = useRef(near);
  const refit = useRef<() => void>(() => {});
  useEffect(() => {
    nearRef.current = near;
    refit.current();
  }, [near]);
  const [busy, setBusy] = useState(false);
  const [gained, setGained] = useState<Item | null>(null);
  // A trap's challenge (owner, 31 Oct 2026: dodge it by answering in time): its room's place, the prompt, the options.
  const [dodge, setDodge] = useState<{ room: number; prompt: string; options: string[]; seconds: number } | null>(null);
  const scene = useRef<{ built: Built; walkTo: (path: Point[]) => Promise<void>; at: () => Point; shake: () => void; trap: (kind: string, room: number) => void } | null>(null);
  const plan = () => scene.current?.built.plan;
  const viewRef = useRef<HouseView | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // The house from the server; then the 3D scene round it.
  useEffect(() => {
    let live = true;
    void supabase.rpc("house_view", { p_hunt: huntId }).then(({ data }) => {
      if (!live) return;
      const v = data as HouseView | null;
      if (!v?.ok) {
        // A challenge left unanswered last time: its trap springs now.
        const left = (v as { penalty?: Penalty & { balance: number | null; energy: number | null } } | null)?.penalty;
        if (left) return onPenalty(left);
        setSay(REFUSED[v?.reason ?? ""] ?? "The house won't open right now.");
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
    world.add(new THREE.HemisphereLight("#FFF4E0", "#3A4250", 1.9));
    const sun = new THREE.DirectionalLight("#FFFFFF", 1.4);
    sun.position.set(6, 12, 8);
    world.add(sun);
    const house = buildHouse(v.rooms, v.objects, v.style, v.title, v.layout);
    world.add(house.group);
    const plan = house.plan;
    const B = plan.bounds;
    const centre = new THREE.Vector3(plan.centre.x, 0, plan.centre.z);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    // The house's box (its rooms and their labels), to frame it exactly (owner, 1 Nov 2026: "why can it take the full
    // screen. The rooms are too tiny").
    const corners: THREE.Vector3[] = [];
    for (const x of [B.minX - 0.4, B.maxX + 0.4]) for (const y of [0, 3.6]) for (const z of [B.minZ - 0.4, B.maxZ + 0.4]) corners.push(new THREE.Vector3(x, y, z));
    const probe = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const extent = (off: THREE.Vector3) => {
      probe.position.copy(centre).add(off);
      probe.lookAt(centre);
      probe.updateMatrixWorld();
      const xs: number[] = [], ys: number[] = [];
      for (const c of corners) {
        const v = c.clone().applyMatrix4(probe.matrixWorldInverse);
        xs.push(v.x);
        ys.push(v.y);
      }
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    };
    // Looking in from the front-right (the walls on that side are the low ones), at the angle that shows it biggest.
    const camOff = new THREE.Vector3(14, 16, 14);
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      const root = el.parentElement;
      const top = root?.querySelector<HTMLElement>("[data-house-head]")?.offsetHeight ?? 0;
      const bottom = root?.querySelector<HTMLElement>("[data-house-foot]")?.offsetHeight ?? 0;
      root?.style.setProperty("--house-head", `${top}px`);
      const free = Math.max(120, h - top - bottom);
      let best: { off: THREE.Vector3; e: ReturnType<typeof extent>; s: number } | null = null;
      // Anywhere in the front-right quarter keeps the low walls nearest; a phone held upright often fits best nearly
      // square-on and from higher up, a wide screen from the corner.
      for (const az of [12, 25, 45, 65, 78]) {
        for (const up of [40, 52, 62]) {
          const a = (az * Math.PI) / 180, b = (up * Math.PI) / 180;
          const off = new THREE.Vector3(Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)).multiplyScalar(30);
          const e = extent(off);
          const sc = Math.max((e.maxX - e.minX) / w, (e.maxY - e.minY) / free) * 1.04; // world units a pixel
          if (!best || sc < best.s) best = { off, e, s: sc };
        }
      }
      camOff.copy(best!.off);
      // Close up: about a room and the hall across; the hunter in the middle of the free screen. Else the whole house.
      const sc = nearRef.current ? 11 / Math.min(w, free) : best!.s;
      const cx = nearRef.current ? 0 : (best!.e.minX + best!.e.maxX) / 2;
      const cy = nearRef.current ? 0 : (best!.e.minY + best!.e.maxY) / 2;
      const t = cy + (top + free / 2) * sc;
      Object.assign(camera, { left: cx - (w / 2) * sc, right: cx + (w / 2) * sc, top: t, bottom: t - h * sc });
      camera.updateProjectionMatrix();
    };
    camera.position.copy(centre).add(camOff);
    camera.lookAt(centre);
    fit();
    refit.current = fit;
    // Again whenever the screen or the bars over it change size (a room list that wraps, the carried things).
    const sizes = new ResizeObserver(() => fit());
    sizes.observe(el);
    for (const bar of el.parentElement?.querySelectorAll("[data-house-head], [data-house-foot]") ?? []) sizes.observe(bar);
    const focus = centre.clone(); // where the camera looks: the hunter when close up, the house's middle otherwise

    // The hunter, on the porch (or in the room they were in)
    const av = buildAvatar(look);
    av.root.scale.setScalar(AVATAR);
    av.root.position.set(plan.start.x, 0.1, plan.start.z);
    av.root.rotation.y = Math.atan2(plan.entrance.x - plan.start.x, plan.entrance.z - plan.start.z);
    world.add(av.root);
    if (v.room) {
      const i = v.rooms.findIndex((r) => r.id === v.room);
      if (i >= 0) av.root.position.set(plan.rooms[i].inside.x, 0.1, plan.rooms[i].inside.z);
    }
    let path: Point[] = [];
    let arrive: (() => void) | null = null;
    let shakeUntil = 0;
    const walkTo = (p: Point[]) =>
      new Promise<void>((resolve) => {
        arrive?.();
        path = p.slice();
        arrive = resolve;
      });

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
        hole.position.set(me.x, 0.13, me.z);
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
        const ball = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 1), new THREE.MeshLambertMaterial({ color: "#7E7A70" }));
        ball.position.set(room.x, 0.9, room.z - room.d / 2 + 0.9);
        const from = ball.position.clone();
        world.add(ball);
        fx.push((t) => {
          const k = ease(t);
          ball.position.lerpVectors(from, new THREE.Vector3(me.x, 0.9, me.z), Math.min(1, k * 1.2));
          ball.rotation.x -= 0.15;
          return k >= 1;
        });
      } else {
        // The Masquerade, a mirror, a storm, a snake: the lights flicker
        fx.push((t) => {
          const k = ease(t);
          world.background = new THREE.Color(Math.floor(k * 12) % 2 ? "#3A0A0A" : "#1B2230");
          return k >= 1;
        });
      }
    };

    let raf = 0;
    let last = performance.now();
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
      }
      animateAvatar(av, { mode: "walk", phase: "idle", moving: moved > 0 ? 1 : 0, distance: moved / AVATAR }, dt, now / 1000);
      const shaking = now < shakeUntil;
      const want = nearRef.current ? new THREE.Vector3(av.root.position.x, 0, av.root.position.z) : centre;
      focus.lerp(want, 1 - Math.exp(-4 * dt));
      camera.position.copy(focus).add(camOff);
      if (shaking) camera.position.x += (Math.random() - 0.5) * 0.5;
      camera.lookAt(focus);
      renderer.render(world, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Taps: whatever was touched, if it's showing
    const ray = new THREE.Raycaster();
    const tapAt = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(house.targets, true).find((h) => {
        for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (!o.visible) return false;
        return true;
      });
      const data = hit?.object.userData as { tap?: string; id?: string } | undefined;
      if (data?.tap) window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: { tap: data.tap, id: data.id } }));
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
      built: house,
      walkTo,
      at: () => ({ x: av.root.position.x, z: av.root.position.z }),
      shake: () => (shakeUntil = performance.now() + 700),
      trap,
    };
    return () => {
      cancelAnimationFrame(raf);
      sizes.disconnect();
      refit.current = () => {};
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.dispose();
      renderer.domElement.remove();
      scene.current = null;
    };
  }, [built, look]);

  // A tap in the house: walk, then ask the server.
  useEffect(() => {
    // Out of the room you're in, across the hall, through the doorway (and in)
    const route = (from: Point, i: number, inside: boolean): Point[] => (plan() ? routeTo(plan()!, from, i, inside) : []);
    const onTap = async (e: Event) => {
      const { tap, id } = (e as CustomEvent<{ tap: string; id: string }>).detail;
      const v = viewRef.current;
      const s = scene.current;
      if (!v || !s || busy) return;
      // The porch: back to the front door (a stray tap mustn't throw you out of the house; Leave does that).
      if (tap === "out") {
        const pl = s.built.plan;
        setSay("That's the way out. Tap Leave when you're done here.");
        return void s.walkTo([...outTo(pl, s.at()), pl.entrance, pl.start]);
      }
      if (tap === "hall") return void s.walkTo(outTo(s.built.plan, s.at()));
      if (tap === "chest") {
        setSay("You kneel by the chest…");
        return onOpenChest();
      }
      const roomId = tap === "room" ? id : v.objects.find((o) => o.id === id)?.room;
      const i = v.rooms.findIndex((r) => r.id === roomId);
      if (i < 0) return;
      setBusy(true);
      try {
        if (v.room !== roomId) {
          // Through the door: the server decides what's behind it.
          // Into the room (owner, 1 Nov 2026: "the avatar cannot walk in the room"), unless its door is shut.
          await s.walkTo(route(s.at(), i, v.rooms[i].locked !== true));
          const { data } = await supabase.rpc("house_enter", { p_hunt: huntId, p_room: roomId });
          const r = data as (Partial<HouseView> & { locked?: boolean; text?: string; trap?: boolean; used?: { name: string } | null; penalty?: Penalty & { balance: number | null; energy: number | null }; until?: string; dodge?: { prompt: string; options: string[]; seconds: number } }) | null;
          if (!r?.ok) {
            if (r?.reason === "out") setSay(`The doors won't open for you yet: ${Math.max(1, Math.ceil((Date.parse(r.until ?? "") - Date.now()) / 1000))} s.`);
            else setSay(REFUSED[r?.reason ?? ""] ?? "That door won't budge.");
            return;
          }
          if (r.locked) {
            setSay(`🔒 ${v.rooms[i].name}: ${r.text}`);
            return;
          }
          if (r.trap && r.dodge) {
            // The trap starts to spring: answer in time to dodge it.
            s.shake();
            setSay(`Something clicks in the ${v.rooms[i].name.toLowerCase()}…`);
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
          const next = { ...v, ...(r as HouseView) };
          setView(next);
          if (r.used) s.built.setLocked(roomId!, false);
          next.rooms.forEach((room) => room.chest && s.built.setChest(room.id));
          setSay(r.used ? `You use ${r.used.name}. The ${v.rooms[i].name.toLowerCase()} door opens.` : `The ${v.rooms[i].name.toLowerCase()}.`);
          if (roomAt(s.built.plan, s.at()) !== i) await s.walkTo(route(s.at(), i, true)); // a door that was shut, now open
          if (next.rooms[i]?.chest) setSay("There, by the wall: an old chest. Tap it to open it.");
          if (tap === "room") return;
        }
        // A thing in this room: go to it, and look.
        if (tap === "object") {
          const room = s.built.plan.rooms[i];
          await s.walkTo([{ x: (room.inside.x + room.x) / 2, z: (room.inside.z + room.z) / 2 }]);
          const { data } = await supabase.rpc("house_touch", { p_hunt: huntId, p_object: id });
          const r = data as (Partial<HouseView> & { text?: string; gained?: Item | null }) | null;
          if (!r?.ok) return setSay("You can't reach that from here.");
          setView((old) => (old ? { ...old, ...(r as HouseView) } : old));
          setSay(r.text ?? "");
          if (r.gained) {
            setGained(r.gained);
            setTimeout(() => setGained(null), 2600);
          }
        }
      } finally {
        setBusy(false);
      }
    };
    window.addEventListener("loota:house-tap", onTap);
    return () => window.removeEventListener("loota:house-tap", onTap);
  }, [busy, huntId, onClose, onOpenChest, onPenalty, supabase]);

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
      const name = viewRef.current?.rooms[d.room]?.name.toLowerCase() ?? "room";
      if (r?.dodged) {
        setSay(`💨 You dodged it! You jump clear of the ${name}. That room's a trap, though.`);
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

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 bg-[#1B2230] text-paper" role="dialog" aria-modal="true" aria-label="Inside the house" data-busy={busy}>
      {/* The house fills the screen; the bars float over it (it's framed in the space between them). */}
      <div ref={host} className="absolute inset-0 touch-none" data-house />
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-[#1B2230] via-[#1B2230]/85 to-transparent pb-3" data-house-head>
      <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Key {view?.key ?? ""}</p>
          <h2 className="truncate font-display text-xl font-extrabold">{view?.title ?? "The house"}</h2>
        </div>
        <button
          type="button"
          onClick={() => setNear((n) => !n)}
          aria-label={near ? "See the whole house" : "Closer"}
          title={near ? "See the whole house" : "Closer"}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-line text-lg"
        >
          {near ? "🏠" : "🔍"}
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
      <div className="absolute inset-x-0 bottom-0 bg-ink/90 backdrop-blur-sm" data-house-foot>
      {view && (
        <div className="flex gap-2 overflow-x-auto border-t border-line px-3 py-2" aria-label="Rooms">
          {view.rooms.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              onClick={() => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: { tap: "room", id: r.id } }))}
              className={`h-11 shrink-0 rounded-xl px-3 text-sm font-bold disabled:opacity-60 ${view.room === r.id ? "bg-gold text-ink" : "bg-ink-2 text-paper ring-1 ring-line"}`}
            >
              {r.locked ? "🔒 " : "🚪 "}
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
  );
}

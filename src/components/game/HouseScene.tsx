"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createClient } from "@/lib/supabase/client";
import type { AvatarLook } from "@/lib/avatar";
import { animateAvatar, buildAvatar } from "@/game/models3d";
import { buildHouse, doorOf, houseSize, roomPlace, ROOM_D, type Built, type HouseObjectView, type HouseRoomView } from "@/game/house3d";
import type { Penalty } from "./PenaltyCard";

type Item = { id: string; name: string; icon: string };
type HouseView = {
  ok: boolean;
  reason?: string;
  key: number;
  title: string;
  room: string | null;
  outUntil: string | null;
  rooms: HouseRoomView[];
  objects: HouseObjectView[];
  items: Item[];
  at: { lng: number; lat: number };
};
type Point = { x: number; z: number };

const SPEED = 2.6; // metres a second, walking indoors
const REFUSED: Record<string, string> = {
  away: "You've moved away from the house.",
  no_house: "There's no house here.",
  not_live: "The hunt isn't on right now.",
  not_hunting: "You're not in this hunt.",
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
  const [say, setSay] = useState<string>("Tap a room to walk to its door. Tap things to look at them.");
  const [busy, setBusy] = useState(false);
  const [gained, setGained] = useState<Item | null>(null);
  const scene = useRef<{ built: Built; walkTo: (path: Point[]) => Promise<void>; at: () => Point; shake: () => void } | null>(null);
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
    const house = buildHouse(v.rooms, v.objects);
    world.add(house.group);
    const { width, depth } = houseSize(v.rooms.length);
    const centre = new THREE.Vector3(0, 0, -depth / 2 + 0.4);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      const aspect = w / h;
      const r = 0.5 * Math.hypot(width, depth + 2) * 0.94;
      const halfW = aspect < 1 ? r : r * aspect;
      const halfH = aspect < 1 ? r / aspect : r;
      Object.assign(camera, { left: -halfW, right: halfW, top: halfH * 0.86, bottom: -halfH * 1.14 });
      camera.updateProjectionMatrix();
    };
    camera.position.set(centre.x + 14, 16, centre.z + 14);
    camera.lookAt(centre);
    fit();
    window.addEventListener("resize", fit);

    // The hunter, at the front door
    const av = buildAvatar(look);
    av.root.scale.setScalar(0.62);
    av.root.position.set(0, 0.1, 0.9);
    av.root.rotation.y = Math.PI;
    world.add(av.root);
    if (v.room) {
      const i = v.rooms.findIndex((r) => r.id === v.room);
      if (i >= 0) av.root.position.set(roomPlace(i).x, 0.1, roomPlace(i).z);
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

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
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
      animateAvatar(av, { mode: "walk", phase: "idle", moving: moved > 0 ? 1 : 0, distance: moved / 0.62 }, dt, now / 1000);
      const shaking = now < shakeUntil;
      camera.position.x = centre.x + 14 + (shaking ? (Math.random() - 0.5) * 0.5 : 0);
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
    };
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.dispose();
      renderer.domElement.remove();
      scene.current = null;
    };
  }, [built, look]);

  // A tap in the house: walk, then ask the server.
  useEffect(() => {
    const route = (from: Point, i: number, inside: boolean): Point[] => {
      const door = doorOf(i);
      const room = roomPlace(i);
      // Out of the room you're in (back to the hall), along the hall, to the door, and in.
      const pts: Point[] = [];
      if (Math.abs(from.x) > 1.4) pts.push({ x: Math.sign(from.x) * 0.9, z: from.z });
      pts.push({ x: 0, z: door.z }, { x: door.x * 0.55, z: door.z });
      if (inside) pts.push({ x: room.x, z: room.z + ROOM_D * 0.12 });
      return pts;
    };
    const onTap = async (e: Event) => {
      const { tap, id } = (e as CustomEvent<{ tap: string; id: string }>).detail;
      const v = viewRef.current;
      const s = scene.current;
      if (!v || !s || busy) return;
      if (tap === "out") return onClose();
      if (tap === "hall") return void s.walkTo([{ x: Math.sign(s.at().x) * 0.9 || 0, z: s.at().z }, { x: 0, z: Math.min(0.6, s.at().z) }]);
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
          await s.walkTo(route(s.at(), i, false));
          const { data } = await supabase.rpc("house_enter", { p_hunt: huntId, p_room: roomId });
          const r = data as (Partial<HouseView> & { locked?: boolean; text?: string; trap?: boolean; used?: { name: string } | null; penalty?: Penalty & { balance: number | null; energy: number | null }; until?: string }) | null;
          if (!r?.ok) {
            if (r?.reason === "out") setSay(`The doors won't open for you yet: ${Math.max(1, Math.ceil((Date.parse(r.until ?? "") - Date.now()) / 1000))} s.`);
            else setSay(REFUSED[r?.reason ?? ""] ?? "That door won't budge.");
            return;
          }
          if (r.locked) {
            setSay(`🔒 ${v.rooms[i].name}: ${r.text}`);
            return;
          }
          if (r.trap && r.penalty) {
            s.shake();
            setSay("…");
            const pen = r.penalty;
            setTimeout(() => onPenalty(pen), 650);
            return;
          }
          const next = { ...v, ...(r as HouseView) };
          setView(next);
          if (r.used) s.built.setLocked(roomId!, false);
          next.rooms.forEach((room) => room.chest && s.built.setChest(room.id));
          setSay(r.used ? `You use ${r.used.name}. The ${v.rooms[i].name.toLowerCase()} door opens.` : `The ${v.rooms[i].name.toLowerCase()}.`);
          await s.walkTo([{ x: roomPlace(i).x, z: roomPlace(i).z + ROOM_D * 0.12 }]);
          if (next.rooms[i]?.chest) setSay("There, by the wall: an old chest. Tap it to open it.");
          if (tap === "room") return;
        }
        // A thing in this room: go to it, and look.
        if (tap === "object") {
          const room = roomPlace(i);
          await s.walkTo([{ x: room.x, z: room.z - ROOM_D * 0.08 }]);
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

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col bg-[#1B2230] text-paper" role="dialog" aria-modal="true" aria-label="Inside the house" data-busy={busy}>
      <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Key {view?.key ?? ""}</p>
          <h2 className="truncate font-display text-xl font-extrabold">{view?.title ?? "The house"}</h2>
        </div>
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
      <div ref={host} className="relative min-h-0 flex-1 touch-none" data-house>
        {gained && (
          <p className="pointer-events-none absolute inset-x-4 top-4 rounded-2xl bg-gold px-4 py-3 text-center font-bold text-ink shadow-lg">
            {gained.icon} {gained.name}: into your bag
          </p>
        )}
      </div>
      <p className="min-h-[4.5rem] border-t border-line bg-ink px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-sm leading-relaxed" aria-live="polite" data-house-say>
        {say}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { normalizeLook } from "@/lib/avatar";
import { animateAvatar, buildAvatar } from "@/game/models3d";
import type { HouseObjectView, HouseRoomView, InnerRoomView } from "@/game/house3d";
import { buildKeyWorld, type KeyScene } from "@/game/keyworld";
import { daylight, sunAt } from "@/game/sun";

/** A hunter's own arrangement of a key's place, as their game saved it (QuarterScene, via GameMap's worldTalk). */
export type KeyWorldData = {
  kind: "keyworld";
  key: number;
  title: string;
  scene: KeyScene | null;
  rooms: HouseRoomView[];
  objects: HouseObjectView[];
  seat: string;
  inner: InnerRoomView[] | null;
  dug: string | null;
  at: { lng: number; lat: number };
};
/** Where they walk: [server ms, x, z, facing, inside 0/1]. */
export type WorldTrack = [number, number, number, number, number][];

const AVATAR = 0.8; // as QuarterScene's
const EYE = { street: { back: 7.5, up: 4.6 }, inside: { back: 6, up: 6.5 } };
const ZOOM = 1.8; // a laptop's

/**
 * The key's place on the broadcast (owner, 9 Nov 2026: "the key location… we can broadcast that too for viewers"):
 * the hunter's own arrangement of it, built as their game builds it, and the hunter walking where they walked, a few
 * seconds behind (`playback.current`: the moment shown, server ms, and their track), the camera behind them as on
 * their screen. Boxes opened and the key's chest found as they were (`playback.current.state`).
 */
export function KeyWorldView({
  data,
  look,
  playback,
}: {
  data: KeyWorldData;
  look: unknown;
  playback: { current: { T: number; track: WorldTrack; inner: InnerRoomView[] | null; dug: string | null } };
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const kw = buildKeyWorld(data.rooms, data.objects, data.scene, data.title, data.seat);
    kw.setDark(false); // lit for the viewers
    const world = new THREE.Scene();
    const sky = new THREE.Color(kw.sky);
    world.background = sky;
    const fog = new THREE.Fog(sky.clone(), 30, 80);
    world.fog = fog;
    const hemi = new THREE.HemisphereLight("#FFF4E0", "#667755", 2.0);
    const sun = new THREE.DirectionalLight("#FFFFFF", 1.3);
    sun.position.set(20, 40, 10);
    world.add(hemi, sun, kw.group);
    // The time of day there, as on their screen
    const { elevation, azimuth } = sunAt(data.at.lat, data.at.lng);
    const day = daylight(elevation);
    sky.copy(new THREE.Color("#0B1330")).lerp(new THREE.Color(kw.sky), day);
    fog.color.copy(sky);
    hemi.intensity = 0.35 + 1.65 * day;
    sun.intensity = 1.3 * day;
    const el2 = Math.max(8, elevation) * (Math.PI / 180), az = azimuth * (Math.PI / 180);
    sun.position.set(Math.sin(az) * Math.cos(el2) * 50, Math.sin(el2) * 50, -Math.cos(az) * Math.cos(el2) * 50);
    kw.setNight(1 - day);
    const glow = new THREE.PointLight("#FFE2A8", 1.6 * (1 - day), 10, 1.5);
    world.add(glow);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    fit();
    const sizes = new ResizeObserver(fit);
    sizes.observe(el);

    const av = buildAvatar(normalizeLook(look));
    av.root.scale.setScalar(AVATAR);
    av.root.position.set(kw.start.x, 0.1, kw.start.z);
    world.add(av.root);
    let boxesKey = "";
    let dugKey = "";
    /** Where they were at server time `T`: between the points either side. */
    const where = (T: number, track: WorldTrack) => {
      if (!track.length) return null;
      if (T <= track[0][0]) return track[0];
      const i = track.findIndex((p) => p[0] >= T);
      if (i === -1) return track[track.length - 1];
      const a = track[i - 1], b = track[i];
      const k = (T - a[0]) / Math.max(1, b[0] - a[0]);
      const turn = Math.atan2(Math.sin(b[3] - a[3]), Math.cos(b[3] - a[3]));
      return [T, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + turn * k, k < 0.5 ? a[4] : b[4]] as WorldTrack[number];
    };
    let yaw = Math.PI;
    const eye = new THREE.Vector3(kw.start.x, EYE.street.up * ZOOM, kw.start.z + EYE.street.back * ZOOM);
    const aim = new THREE.Vector3(kw.start.x, 1.2, kw.start.z);
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const pb = playback.current;
      // The boxes and the key's chest as they were
      const bk = JSON.stringify(pb.inner);
      if (bk !== boxesKey) {
        boxesKey = bk;
        kw.setBoxes(pb.inner);
      }
      if ((pb.dug ?? "") !== dugKey) {
        dugKey = pb.dug ?? "";
        const i = data.rooms.findIndex((r) => r.id === pb.dug);
        kw.setKey(i >= 0 && data.rooms[i].chest ? i : null);
      }
      const p = where(pb.T, pb.track);
      const before = { x: av.root.position.x, z: av.root.position.z };
      if (p) {
        av.root.position.set(p[1], 0.1, p[2]);
        av.root.rotation.y = p[3];
      }
      const at = { x: av.root.position.x, z: av.root.position.z };
      const step = Math.hypot(at.x - before.x, at.z - before.z);
      const shown = `${at.x.toFixed(1)},${at.z.toFixed(1)}`;
      if (el.dataset.at !== shown) el.dataset.at = shown; // where they stand (for the tests)
      animateAvatar(av, { mode: "walk", phase: "idle", moving: step > 0.002 ? 1 : 0, distance: step / AVATAR }, dt, now / 1000);
      glow.position.set(at.x, 2.6, at.z);
      // The camera: behind them, a little above, swinging round as they turn (as their screen's)
      let d = av.root.rotation.y - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, 3 * dt);
      const inside = (p?.[4] ?? 0) === 1 || kw.placeAt(at) >= 0 || kw.homeAt(at) >= 0;
      const place = inside ? EYE.inside : EYE.street;
      const goal = new THREE.Vector3(at.x - Math.sin(yaw) * place.back * ZOOM, place.up * ZOOM, at.z - Math.cos(yaw) * place.back * ZOOM);
      const look = new THREE.Vector3(at.x + Math.sin(yaw) * 1.5, 1.2, at.z + Math.cos(yaw) * 1.5);
      const k = 1 - Math.exp(-4 * dt);
      eye.lerp(goal, k);
      aim.lerp(look, k);
      camera.position.copy(eye);
      camera.lookAt(aim);
      kw.tick(dt, at, { x: eye.x, y: eye.y, z: eye.z });
      renderer.render(world, camera);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      sizes.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [data, look, playback]);
  return <div ref={host} className="absolute inset-0" data-key-world={data.key} />;
}

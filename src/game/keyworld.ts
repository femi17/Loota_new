/**
 * The key's world (owner, 3 Nov 2026, after the old mini-Loota: "here I can move, free, it is just like when you get to
 * the location you are thrown into another world. You can even mimic the key location. Since it says train location
 * you can do something different showing statue and all… user can move freely using the movement we have designed";
 * "A whole world, but we just limit the viewing so it is not too big in size but still considerable large enough to
 * allow exploring as a treasure hunter"). It replaces the hunt city's one-street board.
 *
 * A little town round a square, about 74 m across, seen from just behind the hunter (the fog keeps the view short):
 * the square holds the key's landmark (the story's `scene`: a station and a bronze dog on a scramble crossing, a
 * museum of clocks by a river, rusting engines on a salt flat…), a street runs round it and out to the edge, and the
 * story's places stand on the street round the square: full-size buildings to walk into (their roofs lift off) or
 * open-air plots to dig. The rest is the town. Walls are solid: the way in is the door.
 *
 * Units are metres; +z is towards the camera. Every story place stands in its own frame (its door at local +z).
 */
import * as THREE from "three";
import { ball, box, cyl, floorMaterial, makeChest, makeObject, mat, type HouseObjectView, type HouseRoomView, type InnerRoomView } from "./house3d";

export type Point = { x: number; z: number };
export type Rect = { x0: number; x1: number; z0: number; z1: number };
/** What the key's place looks like (the story's house.scene). */
export type KeyScene = { ground?: "city" | "salt" | "desert"; pieces?: string[] };

export const REACH = 37; // the world's edge, each way from the middle
const RING = 15; // the square and the street round it, out to here
const SPOKE = 2.5; // half a street's width, from the ring out to the edge
const BW = 11; // a story place: along the street…
const BD = 10; // …and back from it
const H = 3; // its walls
export const BODY = 0.35; // the hunter, for bumping into things

/** What each kind of place (the story's room kinds) has underfoot. No signs or names float over anything (owner,
 * 3 Nov 2026: "remove all the labels, we do not need that"): the hunter goes by the place itself and the story. */
const PLOT: Record<string, { ground: string; pattern: "boards" | "tiles" | "flags" }> = {
  kitchen: { ground: "#D9C7A0", pattern: "tiles" },
  bedroom: { ground: "#C9B99A", pattern: "boards" },
  library: { ground: "#C9B99A", pattern: "boards" },
  cellar: { ground: "#9C9488", pattern: "flags" },
  parlour: { ground: "#D6B48A", pattern: "boards" },
  bathroom: { ground: "#C8D8DC", pattern: "tiles" },
  chapel: { ground: "#BFB3A2", pattern: "flags" },
  storeroom: { ground: "#A8957A", pattern: "boards" },
  study: { ground: "#8FB37A", pattern: "flags" },
};

const LOOK = {
  city: { sky: "#9FD3F2", ground: "#7FB069", street: "#5A5F66", square: "#CFC6B4", line: "#F4F1EA" },
  salt: { sky: "#A9D8F5", ground: "#EFEDE6", street: "#C9C2B4", square: "#E2DCCF", line: "#B5AD9C" },
  desert: { sky: "#9CCBEB", ground: "#D9B98A", street: "#B89B70", square: "#CDB28A", line: "#A08356" },
};

// ---- Drawing helpers ----------------------------------------------------------------------------------------------

/** A pitched roof over a box (w along x, d along z), its ridge along x. */
function roof(w: number, d: number, color: string, y: number, rise = 1.2) {
  const g = new THREE.Group();
  const slope = Math.hypot(d / 2, rise);
  for (const side of [-1, 1]) {
    const m = box(w + 0.3, 0.14, slope + 0.25, color, 0, y + rise / 2, (side * d) / 4, false);
    m.rotation.x = side * Math.atan2(rise, d / 2);
    g.add(m);
  }
  return g;
}

/** A town building's walls: its colour, with windows (as mini-Loota's), the pattern repeated to its size. */
const facades = new Map<string, THREE.MeshLambertMaterial>();
function facade(color: string, rx: number, ry: number, glass = "#8FC5E8") {
  const key = `${color}:${rx}:${ry}:${glass}`;
  let m = facades.get(key);
  if (!m) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = color;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#2B3A4A";
    g.fillRect(16, 14, 32, 34);
    g.fillStyle = glass;
    g.fillRect(18, 16, 13, 30);
    g.fillRect(33, 16, 13, 30);
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.fillRect(0, 60, 64, 4);
    g.fillRect(12, 48, 40, 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    m = new THREE.MeshLambertMaterial({ map: t });
    facades.set(key, m);
  }
  return m;
}

/** A plane on the ground (w along x, d along z). */
function flat(w: number, d: number, color: string | THREE.Material, x: number, z: number, y = 0.01) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), typeof color === "string" ? mat(color) : color);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** What stands in a story place, in its own frame (its door at +z, the back at −z): kept to the back. */
function feature(kind: string, w: number, d: number, accent: string) {
  const g = new THREE.Group();
  const back = -d / 2 + 0.9;
  const plant = (x: number, z: number) => g.add(cyl(0.28, 0.45, "#9C5A3A", x, 0.23, z, 0.32), ball(0.45, "#3E8A3E", x, 0.8, z), ball(0.3, "#4FA24A", x + 0.18, 1.1, z - 0.06));
  const tree = (x: number, z: number) => g.add(cyl(0.16, 1.6, "#6B4A2B", x, 0.8, z), ball(0.95, "#3E7A3A", x, 2.1, z), ball(0.6, "#4E8E44", x + 0.4, 2.5, z + 0.2));
  if (kind === "kitchen") {
    // A food stall: counter, striped canopy, pots on the fire, stools
    g.add(box(3.4, 1.0, 0.9, "#A8774A", 0, 0.5, back), box(3.5, 0.08, 1.0, "#DCD6CA", 0, 1.02, back));
    for (let i = 0; i < 6; i++) g.add(box(0.58, 0.06, 1.8, i % 2 ? "#F4F1EA" : accent, -1.45 + i * 0.58, 2.3, back + 0.3, false));
    for (const x of [-1.7, 1.7]) g.add(cyl(0.06, 2.3, "#5A3A20", x, 1.15, back + 1.1));
    g.add(cyl(0.3, 0.3, "#3A3A3A", -0.9, 1.2, back), cyl(0.24, 0.26, "#B4553A", 0.2, 1.18, back), cyl(0.2, 0.22, "#8A8A8A", 1.0, 1.16, back));
    for (const x of [-1, 0.2, 1.3]) g.add(cyl(0.2, 0.5, "#7A5230", x, 0.25, back + 1.2));
  } else if (kind === "library") {
    // A book stall: shelves of coloured books under an awning
    for (const x of [-1.3, 0, 1.3]) {
      g.add(box(1.2, 1.8, 0.5, "#5C3B22", x, 0.9, back));
      for (const [y, c] of [[0.4, "#2E5E8A"], [0.85, "#8A2E2E"], [1.3, "#C8A045"]] as const) g.add(box(1.0, 0.34, 0.04, c, x, y, back + 0.27, false));
    }
    g.add(box(4.2, 0.1, 1.4, accent, 0, 2.1, back + 0.4));
    g.add(box(1.6, 0.8, 0.8, "#7A5230", 0.4, 0.4, back + 1.6), box(0.6, 0.06, 0.4, "#F4F1EA", 0.3, 0.83, back + 1.6, false));
  } else if (kind === "cellar") {
    // A well (or a water tank), and barrels
    g.add(cyl(0.9, 0.8, "#8E887D", 0, 0.4, back + 0.7), cyl(0.7, 0.05, "#2E5E8A", 0, 0.78, back + 0.7));
    for (const x of [-0.8, 0.8]) g.add(cyl(0.07, 1.6, "#5A3A20", x, 1.4, back + 0.7));
    g.add(box(2.0, 0.1, 1.2, accent, 0, 2.25, back + 0.7), cyl(0.06, 1.8, "#5A3A20", 0, 1.6, back + 0.7).rotateZ(Math.PI / 2));
    for (const [x, z] of [[w / 2 - 1.0, back], [w / 2 - 1.0, back + 1.0], [-w / 2 + 1.0, back + 0.2]]) g.add(cyl(0.42, 0.95, "#7A4E2A", x, 0.48, z, 0.36), cyl(0.43, 0.06, "#3A3A3A", x, 0.3, z));
  } else if (kind === "parlour") {
    // A café: round tables, umbrellas, chairs
    for (const [x, z] of [[-1.6, back + 0.6], [1.6, back + 0.6]]) {
      g.add(cyl(0.6, 0.06, "#F4F1EA", x, 0.8, z), cyl(0.06, 0.8, "#3A3A3A", x, 0.4, z), cyl(0.05, 2.2, "#3A3A3A", x, 1.1, z), cyl(1.4, 0.4, accent, x, 2.3, z, 0.05));
      for (const dx of [-0.8, 0.8]) g.add(box(0.45, 0.06, 0.45, "#6B4A2B", x + dx, 0.45, z), box(0.45, 0.5, 0.06, "#6B4A2B", x + dx, 0.7, z - 0.2));
    }
    plant(-w / 2 + 0.7, back - 0.2);
    plant(w / 2 - 0.7, back - 0.2);
  } else if (kind === "bathroom") {
    // A fountain
    g.add(cyl(1.6, 0.5, "#B9B5AB", 0, 0.25, back + 1.2), cyl(1.4, 0.06, "#6FB6D8", 0, 0.5, back + 1.2), cyl(0.25, 1.2, "#B9B5AB", 0, 0.9, back + 1.2), cyl(0.7, 0.2, "#B9B5AB", 0, 1.5, back + 1.2), cyl(0.55, 0.05, "#6FB6D8", 0, 1.6, back + 1.2), ball(0.15, "#A8D4E6", 0, 1.9, back + 1.2));
    for (const x of [-w / 2 + 1, w / 2 - 1]) g.add(box(1.4, 0.4, 0.45, "#6B4A2B", x, 0.25, back));
  } else if (kind === "chapel") {
    // A little shrine: columns, a roof, candles
    for (const x of [-1, 1]) for (const z of [back - 0.2, back + 1.2]) g.add(cyl(0.14, 2.0, "#ECE6DA", x, 1.0, z));
    g.add(box(2.6, 0.2, 2.0, "#ECE6DA", 0, 2.1, back + 0.5));
    const r = roof(2.6, 2.0, accent, 2.2, 0.8);
    r.position.z = back + 0.5;
    g.add(r);
    g.add(box(1.0, 0.8, 0.6, "#F2EDE2", 0, 0.4, back + 0.4));
    for (const x of [-0.3, 0, 0.3]) g.add(cyl(0.04, 0.25, "#F4E2B0", x, 0.93, back + 0.4), ball(0.05, "#F4B41A", x, 1.1, back + 0.4));
  } else if (kind === "storeroom") {
    // A yard: crates, a tarp, a hand cart
    for (const [x, z, y] of [[-1.8, back, 0.35], [-1.0, back, 0.35], [-1.4, back, 1.05], [1.6, back + 0.2, 0.35]]) g.add(box(0.75, 0.7, 0.75, "#B08A5A", x, y, z));
    g.add(box(1.6, 0.9, 1.0, accent, 0.4, 0.45, back + 0.1));
    g.add(box(1.2, 0.1, 0.8, "#7A5230", w / 2 - 1.2, 0.6, back + 1.6));
  } else {
    // A garden (or a cottage's front room): a notice board, a tree
    g.add(box(1.6, 1.1, 0.1, "#6B4A2B", -0.8, 1.2, back), box(1.4, 0.9, 0.04, "#F4F1EA", -0.8, 1.2, back + 0.07, false));
    for (const x of [-1.5, -0.1]) g.add(box(0.1, 0.9, 0.1, "#6B4A2B", x, 0.45, back));
    tree(w / 2 - 1.2, back);
  }
  return g;
}

/** What an opened room held, shown in it. */
function content(outcome: InnerRoomView["outcome"]) {
  const g = new THREE.Group();
  if (outcome === "coins") {
    for (let k = 0; k < 9; k++) g.add(cyl(0.16, 0.05, "#F4B41A", (k % 3) * 0.2 - 0.2, 0.05 + Math.floor(k / 3) * 0.06, ((k * 7) % 3) * 0.12 - 0.12));
  } else if (outcome === "chapter") {
    g.add(box(0.5, 0.5, 0.4, "#6B4A2B", 0, 0.25, 0));
    const scroll = cyl(0.1, 0.7, "#F2E6C8", 0, 0.62, 0);
    scroll.rotation.z = Math.PI / 2;
    g.add(scroll, box(0.08, 0.2, 0.22, "#C23B3B", 0, 0.62, 0));
  } else if (outcome === "key") {
    g.add(makeChest());
    g.add(box(0.08, 0.5, 0.08, "#F4B41A", 0, 1.2, 0), cyl(0.15, 0.06, "#F4B41A", 0, 1.5, 0));
  } else if (outcome === "decoy") {
    const fake = makeChest();
    fake.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m?.color) {
        (c as THREE.Mesh).material = m.clone();
        ((c as THREE.Mesh).material as THREE.MeshLambertMaterial).color.multiplyScalar(0.5).add(new THREE.Color("#5A0A0A"));
      }
    });
    g.add(fake, ball(0.15, "#EDE6D6", 0, 0.95, 0));
  } else if (outcome === "trap") {
    g.add(cyl(0.6, 0.02, "#0A0A0A", 0, 0.03, 0));
    for (const a of [0.3, 1.8, 3.6]) {
      const plank = box(0.7, 0.05, 0.14, "#6B4A2B", Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55);
      plank.rotation.y = a;
      g.add(plank);
    }
  }
  return g;
}

/** A steam engine, along its own x (its nose at +x). */
function engine(color: string, balloon = false) {
  const g = new THREE.Group();
  g.add(box(4.6, 0.3, 1.4, "#2B2B2B", 0, 0.75, 0, false));
  const boiler = cyl(0.7, 3.0, color, 0.6, 1.55, 0);
  boiler.rotation.z = Math.PI / 2;
  g.add(boiler, box(1.6, 2.0, 1.8, color, -1.6, 1.8, 0), box(1.9, 0.15, 2.0, "#2B2B2B", -1.6, 2.85, 0, false));
  g.add(balloon ? cyl(0.22, 1.0, "#2B2B2B", 1.6, 2.6, 0, 0.6) : cyl(0.22, 0.8, "#2B2B2B", 1.6, 2.5, 0, 0.3));
  g.add(box(0.5, 0.55, 1.4, "#7A1F1F", 2.55, 0.5, 0));
  for (const x of [-1.6, -0.5, 0.6, 1.6]) for (const side of [-0.78, 0.78]) {
    const wh = cyl(x < -1 ? 0.5 : 0.42, 0.12, "#1D1D1D", x, 0.5, side);
    wh.rotation.x = Math.PI / 2;
    g.add(wh);
  }
  return g;
}

/** A bronze dog, sitting, on its plinth (its nose at +x). */
function bronzeDog() {
  const g = new THREE.Group();
  const B = "#7A5A30";
  g.add(box(1.5, 1.1, 1.1, "#9A958C", 0, 0.55, 0));
  const body = box(0.85, 0.5, 0.42, B, -0.05, 1.5, 0, false);
  body.rotation.z = 0.55;
  g.add(body);
  g.add(box(0.4, 0.42, 0.44, B, -0.35, 1.3, 0, false)); // haunch
  for (const s of [-0.13, 0.13]) g.add(box(0.12, 0.5, 0.12, B, 0.3, 1.35, s, false)); // front legs
  g.add(box(0.44, 0.36, 0.38, B, 0.38, 2.05, 0, false), box(0.22, 0.16, 0.22, B, 0.64, 1.98, 0, false)); // head, snout
  for (const s of [-0.12, 0.12]) g.add(box(0.1, 0.16, 0.08, B, 0.32, 2.3, s, false)); // ears up
  g.add(ball(0.12, B, -0.55, 1.55, 0)); // the curled tail
  return g;
}

// ---- The world -----------------------------------------------------------------------------------------------------

type Solid = { r: Rect; on: boolean };
export type WorldPlace = {
  id: string;
  outdoor: boolean;
  /** Its middle, which way its door faces (radians: local +z), and its plot on the ground. */
  centre: Point;
  facing: number;
  area: Rect;
  /** Its doorway; the street just outside it; just inside it. */
  door: Point;
  front: Point;
  inside: Point;
};
/** The treasure building's five rooms, built once it's found. */
type Inner = { group: THREE.Group; rooms: { n: number; centre: Point; spot: Point; area: Rect; door: THREE.Object3D; solid: Solid; content: THREE.Group }[]; walls: Solid[] };

export type KeyWorld = {
  group: THREE.Group;
  /** Meshes you can tap, each with userData { tap: "ground" | "room" | "object" | "chest" | "inner", id }. */
  targets: THREE.Object3D[];
  sky: string;
  start: Point;
  places: WorldPlace[];
  /** Whether the hunter can't stand here (a wall, a stall, the world's edge). */
  blocked(p: Point, r?: number): boolean;
  /** The story place the hunter is in (its index), or −1 out in the town. */
  placeAt(p: Point): number;
  /** The way from one spot to another, round the walls (the last point is the spot, or the nearest free one). */
  route(from: Point, to: Point): Point[];
  /** Where to stand to touch a thing. */
  objectSpot(id: string): Point | null;
  setLocked(i: number, locked: boolean): void;
  setChest(i: number | null): void;
  /** The treasure building's five rooms (null: none showing), each shut or opened with what it held. */
  setInner(i: number | null, list: InnerRoomView[] | null): void;
  /** The treasure building's rooms: where to stand at each door (in the hall), and which room the hunter is in. */
  innerDoors(i: number): Point[];
  innerAt(p: Point): number;
  /** Each frame: the hunter's place opens (its roof lifts), and buildings between the camera and the hunter drop away. */
  tick(dt: number, me: Point, eye: Point): void;
};

const along = (f: number, lx: number, lz: number): Point => ({ x: lx * Math.cos(f) + lz * Math.sin(f), z: -lx * Math.sin(f) + lz * Math.cos(f) });
const at = (c: Point, f: number, lx: number, lz: number): Point => {
  const p = along(f, lx, lz);
  return { x: c.x + p.x, z: c.z + p.z };
};
const rectIn = (c: Point, f: number, lx0: number, lx1: number, lz0: number, lz1: number): Rect => {
  const a = at(c, f, lx0, lz0), b = at(c, f, lx1, lz1);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
};
const overlaps = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;
const inside = (p: Point, r: Rect, pad = 0) => p.x > r.x0 - pad && p.x < r.x1 + pad && p.z > r.z0 - pad && p.z < r.z1 + pad;
/** Whether the line a–b crosses a rectangle (the slab test). */
function crosses(a: Point, b: Point, r: Rect) {
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[a.x, b.x - a.x, r.x0, r.x1], [a.z, b.z - a.z, r.z0, r.z1]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
      continue;
    }
    let u = (lo - p) / d, v = (hi - p) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u);
    t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}

/** The ring's lots, clockwise from the north-west: where the story's places stand (centre, door facing). */
function lots(): { c: Point; f: number }[] {
  const off = RING + 0.5 + BD / 2, mid = (SPOKE + RING) / 2;
  return [
    { c: { x: -mid, z: -off }, f: 0 }, { c: { x: mid, z: -off }, f: 0 },
    { c: { x: off, z: -mid }, f: -Math.PI / 2 }, { c: { x: off, z: mid }, f: -Math.PI / 2 },
    { c: { x: mid, z: off }, f: Math.PI }, { c: { x: -mid, z: off }, f: Math.PI },
    { c: { x: -off, z: mid }, f: Math.PI / 2 }, { c: { x: -off, z: -mid }, f: Math.PI / 2 },
  ];
}

export function buildKeyWorld(rooms: HouseRoomView[], objects: HouseObjectView[], scene: KeyScene | null | undefined, title = ""): KeyWorld {
  const ground = scene?.ground && LOOK[scene.ground] ? scene.ground : "city";
  const look = LOOK[ground];
  const pieces = new Set(scene?.pieces ?? []);
  const group = new THREE.Group();
  const targets: THREE.Object3D[] = [];
  const solids: Solid[] = [];
  const taken: Rect[] = []; // where nothing else may be built
  const tag = <O extends THREE.Object3D>(o: O, tap: string, id: string) => {
    o.traverse((c) => (c.userData = { ...c.userData, tap, id }));
    targets.push(o);
    return o;
  };
  const solid = (r: Rect, on = true) => {
    const s = { r, on };
    solids.push(s);
    return s;
  };
  let seed = 7 + title.length * 31 + rooms.length;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // The land, the square and its street, the streets out to the edge
  const land = flat((REACH + 40) * 2, (REACH + 40) * 2, look.ground, 0, 0, 0);
  group.add(tag(land, "ground", "land"));
  const street = (w: number, d: number, x: number, z: number) => group.add(tag(flat(w, d, look.street, x, z, 0.02), "ground", "street"));
  street(RING * 2, RING * 2, 0, 0);
  for (const s of [-1, 1]) {
    street(SPOKE * 2, REACH - RING + 2, 0, s * (RING + (REACH - RING) / 2 + 1));
    street(REACH - RING + 2, SPOKE * 2, s * (RING + (REACH - RING) / 2 + 1), 0);
  }
  group.add(tag(flat(20, 20, floorMaterial(look.square, "flags", 20, 20), 0, 0, 0.03), "ground", "square"));
  // Lines down the streets, lamps round the square
  for (let t = -REACH + 1; t < REACH; t += 2.4) {
    if (Math.abs(t) < RING) continue;
    group.add(box(0.12, 0.02, 1.1, look.line, 0, 0.04, t, false), box(1.1, 0.02, 0.12, look.line, t, 0.04, 0, false));
  }
  if (ground === "city") {
    for (let t = -RING + 1; t <= RING - 1; t += 7) {
      for (const [x, z] of [[t, -RING + 0.3], [t, RING - 0.3], [-RING + 0.3, t], [RING - 0.3, t]]) {
        if (Math.abs(x) < SPOKE + 0.5 && Math.abs(z) > RING - 1) continue;
        if (Math.abs(z) < SPOKE + 0.5 && Math.abs(x) > RING - 1) continue;
        group.add(cyl(0.07, 3.2, "#3A3F45", x, 1.6, z), ball(0.22, "#F4E2B0", x, 3.25, z));
      }
    }
  }
  // The square stays clear for walking (the landmark's pieces claim their own spots below)
  taken.push({ x0: -RING, x1: RING, z0: -RING, z1: RING });
  for (const s of [-1, 1]) {
    taken.push({ x0: -SPOKE, x1: SPOKE, z0: Math.min(s * RING, s * (REACH + 3)), z1: Math.max(s * RING, s * (REACH + 3)) });
    taken.push({ z0: -SPOKE, z1: SPOKE, x0: Math.min(s * RING, s * (REACH + 3)), x1: Math.max(s * RING, s * (REACH + 3)) });
  }

  // ---- The key's landmark (the story's scene)
  const piece = (o: THREE.Object3D, r?: Rect) => {
    group.add(o);
    if (r) {
      solid(r);
      taken.push(r);
    }
  };
  const tracks = (z: number, from = -RING + 1, to = RING - 1) => {
    const g = new THREE.Group();
    for (const s of [-0.72, 0.72]) g.add(box(to - from, 0.08, 0.08, "#6B6B6B", (from + to) / 2, 0.06, z + s, false));
    for (let x = from; x <= to; x += 0.9) g.add(box(0.28, 0.05, 2.0, "#5A4030", x, 0.03, z, false));
    group.add(g);
  };
  const placeEngine = (color: string, x: number, z: number, turn: number, balloon = false) => {
    const e = engine(color, balloon);
    e.position.set(x, 0, z);
    e.rotation.y = turn;
    const c = Math.abs(Math.cos(turn)), s = Math.abs(Math.sin(turn));
    const hx = 2.8 * c + 0.9 * s, hz = 2.8 * s + 0.9 * c;
    piece(e, { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz });
  };
  if (pieces.has("station")) {
    // A station along the north side of the square: glass front, a canopy
    const g = new THREE.Group();
    g.add(box(16, 4.4, 3.2, "#D8D2C6", 0, 2.2, -8.4), box(15, 1.5, 0.06, "#5E8FB0", 0, 2.3, -6.77, false), box(17, 0.22, 1.8, "#3B4048", 0, 3.3, -6.1, false));
    for (const x of [-7.5, -2.5, 2.5, 7.5]) g.add(cyl(0.1, 3.3, "#3B4048", x, 1.65, -5.4));
    piece(g, { x0: -8, x1: 8, z0: -10, z1: -6.8 });
  }
  if (pieces.has("dog-statue")) {
    // The bronze dog on its plinth, waiting by the station
    const d = bronzeDog();
    d.position.set(-4.5, 0, -3.5);
    d.rotation.y = -Math.PI / 2; // looking out over the crossing
    piece(d, { x0: -5.3, x1: -3.7, z0: -4.3, z1: -2.7 });
    const plants = [[-6.2, -3.5], [-2.8, -3.5]];
    for (const [x, z] of plants) piece(ball(0.6, "#3E7A3A", x, 0.5, z), { x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 });
  }
  if (pieces.has("scramble")) {
    // A scramble crossing: zebra stripes across the street round the square, and both ways across the square
    const stripes = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const t = RING - 0.9 - k * 0.95;
      for (const s of [-1, 1]) {
        stripes.add(box(SPOKE * 2, 0.02, 0.5, "#F4F1EA", 0, 0.05, s * t, false), box(0.5, 0.02, SPOKE * 2, "#F4F1EA", s * t, 0.05, 0, false));
      }
    }
    for (const turn of [Math.PI / 4, -Math.PI / 4]) {
      for (let t = -8; t <= 8; t += 1) {
        const st = box(0.5, 0.02, 3.2, "#F4F1EA", t * Math.cos(turn) * 0.95, 0.06, 1.5 + t * Math.sin(turn) * 0.95, false);
        st.rotation.y = turn;
        stripes.add(st);
      }
    }
    group.add(stripes);
  }
  if (pieces.has("screens")) {
    // Towers with big bright screens over the crossing
    for (const [x, z, c] of [[-21, -21, "#FF4FA3"], [21, -21, "#3FD0FF"], [21, 21, "#FFD23F"]] as const) {
      const g = new THREE.Group();
      g.add(box(8, 18, 8, "#3A4250", x, 9, z, false));
      // On the face towards the square's street
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ color: c }));
      const toward = z < 0 ? 1 : -1;
      scr.position.set(x, 12, z + toward * 4.05);
      scr.rotation.y = toward > 0 ? 0 : Math.PI;
      g.add(scr);
      piece(g, { x0: x - 4, x1: x + 4, z0: z - 4, z1: z + 4 });
    }
  }
  if (pieces.has("clock-station")) {
    // An old railway station turned museum: pale stone, arched windows, two great clocks on its front
    const g = new THREE.Group();
    g.add(box(18, 6.2, 3.6, "#E6DCC8", 0, 3.1, -8.2), box(18.4, 0.5, 3.9, "#6E7A85", 0, 6.45, -8.2, false));
    for (const x of [-6, -2, 2, 6]) g.add(box(2.2, 3.2, 0.06, "#3B4A5A", x, 2.2, -6.38, false), cyl(1.1, 0.06, "#3B4A5A", x, 3.8, -6.38).rotateX(Math.PI / 2));
    for (const x of [-7.8, 7.8]) {
      g.add(cyl(1.2, 0.12, "#F4F1EA", x, 4.6, -6.3).rotateX(Math.PI / 2), cyl(1.3, 0.08, "#C8A45C", x, 4.6, -6.33).rotateX(Math.PI / 2));
      const hand = box(0.08, 0.9, 0.04, "#1A1A1A", x, 4.95, -6.22, false);
      const hand2 = box(0.6, 0.07, 0.04, "#1A1A1A", x + 0.25, 4.6, -6.22, false);
      g.add(hand, hand2);
    }
    piece(g, { x0: -9, x1: 9, z0: -10, z1: -6.4 });
  }
  if (pieces.has("brick-station")) {
    // A brick station: two great arched windows and a clock tower
    const g = new THREE.Group();
    g.add(box(18, 5.6, 3.6, "#8E3B2A", 0, 2.8, -8.2));
    for (const x of [-4.5, 4.5]) g.add(box(5, 3.2, 0.06, "#3B4A5A", x, 2.4, -6.38, false), cyl(2.5, 0.06, "#3B4A5A", x, 4.0, -6.38).rotateX(Math.PI / 2));
    g.add(box(2.6, 10, 2.6, "#8E3B2A", 0, 5, -8.2), box(2.9, 0.3, 2.9, "#5A2A1E", 0, 10.1, -8.2, false));
    g.add(cyl(0.9, 0.1, "#F4F1EA", 0, 8.2, -6.85).rotateX(Math.PI / 2), box(0.06, 0.7, 0.04, "#1A1A1A", 0, 8.45, -6.78, false));
    piece(g, { x0: -9, x1: 9, z0: -10, z1: -6.4 });
  }
  if (pieces.has("trolley-wall")) {
    // A brick wall with a luggage trolley half-way into it, and a plaque
    const g = new THREE.Group();
    g.add(box(4.4, 2.8, 0.45, "#8E3B2A", 5, 1.4, -1.5));
    g.add(box(1.0, 0.08, 0.7, "#3A3A3A", 5, 0.45, -0.95, false), box(0.9, 0.6, 0.6, "#6B4A2B", 5, 0.8, -1.0), box(0.7, 0.45, 0.5, "#8A2E2E", 5, 1.35, -1.05));
    g.add(box(0.06, 0.9, 0.06, "#3A3A3A", 4.55, 0.9, -0.55, false), box(0.06, 0.9, 0.06, "#3A3A3A", 5.45, 0.9, -0.55, false), box(1.0, 0.06, 0.06, "#3A3A3A", 5, 1.35, -0.55, false));
    for (const x of [4.6, 5.4]) g.add(cyl(0.14, 0.08, "#1D1D1D", x, 0.15, -0.65).rotateZ(Math.PI / 2));
    g.add(box(0.9, 0.35, 0.04, "#1F2A44", 5, 2.3, -1.26, false));
    piece(g, { x0: 2.8, x1: 7.2, z0: -1.8, z1: -0.4 });
  }
  if (pieces.has("river")) {
    // A river along the far south, a stone quay wall, and the booksellers' green boxes on it
    group.add(flat(REACH * 2 + 60, 14, "#4F8FB8", 0, REACH - 2, 0.04));
    const wall = new THREE.Group();
    wall.add(box(REACH * 2 + 4, 0.9, 0.6, "#BFB3A2", 0, 0.45, 29.6, false));
    for (let x = -REACH + 2; x < REACH; x += 3.6) if (Math.abs(x) > SPOKE + 1) wall.add(box(1.6, 0.6, 0.6, "#2F5A3A", x, 1.2, 29.6, false), box(1.7, 0.08, 0.7, "#24472E", x, 1.53, 29.6, false));
    group.add(wall);
    const r = { x0: -REACH - 4, x1: REACH + 4, z0: 29.3, z1: REACH + 4 };
    solid(r);
    taken.push({ ...r, z0: 27 });
  }
  if (pieces.has("tracks")) tracks(0);
  if (pieces.has("rusty-engines")) {
    // Old steam engines left to rust under the open sky
    placeEngine("#8A4B2A", -5, 0, 0);
    placeEngine("#7A4126", 5.5, -6, 0.3);
    placeEngine("#93552F", 3, 6.5, -0.35, true);
  }
  if (pieces.has("water-tower")) {
    const g = new THREE.Group();
    for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) g.add(cyl(0.1, 4, "#5A4030", -8 + x, 2, 7 + z));
    g.add(cyl(1.4, 2.2, "#6B5A4A", -8, 5.1, 7), cyl(1.5, 0.2, "#3A3A3A", -8, 6.3, 7, 0.2));
    piece(g, { x0: -9.2, x1: -6.8, z0: 5.8, z1: 8.2 });
  }
  if (pieces.has("two-engines")) {
    // Two engines nose to nose where the rails met
    placeEngine("#2F3A4A", -3.0, 0, 0);
    placeEngine("#7A1F1F", 3.0, 0, Math.PI, true);
  }
  if (pieces.has("golden-spike")) {
    const g = new THREE.Group();
    g.add(box(0.6, 1.5, 0.6, "#D9CFB8", 0, 0.75, 4), cyl(0.08, 0.5, "#F4B41A", 0, 1.75, 4, 0.02));
    piece(g, { x0: -0.4, x1: 0.4, z0: 3.6, z1: 4.4 });
  }
  if (!pieces.size) {
    // Any square: a fountain in the middle, benches
    const g = new THREE.Group();
    g.add(cyl(2.2, 0.6, "#B9B5AB", 0, 0.3, 0), cyl(2.0, 0.06, "#6FB6D8", 0, 0.6, 0), cyl(0.3, 1.6, "#B9B5AB", 0, 1.1, 0), cyl(0.9, 0.25, "#B9B5AB", 0, 1.9, 0));
    piece(g, { x0: -2.2, x1: 2.2, z0: -2.2, z1: 2.2 });
    for (const [x, z] of [[-6, 0], [6, 0], [0, -6], [0, 6]]) piece(box(1.6, 0.45, 0.5, "#6B4A2B", x, 0.25, z), { x0: x - 0.8, x1: x + 0.8, z0: z - 0.25, z1: z + 0.25 });
  }

  // ---- The story's places, on the ring's lots (clockwise, starting where the title says, so no two keys match)
  const ring = lots();
  const first = Math.floor(rnd() * ring.length);
  const places: WorldPlace[] = [];
  const views: { walls: THREE.Group; roof: THREE.Group; open: number; ghost: number; area: Rect; frame: THREE.Group; low: boolean }[] = [];
  const gates: (Solid & { mesh: THREE.Object3D })[] = [];
  const chests: THREE.Object3D[] = [];
  const furniture: { group: THREE.Group; solid: Solid }[] = [];
  const objectSpots = new Map<string, Point>();
  const FACADES = ["#E8D5B0", "#C9A0A0", "#A0B8C9", "#E0D4A0", "#B5A0C9", "#D9B99B", "#A8C9A0"];
  const accents = ["#C0392B", "#2F6FEB", "#E5484D", "#1E9E62", "#F4B41A", "#9B5DE5", "#F28C28"];
  rooms.forEach((r, i) => {
    const lot = ring[(first + i) % ring.length];
    const f = lot.f, c = lot.c;
    const kind = PLOT[r.kind] ? r.kind : "study";
    const info = PLOT[kind];
    const accent = accents[i % accents.length];
    const outdoor = r.outdoor === true;
    const area = rectIn(c, f, -BW / 2, BW / 2, -BD / 2, BD / 2);
    taken.push(area);
    const door = at(c, f, 0, BD / 2);
    places.push({ id: r.id, outdoor, centre: c, facing: f, area, door, front: at(c, f, 0, BD / 2 + 1.0), inside: at(c, f, 0, BD / 2 - 1.4) });
    const frame = new THREE.Group();
    frame.position.set(c.x, 0, c.z);
    frame.rotation.y = f;
    group.add(frame);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(BW, 0.1, BD), outdoor ? mat(ground === "city" ? "#8DBF73" : look.ground) : floorMaterial(info.ground, info.pattern, BW, BD));
    floor.position.y = 0.05;
    frame.add(tag(floor, "room", r.id));
    const walls = new THREE.Group();
    const top = new THREE.Group();
    const T = outdoor ? 0.45 : 0.22;
    const hh = outdoor ? 0.85 : H;
    const colour = outdoor ? "#3E7A3A" : FACADES[(i + rooms.length) % FACADES.length];
    const wall = (lx0: number, lx1: number, lz0: number, lz1: number, h = hh, y = h / 2) => {
      walls.add(box(lx1 - lx0, h, lz1 - lz0, colour, (lx0 + lx1) / 2, y, (lz0 + lz1) / 2, !outdoor));
      solid(rectIn(c, f, lx0, lx1, lz0, lz1));
    };
    wall(-BW / 2, BW / 2, -BD / 2, -BD / 2 + T);
    wall(-BW / 2, -BW / 2 + T, -BD / 2, BD / 2);
    wall(BW / 2 - T, BW / 2, -BD / 2, BD / 2);
    wall(-BW / 2, -0.9, BD / 2 - T, BD / 2);
    wall(0.9, BW / 2, BD / 2 - T, BD / 2);
    if (!outdoor) {
      walls.add(box(1.8, H - 2.3, T, colour, 0, 2.3 + (H - 2.3) / 2, BD / 2 - T / 2)); // over the door
      for (const sx of [-1, 1]) {
        walls.add(box(1.2, 1.0, 0.05, "#2F4B63", sx * 3, 1.7, BD / 2 + 0.01, false)); // windows, front
        walls.add(box(0.05, 1.0, 1.2, "#2F4B63", sx * (BW / 2 + 0.01), 1.7, 0, false)); // the sides
      }
      walls.add(box(2.0, 0.12, 0.8, accent, 0, 2.45, BD / 2 + 0.35, false)); // an awning over the door
      if (i % 2 === 0) top.add(box(BW + 0.3, 0.2, BD + 0.3, "#6B4A2B", 0, H + 0.1, 0, false), roof(BW, BD, accent, H + 0.2));
      else top.add(box(BW + 0.3, 0.35, BD + 0.3, "#6B6F75", 0, H + 0.17, 0, false), cyl(0.6, 1.0, "#3B6EA5", BW / 4, H + 0.85, -BD / 4));
    } else {
      // Open air: a patch of bare earth where something could be buried
      frame.add(box(2.4, 0.04, 1.8, "#6B4A2B", -2.6, 0.12, 1.6, false));
      for (const [x, z] of [[-3.3, 2.1], [-2.0, 1.0], [-2.9, 1.1]]) frame.add(ball(0.13, "#5A4030", x, 0.14, z));
    }
    frame.add(tag(walls, "room", r.id), tag(top, "room", r.id));
    // Its door (or gate), shut while it needs something to open
    const gm = tag(outdoor ? box(1.8, 0.9, 0.12, "#6B3E22", 0, 0.45, BD / 2 - 0.2) : box(1.8, 2.3, 0.12, "#6B3E22", 0, 1.15, BD / 2 - 0.1), "room", r.id);
    gm.visible = r.locked === true;
    frame.add(gm);
    gates.push({ ...solid(rectIn(c, f, -0.9, 0.9, BD / 2 - 0.3, BD / 2), r.locked === true), mesh: gm });
    // What the place is, at its back
    const things = feature(kind, BW - 1, BD - 1, accent);
    frame.add(things);
    furniture.push({ group: things, solid: solid(rectIn(c, f, -BW / 2 + 0.3, BW / 2 - 0.3, -BD / 2 + 0.3, -BD / 2 + 2.9)) });
    // Things to touch
    objects
      .filter((o) => o.room === r.id)
      .slice(0, 3)
      .forEach((o, j) => {
        const m = tag(makeObject(o.kind), "object", o.id);
        const [lx, lz, turn] = ([[-BW / 2 + 1.0, 0.8, Math.PI / 2], [BW / 2 - 1.0, 0.8, -Math.PI / 2], [2.4, 2.2, Math.PI]] as const)[j];
        m.position.set(lx, 0.1, lz);
        m.rotation.y = turn;
        frame.add(m);
        objectSpots.set(o.id, at(c, f, lx + (j === 0 ? 1.2 : j === 1 ? -1.2 : 0), lz + (j === 2 ? -1.2 : 0)));
      });
    // The chest (buried, in the open)
    const chest = tag(makeChest(), "chest", r.id);
    chest.position.set(-2.6, 0.1, 1.6);
    chest.visible = false;
    frame.add(chest);
    chests.push(chest);
    views.push({ walls, roof: top, open: 0, ghost: 0, area, frame, low: outdoor });
  });

  // ---- The town: buildings wherever there's room, facing the nearest street
  const fillers: { group: THREE.Group; area: Rect; ghost: number }[] = [];
  const towns = ["#D9B99B", "#C9A0A0", "#A0B8C9", "#E0D4A0", "#B5A0C9", "#E8D5B0"];
  const tryBuild = (x: number, z: number, w: number, d: number) => {
    const area = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
    if (Math.abs(x) + w / 2 > REACH + 6 || Math.abs(z) + d / 2 > REACH + 6) return false;
    if (taken.some((t) => overlaps(area, t, 1.2))) return false;
    taken.push(area);
    // Facing the nearest street: the square, or a street out to the edge
    const toSquare = Math.max(Math.abs(x), Math.abs(z)) - RING;
    const toSpoke = Math.min(Math.abs(x), Math.abs(z));
    const f = toSpoke < toSquare
      ? Math.abs(x) < Math.abs(z) ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0
      : Math.abs(x) > Math.abs(z) ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = f;
    const turned = Math.abs(Math.sin(f)) > 0.5;
    const [lw, ld] = turned ? [d, w] : [w, d];
    const colour = towns[Math.floor(rnd() * towns.length)];
    if (ground === "city") {
      const h = 4 + Math.floor(rnd() * 4) * 3;
      const fx = Math.max(1, Math.round(ld / 2)), fz = Math.max(1, Math.round(lw / 2)), fy = Math.max(1, Math.round(h / 2.5));
      const top = mat("#6B6F75");
      const m = new THREE.Mesh(new THREE.BoxGeometry(lw, h, ld), [facade(colour, fx, fy), facade(colour, fx, fy), top, top, facade(colour, fz, fy), facade(colour, fz, fy)]);
      m.position.y = h / 2;
      g.add(m, box(1.1, 1.9, 0.12, "#4A2F1B", 0, 0.95, ld / 2 + 0.05, false), box(1.9, 0.12, 0.7, accents[Math.floor(rnd() * accents.length)], 0, 2.1, ld / 2 + 0.35, false));
      if (h < 6) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(lw, ld) / 2 + 0.3, 1.8, 4), mat("#B5543A"));
        cone.position.y = h + 0.9;
        cone.rotation.y = Math.PI / 4;
        g.add(cone);
      } else g.add(box(lw + 0.3, 0.4, ld + 0.3, "#555A60", 0, h + 0.2, 0, false), cyl(0.7, 1.2, "#3B6EA5", lw / 4, h + 1, -ld / 4));
    } else if (ground === "salt") {
      // Low whitewashed adobe, flat roofs
      const h = 2.4 + rnd();
      g.add(box(lw, h, ld, rnd() > 0.5 ? "#F1E9DA" : "#E3D3B8", 0, h / 2, 0), box(lw + 0.2, 0.25, ld + 0.2, "#CDBB9A", 0, h + 0.12, 0, false), box(1.0, 1.8, 0.1, "#5A3A20", 0, 0.9, ld / 2 + 0.03, false));
    } else {
      // Wooden sheds with pitched roofs
      const h = 2.6 + rnd();
      g.add(box(lw, h, ld, rnd() > 0.5 ? "#9C6B44" : "#B08156", 0, h / 2, 0), roof(lw, ld, "#5A3A20", h, 1.0), box(1.0, 1.8, 0.1, "#3A2414", 0, 0.9, ld / 2 + 0.03, false));
    }
    group.add(g);
    solid(area);
    fillers.push({ group: g, area, ghost: 0 });
    return true;
  };
  // The ring's empty lots first (a story with fewer places than lots), then all round
  for (let k = rooms.length; k < ring.length; k++) {
    const lot = ring[(first + k) % ring.length];
    const turned = Math.abs(Math.sin(lot.f)) > 0.5;
    tryBuild(lot.c.x, lot.c.z, turned ? BD - 1 : BW - 1, turned ? BW - 1 : BD - 1);
  }
  const sparse = ground !== "city";
  for (let x = -REACH + 3; x <= REACH - 3; x += 8.5) {
    for (let z = -REACH + 3; z <= REACH - 3; z += 8.5) {
      if (sparse && rnd() < 0.45) continue;
      const w = 5.5 + rnd() * 2, d = 5.5 + rnd() * 2;
      if (!tryBuild(x + (rnd() - 0.5) * 1.5, z + (rnd() - 0.5) * 1.5, w, d) && !sparse && rnd() < 0.5) {
        // No room for a building: a tree
        const p = { x: x + (rnd() - 0.5) * 3, z: z + (rnd() - 0.5) * 3 };
        const r = { x0: p.x - 0.5, x1: p.x + 0.5, z0: p.z - 0.5, z1: p.z + 0.5 };
        if (!taken.some((t) => overlaps(r, t, 0.6))) {
          taken.push(r);
          solid(r);
          group.add(cyl(0.18, 1.6, "#6B4A2B", p.x, 0.8, p.z), ball(1.0 + rnd() * 0.4, rnd() > 0.5 ? "#3E7A3A" : "#4E8E44", p.x, 2.1, p.z));
        }
      }
    }
  }
  // Out past the edge: tall blocks in the city, far hills elsewhere (the fog softens them)
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    const rr = REACH + 12 + rnd() * 6;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (ground === "city") group.add(box(7 + rnd() * 4, 10 + rnd() * 16, 7 + rnd() * 4, towns[k % towns.length], x, 8, z, false));
    else {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(6 + rnd() * 6, 4 + rnd() * 6, 6), mat(ground === "salt" ? "#B9AFA2" : "#B07A4E"));
      hill.position.set(x * 1.3, 2, z * 1.3);
      group.add(hill);
    }
  }
  if (sparse) {
    // A low fence round the edge
    for (const s of [-1, 1]) {
      group.add(box(REACH * 2, 0.6, 0.12, "#8A6A48", 0, 0.3, s * (REACH + 0.4), false), box(0.12, 0.6, REACH * 2, "#8A6A48", s * (REACH + 0.4), 0.3, 0, false));
    }
  }

  // ---- The treasure building's five rooms (built when it's found): a hall from the door, two rooms either side of it
  // and one across the back, each shut by a door until its puzzle is solved.
  const inner = new Map<number, Inner>();
  const CELLS = [
    { n: 1, x0: -BW / 2 + 0.22, x1: -1.2, z0: 1.5, z1: BD / 2 - 0.22, door: "left", dz: 3.15 },
    { n: 2, x0: -BW / 2 + 0.22, x1: -1.2, z0: -1.8, z1: 1.5, door: "left", dz: -0.15 },
    { n: 3, x0: -BW / 2 + 0.22, x1: BW / 2 - 0.22, z0: -BD / 2 + 0.22, z1: -1.8, door: "back", dz: 0 },
    { n: 4, x0: 1.2, x1: BW / 2 - 0.22, z0: -1.8, z1: 1.5, door: "right", dz: -0.15 },
    { n: 5, x0: 1.2, x1: BW / 2 - 0.22, z0: 1.5, z1: BD / 2 - 0.22, door: "right", dz: 3.15 },
  ] as const;
  const buildInner = (i: number): Inner => {
    const p = places[i];
    const c = p.centre, f = p.facing;
    const g = new THREE.Group();
    const walls: Solid[] = [];
    const LOW = 1.1, T = 0.16;
    const part = (lx0: number, lx1: number, lz0: number, lz1: number) => {
      g.add(box(lx1 - lx0, LOW, lz1 - lz0, "#BFB3A2", (lx0 + lx1) / 2, LOW / 2, (lz0 + lz1) / 2));
      walls.push(solid(rectIn(c, f, lx0, lx1, lz0, lz1)));
    };
    // The hall's sides (doorways into rooms 1, 2, 4, 5), the wall between front and back rooms, the back room's wall
    for (const s of [-1, 1]) {
      const x0 = s * 1.2 - T / 2, x1 = s * 1.2 + T / 2;
      part(x0, x1, -1.8, -0.75);
      part(x0, x1, 0.45, 2.55);
      part(x0, x1, 3.75, BD / 2 - 0.22);
      part(s < 0 ? -BW / 2 + 0.22 : 1.2, s < 0 ? -1.2 : BW / 2 - 0.22, 1.5 - T / 2, 1.5 + T / 2);
    }
    part(-BW / 2 + 0.22, -0.8, -1.8 - T / 2, -1.8 + T / 2);
    part(0.8, BW / 2 - 0.22, -1.8 - T / 2, -1.8 + T / 2);
    const cells = CELLS.map((cell, k) => {
      const cx = (cell.x0 + cell.x1) / 2, cz = (cell.z0 + cell.z1) / 2;
      g.add(tag(box(cell.x1 - cell.x0 - 0.1, 0.04, cell.z1 - cell.z0 - 0.1, k % 2 ? "#E6DCC6" : "#D8CDB4", cx, 0.12, cz, false), "inner", String(cell.n)));
      const [dx0, dx1, dz0, dz1] = cell.door === "back" ? [-0.8, 0.8, -1.8 - 0.08, -1.8 + 0.08] : cell.door === "left" ? [-1.28, -1.12, cell.dz - 0.6, cell.dz + 0.6] : [1.12, 1.28, cell.dz - 0.6, cell.dz + 0.6];
      const door = tag(box(dx1 - dx0 || 0.1, 1.9, dz1 - dz0 || 0.1, "#7A4E2A", (dx0 + dx1) / 2, 0.95, (dz0 + dz1) / 2), "inner", String(cell.n));
      g.add(door);
      const held = new THREE.Group();
      held.position.set(cx, 0.12, cz);
      g.add(held);
      const spot = cell.door === "back" ? { x: 0, z: -1.3 } : { x: cell.door === "left" ? -0.74 : 0.74, z: cell.dz }; // right up at the door
      return {
        n: cell.n,
        centre: at(c, f, cx, cz),
        spot: at(c, f, spot.x, spot.z),
        area: rectIn(c, f, cell.x0, cell.x1, cell.z0, cell.z1),
        door,
        solid: solid(rectIn(c, f, dx0, dx1, dz0, dz1)),
        content: held,
      };
    });
    views[i].frame.add(g);
    return { group: g, rooms: cells, walls };
  };

  const blocked = (p: Point, r = BODY) => Math.abs(p.x) > REACH - r || Math.abs(p.z) > REACH - r || solids.some((s) => s.on && inside(p, s.r, r));
  const placeAt = (p: Point) => places.findIndex((pl) => inside(p, pl.area, -0.3));
  /** Clear all the way along a–b (in steps), for a body a little smaller than the hunter's. */
  const clear = (a: Point, b: Point) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.3);
    for (let k = 1; k <= n; k++) if (blocked({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n }, BODY * 0.9)) return false;
    return true;
  };
  const freeNear = (p: Point) => {
    if (!blocked(p)) return p;
    for (let rr = 0.5; rr < 6; rr += 0.5) for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const q = { x: p.x + Math.cos(a) * rr, z: p.z + Math.sin(a) * rr };
      if (!blocked(q)) return q;
    }
    return p;
  };
  // Corners to steer round: round the square, along the streets, and through every place's door
  const ways: Point[] = [];
  for (const s of [-1, 1]) for (const t of [-1, 1]) ways.push({ x: s * (RING - 1.5), z: t * (RING - 1.5) }, { x: s * 6, z: t * 6 });
  for (const s of [-1, 1]) {
    ways.push({ x: 0, z: s * (RING - 1.5) }, { x: s * (RING - 1.5), z: 0 });
    for (const d of [20, 27, 34]) ways.push({ x: 0, z: s * d }, { x: s * d, z: 0 });
  }
  for (const p of places) ways.push(p.front, p.inside);
  const route = (from: Point, to0: Point) => {
    const to = freeNear(to0);
    if (clear(from, to)) return [to];
    const nodes = [from, to, ...ways.filter((w) => !blocked(w))];
    const n = nodes.length;
    const best = new Array<number>(n).fill(Infinity), prev = new Array<number>(n).fill(-1), done = new Array<boolean>(n).fill(false);
    best[0] = 0;
    for (;;) {
      let u = -1;
      for (let k = 0; k < n; k++) if (!done[k] && best[k] < Infinity && (u < 0 || best[k] < best[u])) u = k;
      if (u < 0 || u === 1) break;
      done[u] = true;
      for (let v = 0; v < n; v++) {
        if (done[v] || v === u) continue;
        const d = Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z);
        if (best[u] + d < best[v] && clear(nodes[u], nodes[v])) {
          best[v] = best[u] + d;
          prev[v] = u;
        }
      }
    }
    if (prev[1] < 0) return [to];
    const out: Point[] = [];
    for (let k = 1; k > 0; k = prev[k]) out.unshift(nodes[k]);
    return out;
  };

  return {
    group,
    targets,
    sky: look.sky,
    start: { x: 0, z: RING + 7 },
    places,
    blocked,
    placeAt,
    route,
    objectSpot: (id) => objectSpots.get(id) ?? null,
    setLocked(i, locked) {
      const g = gates[i];
      if (!g) return;
      g.on = locked;
      g.mesh.visible = locked;
    },
    setChest(i) {
      chests.forEach((c, k) => (c.visible = k === i));
    },
    setInner(i, list) {
      for (const [k, x] of inner) if (k !== i || !list) {
        x.group.visible = false;
        for (const w of x.walls) w.on = false;
        for (const r of x.rooms) r.solid.on = false;
        if (furniture[k]) {
          furniture[k].group.visible = true;
          furniture[k].solid.on = true;
        }
      }
      if (i === null || !list || !places[i]) return;
      let made = inner.get(i);
      if (!made) inner.set(i, (made = buildInner(i)));
      made.group.visible = true;
      for (const w of made.walls) w.on = true;
      // The place's own things make way for the rooms
      furniture[i].group.visible = false;
      furniture[i].solid.on = false;
      list.forEach((cell) => {
        const r = made!.rooms[cell.n - 1];
        if (!r) return;
        r.door.visible = !cell.open;
        r.solid.on = !cell.open;
        r.content.clear();
        if (cell.open && cell.outcome) r.content.add(content(cell.outcome));
      });
    },
    innerDoors(i) {
      const made = inner.get(i);
      if (made?.group.visible) return made.rooms.map((r) => r.spot);
      const p = places[i];
      return p ? CELLS.map((cell) => at(p.centre, p.facing, cell.door === "back" ? 0 : cell.door === "left" ? -0.74 : 0.74, cell.door === "back" ? -1.3 : cell.dz)) : [];
    },
    innerAt(p) {
      for (const x of inner.values()) if (x.group.visible) for (const r of x.rooms) if (inside(p, r.area)) return r.n;
      return 0;
    },
    tick(dt, me, eye) {
      const k = Math.min(1, 5 * dt);
      const here = placeAt(me);
      // A building between the camera and the hunter: it drops away (like a doll's house), so the hunter is never hidden
      const hides = (a: Rect) => crosses(me, eye, { x0: a.x0 - 0.4, x1: a.x1 + 0.4, z0: a.z0 - 0.4, z1: a.z1 + 0.4 });
      views.forEach((v, j) => {
        v.open += ((j === here ? 1 : 0) - v.open) * k;
        v.ghost += ((j !== here && !v.low && hides(v.area) ? 1 : 0) - v.ghost) * k;
        const low = Math.max(v.open, v.ghost);
        v.walls.scale.y = 1 - 0.72 * low;
        v.roof.position.y = v.open * 7;
        v.roof.visible = low < 0.6;
      });
      for (const fl of fillers) {
        fl.ghost += ((hides(fl.area) ? 1 : 0) - fl.ghost) * k;
        fl.group.scale.y = 1 - 0.88 * fl.ghost;
      }
    },
  };
}

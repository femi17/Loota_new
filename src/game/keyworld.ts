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
export type KeyScene = { ground?: "city" | "salt" | "desert" | "laterite"; pieces?: string[] };

export const REACH = 44; // the world's edge, each way from the middle (the big houses wall it in from 37.5 m)
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
  laterite: { sky: "#A6D4EE", ground: "#6E9E4E", street: "#A0583A", square: "#C08A63", line: "#E8D9C4" }, // red-earth roads in green country
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

/** Each kind of story place: its sign's picture, and whether it's open at the front (a stall, a café, a yard: you see
 * its goods from the street) or a house with a door. */
const SHOP: Record<string, { icon: string; open: boolean }> = {
  kitchen: { icon: "🍲", open: true }, library: { icon: "📚", open: true }, parlour: { icon: "☕", open: true },
  storeroom: { icon: "📦", open: true }, chapel: { icon: "🕯️", open: true }, bathroom: { icon: "⛲", open: true },
  bedroom: { icon: "🏠", open: false }, study: { icon: "📜", open: false }, cellar: { icon: "🪣", open: false },
};
const OPEN = 3.6; // half an open front's width

/** A painted shop sign: the place's picture and its name on a board (drawn once per sign). */
function shopSign(icon: string, name: string, accent: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 112;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3A2A1C";
  g.fillRect(0, 0, 512, 112);
  g.strokeStyle = accent;
  g.lineWidth = 8;
  g.strokeRect(6, 6, 500, 100);
  g.font = "60px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(icon, 22, 58);
  g.fillStyle = "#F4E9D2";
  g.font = "700 40px Georgia, 'Times New Roman', serif";
  g.fillText(name.replace(/^The /, ""), 104, 60, 390);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.96), new THREE.MeshLambertMaterial({ map: tex }));
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
/** A small house of the town, walked into by its door (its roof lifts off inside). */
type Home = { centre: Point; facing: number; area: Rect; front: Point; inside: Point; frame: THREE.Group; walls: THREE.Group; roof: THREE.Group; shade: THREE.Object3D; open: number; ghost: number; mats: THREE.Material[]; ld: number };
/** A locked box (rooms 2 to 5, in small houses) or the key's chest (room 1, at the right place). */
type Box = { n: number; spot: Point; group: THREE.Group; lock: THREE.Object3D; content: THREE.Group; home: number };

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
  /** The key's chest (room 1) at the right place, once it's found (null: not found). */
  setKey(i: number | null): void;
  /** Each box shut, or opened with what it held. */
  setBoxes(list: InnerRoomView[] | null): void;
  /** Where to stand to open each box that's showing (by room number). */
  boxSpots(): Record<number, Point>;
  /** The small house the hunter is in (its index), or −1; and the box in it (its room number), or 0. */
  homeAt(p: Point): number;
  homeBox(i: number): number;
  /** The small houses dark inside (no torch) or lit. */
  setDark(dark: boolean): void;
  /** Night (1) to day (0): the street lamps glow. */
  setNight(night: number): void;
  /** Each frame: the hunter's place opens (its roof lifts), and a building that really hides the hunter from the camera
   * turns see-through (owner, 3 Nov 2026: "Why are building going down when I move close to them"). */
  tick(dt: number, me: Point, eye: { x: number; y: number; z: number }): void;
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
/** Where along a–b (0 to 1) the line first enters a rectangle, or −1 if it misses (the slab test). */
function entry(a: Point, b: Point, r: Rect) {
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[a.x, b.x - a.x, r.x0, r.x1], [a.z, b.z - a.z, r.z0, r.z1]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return -1;
      continue;
    }
    let u = (lo - p) / d, v = (hi - p) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u);
    t1 = Math.min(t1, v);
    if (t0 > t1) return -1;
  }
  return t0;
}
/** A short number from a string (the same every time). */
function hash(text: string) {
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 16777619);
  // Stirred well at the end, so strings that differ only in their last character land far apart
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
/** Its materials made its own, so it can turn see-through without touching anything else. */
function fadeable(o: THREE.Object3D) {
  const out: THREE.Material[] = [];
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.material) return;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    const copies = list.map((x) => {
      const y = x.clone();
      out.push(y);
      return y;
    });
    m.material = Array.isArray(m.material) ? copies : copies[0];
  });
  return out;
}
function setFade(mats: THREE.Material[], alpha: number) {
  const see = alpha < 0.99;
  for (const m of mats) {
    if (m.transparent !== see) {
      m.transparent = see;
      m.depthWrite = !see;
      m.needsUpdate = true;
    }
    m.opacity = alpha;
  }
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

/** `seat`: the hunter's own arrangement of the story's places on the lots (their player id and key). */
export function buildKeyWorld(rooms: HouseRoomView[], objects: HouseObjectView[], scene: KeyScene | null | undefined, title = "", seat = ""): KeyWorld {
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
  const bulb = new THREE.MeshLambertMaterial({ color: "#F4E2B0" }); // the street lamps (they glow at night)
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
        const lamp = ball(0.22, "#F4E2B0", x, 3.25, z);
        lamp.material = bulb;
        group.add(cyl(0.07, 3.2, "#3A3F45", x, 1.6, z), lamp);
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
    group.add(flat(REACH * 2 + 60, 9, "#4F8FB8", 0, 33.8, 0.04)); // between the quay and the big houses
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
  // Nigerian landmarks (owner, 7 Nov 2026: a lifetime hunt in Nigeria only)
  const tree = (x: number, z: number, h = 3.2, leaf = "#3E7A3A") => {
    const g = new THREE.Group();
    g.add(cyl(0.18, h, "#6B4A2B", x, h / 2, z), ball(h * 0.42, leaf, x, h + 0.4, z));
    piece(g, { x0: x - 0.6, x1: x + 0.6, z0: z - 0.6, z1: z + 0.6 });
  };
  if (pieces.has("cap-theatre")) {
    // A great round hall shaped like a soldier's peaked cap: a pale drum, a dark band, the crown, and the peak
    const g = new THREE.Group();
    g.add(cyl(6.4, 4.2, "#E9E4D8", 0, 2.1, -5, 6.4, 32), cyl(6.6, 0.9, "#2F3A46", 0, 3.7, -5, 6.6, 32), cyl(6.8, 1.8, "#E9E4D8", 0, 5.0, -5, 5.0, 32));
    const peak = box(6.4, 0.25, 2.4, "#2F3A46", 0, 3.5, 2.2, false);
    peak.rotation.x = 0.2;
    g.add(peak);
    for (const x of [-2.4, 2.4]) g.add(box(1.6, 2.6, 0.06, "#3B4A5A", x, 1.3, 1.42, false));
    piece(g, { x0: -6.8, x1: 6.8, z0: -11.6, z1: 1.6 });
  }
  if (pieces.has("shrine-stage")) {
    // A music shrine: a stage under a tin roof, speaker stacks, lights in red, gold and green, benches before it
    const g = new THREE.Group();
    g.add(box(12, 1.0, 5, "#4A3A2E", 0, 0.5, -8), box(13, 0.2, 6.4, "#9AA3AA", 0, 5.2, -8, false));
    for (const x of [-6.2, 6.2]) g.add(cyl(0.12, 4.6, "#3B4048", x, 2.9, -5.2), box(1.2, 2.4, 1.0, "#1C1C1C", x * 0.85, 2.2, -6.2));
    for (const [x, c] of [[-3, "#D93B3B"], [0, "#F4B41A"], [3, "#1E9E62"]] as const) g.add(ball(0.35, c, x, 4.8, -5.4));
    piece(g, { x0: -6.6, x1: 6.6, z0: -11, z1: -5 });
    for (const z of [-1, 2]) for (const x of [-4, 0, 4]) piece(box(2.6, 0.45, 0.5, "#6B4A2B", x, 0.25, z), { x0: x - 1.3, x1: x + 1.3, z0: z - 0.25, z1: z + 0.25 });
  }
  if (pieces.has("palace-walls")) {
    // Red earth walls with pointed tops, and a great gate (a palace of the old north)
    const g = new THREE.Group();
    for (const x of [-9, 9]) g.add(box(10, 4.2, 1.2, "#A8573A", x, 2.1, -9));
    g.add(box(8, 6.2, 1.6, "#9B4E33", 0, 3.1, -9), box(3, 4, 0.06, "#2B1A10", 0, 2, -8.17, false));
    for (let x = -13.5; x <= 13.5; x += 1.5) g.add(cyl(0.5, 1.0, "#9B4E33", x, Math.abs(x) < 4 ? 6.7 : 4.7, -9, 0.02, 4));
    piece(g, { x0: -14, x1: 14, z0: -9.8, z1: -8.2 });
  }
  if (pieces.has("park-lake")) {
    // A park: lawn, a winding stream with a little bridge, flame trees
    group.add(flat(26, 18, "#6FA85A", 0, -2, 0.035));
    group.add(flat(22, 2.6, "#4F8FB8", 0, -4, 0.045));
    piece(box(2.8, 0.3, 3.4, "#8A6A4A", 0, 0.3, -4));
    for (const [x, z] of [[-9, -9], [-4, -9.5], [5, -9], [10, -8], [-10, 3], [9, 4]]) tree(x, z, 3.4, "#C8452E");
  }
  if (pieces.has("sculptures")) {
    // A sacred grove: tall curving earth sculptures among the trees
    for (const [x, z, h] of [[-6, -7, 5.5], [0, -9, 7], [6, -6.5, 5]] as const) {
      const g = new THREE.Group();
      g.add(cyl(0.9, h, "#8E6A4E", x, h / 2, z, 0.5, 10), ball(1.1, "#7E5A40", x + 0.3, h + 0.6, z), cyl(0.35, 2.4, "#8E6A4E", x - 0.9, h * 0.6, z, 0.2, 8).rotateZ(0.6));
      piece(g, { x0: x - 1.2, x1: x + 1.2, z0: z - 1.2, z1: z + 1.2 });
    }
    for (const [x, z] of [[-11, -10], [-9, 1], [11, -10], [10, 2], [-3, -12], [3, -12]]) tree(x, z, 4.2, "#2F6B34");
  }
  if (pieces.has("canopy-walk")) {
    // A swamp forest crossed high up by a walkway of planks on posts, with a lookout tower at its end
    group.add(flat(26, 16, "#5E7A4A", 0, -3, 0.035));
    const g = new THREE.Group();
    for (let x = -10; x <= 6; x += 4) g.add(cyl(0.15, 6, "#5A4030", x, 3, -6), box(4.1, 0.15, 1.1, "#8A6A4A", x + 2, 6, -6, false));
    g.add(box(3, 8, 3, "#7A5A3A", 9, 4, -6), box(3.6, 0.3, 3.6, "#4A3A2E", 9, 8.2, -6, false));
    piece(g, { x0: -10.5, x1: 10.5, z0: -7.6, z1: -4.4 });
    for (const [x, z] of [[-8, -11], [-2, -11], [4, -11], [-11, 1], [11, 2], [-5, 2]]) tree(x, z, 5, "#2F6B34");
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
  // Each hunter's own arrangement of the places on the lots (owner, 3 Nov 2026: "how do we handle users who are around
  // and they saw a user dig a place and got the treasure"): following someone leads into a different place. The town
  // itself (every lot's footprint, the streets) is the same for all.
  const order = ring.map((_, k) => k).sort((a, b) => hash(`${seat}:${title}:${a}`) - hash(`${seat}:${title}:${b}`));
  const places: WorldPlace[] = [];
  const views: { walls: THREE.Group; roof: THREE.Group; open: number; ghost: number; area: Rect; frame: THREE.Group; low: boolean; mats: THREE.Material[] }[] = [];
  const gates: (Solid & { mesh: THREE.Object3D })[] = [];
  const furniture: { group: THREE.Group; solid: Solid }[] = [];
  const objectSpots = new Map<string, Point>();
  const FACADES = ["#E8D5B0", "#C9A0A0", "#A0B8C9", "#E0D4A0", "#B5A0C9", "#D9B99B", "#A8C9A0"];
  const accents = ["#C0392B", "#2F6FEB", "#E5484D", "#1E9E62", "#F4B41A", "#9B5DE5", "#F28C28"];
  rooms.forEach((r, i) => {
    const lot = ring[order[i]];
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
    // A stall, a café, a yard: open at the front, its goods in view from the street; a house: a door and windows
    const shop = SHOP[kind] ?? SHOP.study;
    const gap = !outdoor && shop.open ? OPEN : 0.9;
    wall(-BW / 2, -gap, BD / 2 - T, BD / 2);
    wall(gap, BW / 2, BD / 2 - T, BD / 2);
    if (!outdoor) {
      walls.add(box(gap * 2, H - 2.3, T, colour, 0, 2.3 + (H - 2.3) / 2, BD / 2 - T / 2)); // over the door (or the front)
      for (const sx of [-1, 1]) {
        if (!shop.open) walls.add(box(1.2, 1.0, 0.05, "#2F4B63", sx * 3, 1.7, BD / 2 + 0.01, false)); // windows, front
        walls.add(box(0.05, 1.0, 1.2, "#2F4B63", sx * (BW / 2 + 0.01), 1.7, 0, false)); // the sides
      }
      walls.add(box(gap * 2 + 0.4, 0.12, shop.open ? 1.4 : 0.8, accent, 0, 2.3, BD / 2 + (shop.open ? 0.65 : 0.35), false)); // its awning
      if (shop.open) for (let k = 0; k < 8; k++) walls.add(box((gap * 2 + 0.4) / 8, 0.25, 0.04, k % 2 ? "#F4F1EA" : accent, -gap - 0.2 + ((k + 0.5) * (gap * 2 + 0.4)) / 8, 2.18, BD / 2 + 1.35, false)); // a striped edge
      // Its sign, painted on the front over the awning
      const board = shopSign(shop.icon, r.name, accent);
      board.position.set(0, 2.7, BD / 2 + 0.02);
      walls.add(board);
      if (i % 2 === 0) top.add(box(BW + 0.3, 0.2, BD + 0.3, "#6B4A2B", 0, H + 0.1, 0, false), roof(BW, BD, accent, H + 0.2));
      else top.add(box(BW + 0.3, 0.35, BD + 0.3, "#6B6F75", 0, H + 0.17, 0, false), cyl(0.6, 1.0, "#3B6EA5", BW / 4, H + 0.85, -BD / 4));
    } else {
      // Open air: a patch of bare earth where something could be buried, and a painted board on a post at the gate
      frame.add(box(2.4, 0.04, 1.8, "#6B4A2B", -2.6, 0.12, 1.6, false));
      const board = shopSign(shop.icon, r.name, accent);
      board.scale.setScalar(0.55);
      board.position.set(2.6, 1.55, BD / 2 + 0.25);
      frame.add(board, box(0.1, 1.3, 0.1, "#5A3A20", 2.6, 0.65, BD / 2 + 0.2, false));
      for (const [x, z] of [[-3.3, 2.1], [-2.0, 1.0], [-2.9, 1.1]]) frame.add(ball(0.13, "#5A4030", x, 0.14, z));
    }
    frame.add(tag(walls, "room", r.id), tag(top, "room", r.id));
    // Its door (or gate), shut while it needs something to open
    // (an open front, locked: its shutter down)
    const gm = tag(outdoor ? box(1.8, 0.9, 0.12, "#6B3E22", 0, 0.45, BD / 2 - 0.2) : gap > 1 ? box(gap * 2, 2.3, 0.1, "#8A8F96", 0, 1.15, BD / 2 - 0.1) : box(1.8, 2.3, 0.12, "#6B3E22", 0, 1.15, BD / 2 - 0.1), "room", r.id);
    gm.visible = r.locked === true;
    frame.add(gm);
    gates.push({ ...solid(rectIn(c, f, -gap, gap, BD / 2 - 0.3, BD / 2), r.locked === true), mesh: gm });
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
    views.push({ walls, roof: top, open: 0, ghost: 0, area, frame, low: outdoor, mats: outdoor ? [] : [...fadeable(walls), ...fadeable(top)] });
  });

  // ---- The town (owner, 4 Nov 2026: "let all the big houses form the parameter fence while the small houses stay in
  // the front, sides and all. Let all the small house be able to enter, so we can see inside"): big blocks wall the
  // town in all round its edge; small houses fill the streets inside, each with a door to walk in by.
  const fillers: { group: THREE.Group; area: Rect; ghost: number; h: number; mats: THREE.Material[] }[] = [];
  const towns = ["#D9B99B", "#C9A0A0", "#A0B8C9", "#E0D4A0", "#B5A0C9", "#E8D5B0"];
  const sparse = ground !== "city";
  const WALL = REACH - 6.5; // where the big houses begin, all round
  /** Which way a building at x, z faces: its door to the nearest street (the square's, or one out to the edge). */
  const facingAt = (x: number, z: number) => {
    const toSquare = Math.max(Math.abs(x), Math.abs(z)) - RING;
    const toSpoke = Math.min(Math.abs(x), Math.abs(z));
    return toSpoke < toSquare
      ? Math.abs(x) < Math.abs(z) ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0
      : Math.abs(x) > Math.abs(z) ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0;
  };
  // The ring's empty lots (a story with fewer places than lots): shut shops of the very same size as a place, so every
  // hunter's town has the same walls whichever places stand where
  for (let k = rooms.length; k < ring.length; k++) {
    const { c, f } = ring[order[k]];
    const area = rectIn(c, f, -BW / 2, BW / 2, -BD / 2, BD / 2);
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    g.rotation.y = f;
    g.add(box(BW, H, BD, towns[k % towns.length], 0, H / 2, 0), box(BW + 0.3, 0.35, BD + 0.3, "#6B6F75", 0, H + 0.17, 0, false));
    g.add(box(2.0, 2.3, 0.1, "#8A8F96", 0, 1.15, BD / 2 + 0.05, false)); // its shutter, down
    for (let y = 0.3; y < 2.3; y += 0.3) g.add(box(2.0, 0.03, 0.12, "#6B7077", 0, y, BD / 2 + 0.06, false));
    for (const sx of [-3, 3]) g.add(box(1.2, 1.0, 0.05, "#2F4B63", sx, 1.7, BD / 2 + 0.03, false));
    group.add(g);
    taken.push(area);
    solid(area);
    fillers.push({ group: g, area, ghost: 0, h: H + 0.4, mats: fadeable(g) });
  }
  // The wall of big houses: tall blocks back to back all round the edge (the streets end at them)
  const bigHouse = (x: number, z: number, w: number, d: number, f: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = f;
    const turned = Math.abs(Math.sin(f)) > 0.5;
    const [lw, ld] = turned ? [d, w] : [w, d];
    const colour = towns[Math.floor(rnd() * towns.length)];
    const h = ground === "city" ? 9 + Math.floor(rnd() * 5) * 3 : 5 + rnd() * 2;
    if (ground === "city") {
      const fx = Math.max(1, Math.round(ld / 2)), fz = Math.max(1, Math.round(lw / 2)), fy = Math.max(1, Math.round(h / 2.5));
      const top = mat("#6B6F75");
      const m = new THREE.Mesh(new THREE.BoxGeometry(lw, h, ld), [facade(colour, fx, fy), facade(colour, fx, fy), top, top, facade(colour, fz, fy), facade(colour, fz, fy)]);
      m.position.y = h / 2;
      g.add(m, box(lw + 0.3, 0.4, ld + 0.3, "#555A60", 0, h + 0.2, 0, false), cyl(0.7, 1.2, "#3B6EA5", lw / 4, h + 1, -ld / 4));
    } else {
      g.add(box(lw, h, ld, ground === "salt" ? (rnd() > 0.5 ? "#E9DFCB" : "#D8C6A6") : rnd() > 0.5 ? "#8A5C3A" : "#A3734C", 0, h / 2, 0, false), box(lw + 0.3, 0.3, ld + 0.3, ground === "salt" ? "#C9B693" : "#5A3A20", 0, h + 0.15, 0, false));
      for (let y = 1.6; y < h - 0.6; y += 2) for (const sx of [-lw / 4, lw / 4]) g.add(box(0.8, 0.8, 0.05, "#2F3A44", sx, y, ld / 2 + 0.02, false));
    }
    group.add(g);
    const area = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
    taken.push(area);
    solid(area);
    fillers.push({ group: g, area, ghost: 0, h: h + 1.5, mats: fadeable(g) });
  };
  const SEG = 8, DEEP = 6;
  for (let t = -REACH; t < REACH; t += SEG) {
    const mid = t + SEG / 2;
    bigHouse(mid, -(REACH - DEEP / 2), SEG - 0.4, DEEP, 0); // the north side, facing in
    bigHouse(mid, REACH - DEEP / 2, SEG - 0.4, DEEP, Math.PI); // the south side
  }
  for (let t = -WALL; t < WALL - 0.1; t += SEG) {
    const mid = Math.min(t + SEG / 2, WALL - SEG / 2);
    bigHouse(-(REACH - DEEP / 2), mid, DEEP, SEG - 0.4, Math.PI / 2); // the west side
    bigHouse(REACH - DEEP / 2, mid, DEEP, SEG - 0.4, -Math.PI / 2); // the east side
  }
  // The small houses, each walked into by its door
  const homes: Home[] = [];
  const darkMat = new THREE.MeshBasicMaterial({ color: "#05070C", transparent: true, opacity: 0.62, depthWrite: false });
  let dark = true;
  const tryHome = (x: number, z: number, w: number, d: number) => {
    const area = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
    if (Math.max(Math.abs(area.x0), Math.abs(area.x1), Math.abs(area.z0), Math.abs(area.z1)) > WALL - 1.6) return false;
    if (taken.some((t) => overlaps(area, t, 2.0))) return false; // an alley between houses
    taken.push(area);
    const f = facingAt(x, z);
    const turned = Math.abs(Math.sin(f)) > 0.5;
    const [lw, ld] = turned ? [d, w] : [w, d];
    const c = { x, z };
    const frame = new THREE.Group();
    frame.position.set(x, 0, z);
    frame.rotation.y = f;
    group.add(frame);
    const colour = ground === "city" ? towns[Math.floor(rnd() * towns.length)] : ground === "salt" ? (rnd() > 0.5 ? "#F1E9DA" : "#E3D3B8") : rnd() > 0.5 ? "#9C6B44" : "#B08156";
    const floor = new THREE.Mesh(new THREE.BoxGeometry(lw, 0.08, ld), floorMaterial("#C9B99A", "boards", lw, ld));
    floor.position.y = 0.04;
    frame.add(tag(floor, "ground", "home"));
    const walls = new THREE.Group();
    const T = 0.18, HH = 2.7, DOOR = 0.85;
    const wall = (lx0: number, lx1: number, lz0: number, lz1: number) => {
      walls.add(box(lx1 - lx0, HH, lz1 - lz0, colour, (lx0 + lx1) / 2, HH / 2, (lz0 + lz1) / 2));
      solid(rectIn(c, f, lx0, lx1, lz0, lz1));
    };
    wall(-lw / 2, lw / 2, -ld / 2, -ld / 2 + T);
    wall(-lw / 2, -lw / 2 + T, -ld / 2, ld / 2);
    wall(lw / 2 - T, lw / 2, -ld / 2, ld / 2);
    wall(-lw / 2, -DOOR, ld / 2 - T, ld / 2);
    wall(DOOR, lw / 2, ld / 2 - T, ld / 2);
    walls.add(box(DOOR * 2, HH - 2.1, T, colour, 0, 2.1 + (HH - 2.1) / 2, ld / 2 - T / 2)); // over the door
    for (const sx of [-1, 1]) walls.add(box(0.8, 0.8, 0.05, "#2F4B63", sx * (lw / 4 + 0.4), 1.6, ld / 2 + 0.01, false));
    walls.add(box(DOOR * 2 + 0.2, 0.1, 0.6, accents[Math.floor(rnd() * accents.length)], 0, 2.2, ld / 2 + 0.3, false));
    frame.add(walls);
    const top = new THREE.Group();
    if (ground === "salt") top.add(box(lw + 0.25, 0.25, ld + 0.25, "#CDBB9A", 0, HH + 0.12, 0, false));
    else top.add(box(lw + 0.25, 0.15, ld + 0.25, "#6B4A2B", 0, HH + 0.07, 0, false), roof(lw, ld, ground === "city" ? "#B5543A" : "#5A3A20", HH + 0.1, 1.0));
    frame.add(top);
    // Inside: a table and a shelf (in the corners, clear of the box at the back)
    frame.add(box(1.0, 0.75, 0.6, "#7A5230", -lw / 2 + 0.8, 0.38, 0.2), box(0.5, 1.6, 0.35, "#5C3B22", lw / 2 - 0.45, 0.8, -ld / 2 + 0.6));
    solid(rectIn(c, f, -lw / 2 + 0.25, -lw / 2 + 1.35, -0.15, 0.55));
    solid(rectIn(c, f, lw / 2 - 0.75, lw / 2 - 0.15, -ld / 2 + 0.3, -ld / 2 + 0.85));
    // Dark inside, until a torch lights it
    const shade = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.4, 2.3, ld - 0.4), darkMat);
    shade.position.y = 1.2;
    shade.visible = false;
    frame.add(shade);
    homes.push({ centre: c, facing: f, area, front: at(c, f, 0, ld / 2 + 0.9), inside: at(c, f, 0, ld / 2 - 1.2), frame, walls, roof: top, shade, open: 0, ghost: 0, mats: [...fadeable(walls), ...fadeable(top)], ld });
    return true;
  };
  const homeAt = (p: Point) => homes.findIndex((hm) => inside(p, hm.area, -0.25));
  for (let pass = 0; pass < 2 && homes.length < 6; pass++) {
    for (let x = -WALL + 4.7; x <= WALL - 4.7; x += 8.2) {
      for (let z = -WALL + 4.7; z <= WALL - 4.7; z += 8.2) {
        if (pass === 0 && sparse && rnd() < 0.3) continue;
        const w = 5 + rnd() * 1.2, d = 5 + rnd() * 1.2;
        if (!tryHome(x + (rnd() - 0.5) * (pass ? 3 : 0.8), z + (rnd() - 0.5) * (pass ? 3 : 0.8), w, d) && !sparse && rnd() < 0.4) {
          // No room for a house: a tree
          const p = { x: x + (rnd() - 0.5) * 3, z: z + (rnd() - 0.5) * 3 };
          const r = { x0: p.x - 0.5, x1: p.x + 0.5, z0: p.z - 0.5, z1: p.z + 0.5 };
          if (Math.max(Math.abs(p.x), Math.abs(p.z)) < WALL - 1 && !taken.some((t) => overlaps(r, t, 0.6))) {
            taken.push(r);
            solid(r);
            group.add(cyl(0.18, 1.6, "#6B4A2B", p.x, 0.8, p.z), ball(1.0 + rnd() * 0.4, rnd() > 0.5 ? "#3E7A3A" : "#4E8E44", p.x, 2.1, p.z));
          }
        }
      }
    }
  }
  // Out past the wall: far blocks in the city, far hills elsewhere (the fog softens them)
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    const rr = REACH + 14 + rnd() * 6;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (ground === "city") group.add(box(7 + rnd() * 4, 14 + rnd() * 16, 7 + rnd() * 4, towns[k % towns.length], x, 10, z, false));
    else {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(6 + rnd() * 6, 6 + rnd() * 6, 6), mat(ground === "salt" ? "#B9AFA2" : "#B07A4E"));
      hill.position.set(x * 1.3, 3, z * 1.3);
      group.add(hill);
    }
  }

  // ---- The finds (owner, 4 Nov 2026: "do not keep all the item in one house"): the key's chest at the right place
  // (room 1, made when it's found), and four locked boxes in small houses of the hunter's own (rooms 2 to 5: the
  // coins, the next chapter, a fake chest and a trap, in an order of their own on the server)
  const boxes = new Map<number, Box>();
  const makeBox = (n: number, frame: THREE.Group, lx: number, lz: number, spot: Point, home: number, chest: boolean) => {
    const g = new THREE.Group();
    g.position.set(lx, 0.08, lz);
    if (chest) g.add(makeChest());
    else g.add(box(0.9, 0.6, 0.6, "#3B3F46", 0, 0.3, 0), box(0.94, 0.08, 0.64, "#C8A45C", 0, 0.45, 0, false), box(0.94, 0.08, 0.64, "#C8A45C", 0, 0.15, 0, false));
    const lock = box(0.18, 0.22, 0.06, "#C8A45C", 0, chest ? 0.42 : 0.32, chest ? 0.4 : 0.33, false);
    g.add(lock);
    const held = new THREE.Group();
    held.position.y = chest ? 0.7 : 0.62;
    g.add(held);
    frame.add(tag(g, "inner", String(n)));
    boxes.set(n, { n, spot, group: g, lock, content: held, home });
  };
  const homeOrder = homes.map((_, k) => k).sort((a, b) => hash(`${seat}:box:${a}`) - hash(`${seat}:box:${b}`));
  for (let n = 2; n <= 5; n++) {
    const k = homeOrder[n - 2];
    const hm = homes[k];
    if (!hm) continue;
    makeBox(n, hm.frame, 0, -hm.ld / 2 + 0.75, at(hm.centre, hm.facing, 0, -hm.ld / 2 + 1.75), k, false);
  }

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
  // The way round the walls: A* over half-metre squares of the town (it finds the alleys between the small houses),
  // then straightened (each turn kept only where the straight line would hit something). Squares are worked out as
  // they're reached, so a short walk looks at few of them.
  const CELL = 0.5, SIDE = Math.ceil((REACH * 2) / CELL);
  const cellOf = (p: Point) => [Math.floor((p.x + REACH) / CELL), Math.floor((p.z + REACH) / CELL)] as const;
  const centreOf = (cx: number, cz: number): Point => ({ x: -REACH + (cx + 0.5) * CELL, z: -REACH + (cz + 0.5) * CELL });
  const route = (start: Point, to0: Point) => {
    const goal = freeNear(to0);
    if (clear(start, goal)) return [goal];
    const free = new Map<number, boolean>();
    const open = (cx: number, cz: number) => {
      if (cx < 0 || cz < 0 || cx >= SIDE || cz >= SIDE) return false;
      const id = cz * SIDE + cx;
      let ok = free.get(id);
      if (ok === undefined) free.set(id, (ok = !blocked(centreOf(cx, cz), BODY * 0.9)));
      return ok;
    };
    const [sx, sz] = cellOf(start), [gx, gz] = cellOf(goal);
    const key = (cx: number, cz: number) => cz * SIDE + cx;
    const g = new Map<number, number>([[key(sx, sz), 0]]);
    const prev = new Map<number, number>();
    // A small binary heap of [score, cell]
    const heap: [number, number][] = [];
    const push = (item: [number, number]) => {
      heap.push(item);
      for (let k = heap.length - 1; k > 0; ) {
        const up = (k - 1) >> 1;
        if (heap[up][0] <= heap[k][0]) break;
        [heap[up], heap[k]] = [heap[k], heap[up]];
        k = up;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ; ) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const h = (cx: number, cz: number) => {
      const dx = Math.abs(cx - gx), dz = Math.abs(cz - gz);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    push([h(sx, sz), key(sx, sz)]);
    let found = false;
    for (let steps = 0; heap.length && steps < 60000; steps++) {
      const [, cur] = pop();
      const cx = cur % SIDE, cz = Math.floor(cur / SIDE);
      if (cx === gx && cz === gz) {
        found = true;
        break;
      }
      const base = g.get(cur)!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const nx = cx + dx, nz = cz + dz;
        if (!open(nx, nz)) continue;
        if (dx && dz && (!open(cx + dx, cz) || !open(cx, cz + dz))) continue; // no cutting a corner
        const cost = base + (dx && dz ? Math.SQRT2 : 1);
        const nk = key(nx, nz);
        if (cost < (g.get(nk) ?? Infinity)) {
          g.set(nk, cost);
          prev.set(nk, cur);
          push([cost + h(nx, nz), nk]);
        }
      }
    }
    if (!found) return [goal];
    const cells: Point[] = [];
    for (let k: number | undefined = key(gx, gz); k !== undefined && k !== key(sx, sz); k = prev.get(k)) cells.unshift(centreOf(k % SIDE, Math.floor(k / SIDE)));
    cells.push(goal);
    // Straightened: from each point, on to the farthest one in plain sight
    const out: Point[] = [];
    let at = start;
    for (let k = 0; k < cells.length; ) {
      let far = k;
      while (far + 1 < cells.length && clear(at, cells[far + 1])) far++;
      out.push(cells[far]);
      at = cells[far];
      k = far + 1;
    }
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
    setKey(i) {
      const old = boxes.get(1);
      if (old) {
        old.group.removeFromParent();
        boxes.delete(1);
      }
      const p = i === null ? null : places[i];
      if (!p) return;
      // In a building, in the middle of its floor; in the open, in the dug earth
      const [lx, lz] = p.outdoor ? [-2.6, 1.6] : [0, -0.4];
      makeBox(1, views[i!].frame, lx, lz, at(p.centre, p.facing, lx, lz + 1.15), -1, true);
    },
    setBoxes(list) {
      for (const cell of list ?? []) {
        const b = boxes.get(cell.n);
        if (!b) continue;
        b.lock.visible = !cell.open;
        b.content.clear();
        if (cell.open && cell.outcome) b.content.add(content(cell.outcome));
      }
    },
    boxSpots() {
      return Object.fromEntries([...boxes.values()].map((b) => [b.n, b.spot]));
    },
    homeAt,
    homeBox(i) {
      for (const b of boxes.values()) if (b.home === i && b.home >= 0) return b.n;
      return 0;
    },
    setDark(on) {
      dark = on;
    },
    setNight(n) {
      bulb.emissive.setRGB(0.95 * n, 0.82 * n, 0.45 * n);
    },
    tick(dt, me, eye) {
      const k = Math.min(1, 5 * dt);
      const here = placeAt(me);
      // A building hides the hunter only where the line from the camera down to them passes through it below its
      // roof: then it turns see-through (it no longer sinks), and back as the hunter walks on
      const hides = (a: Rect, h: number) => {
        const t = entry(me, eye, { x0: a.x0 - 0.3, x1: a.x1 + 0.3, z0: a.z0 - 0.3, z1: a.z1 + 0.3 });
        return t >= 0 && 1.6 + (eye.y - 1.6) * t < h;
      };
      views.forEach((v, j) => {
        v.open += ((j === here ? 1 : 0) - v.open) * k;
        v.ghost += ((j !== here && !v.low && hides(v.area, H + 1.4) ? 1 : 0) - v.ghost) * k;
        v.walls.scale.y = 1 - 0.72 * v.open; // inside: the roof off, the walls low
        v.roof.position.y = v.open * 7;
        v.roof.visible = v.open < 0.6;
        setFade(v.mats, 1 - 0.75 * v.ghost);
      });
      for (const fl of fillers) {
        fl.ghost += ((hides(fl.area, fl.h) ? 1 : 0) - fl.ghost) * k;
        setFade(fl.mats, 1 - 0.78 * fl.ghost);
      }
      // The small houses: the one the hunter is in opens (roof off, walls low, dark inside without a torch)
      const home = homeAt(me);
      homes.forEach((hm, j) => {
        hm.open += ((j === home ? 1 : 0) - hm.open) * k;
        hm.ghost += ((j !== home && hides(hm.area, 3.9) ? 1 : 0) - hm.ghost) * k;
        hm.walls.scale.y = 1 - 0.7 * hm.open;
        hm.roof.position.y = hm.open * 6;
        hm.roof.visible = hm.open < 0.6;
        hm.shade.visible = dark && hm.open > 0.5;
        setFade(hm.mats, 1 - 0.75 * hm.ghost);
      });
    },
  };
}

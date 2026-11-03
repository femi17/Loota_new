/**
 * The house at a story key (owner, 31 Oct 2026: "a scene, like an open house, like sims"): a cutaway house seen from
 * above at an angle, the walls cut low so you see in. Built in code from simple shapes, like the rest of the game's
 * models. Nothing in it glows: what can be touched looks like everything else.
 * Houses differ (owner, 1 Nov 2026: "the house can be alot different"): three floor plans (a hall down the middle, a
 * gallery across, rooms round a courtyard), six looks, and furnished rooms outlined so they read on a phone.
 * Units are metres; the camera looks in from +x, +z. Each room's things are laid out facing its doorway.
 */
import * as THREE from "three";

export type HouseRoomView = { id: string; name: string; kind: string; locked: boolean; chest: boolean; outdoor?: boolean };
/** How the house looks (owner, 31 Oct 2026: not every house the same): its ground, walls and floors. */
export const HOUSE_STYLES = ["cottage", "manor", "stone", "fort", "cave", "keeper"] as const;
export type HouseStyle = (typeof HOUSE_STYLES)[number];
export const HOUSE_LAYOUTS = ["hall", "gallery", "court"] as const;
export type HouseLayout = (typeof HOUSE_LAYOUTS)[number];
const STYLE: Record<HouseStyle, { ground: string; back: string; wall?: string; floor?: string; trim: string; path: string }> = {
  cottage: { ground: "#6A9A52", back: "#E2D3B0", trim: "#B4553A", path: "#C9B99A" },
  manor: { ground: "#558A44", back: "#D6C29A", wall: "#EADBBB", trim: "#8E5E2E", path: "#D8CDB6" },
  stone: { ground: "#7A8A62", back: "#A19E96", wall: "#B9B5AB", floor: "#8E887D", trim: "#6E6A62", path: "#A8A296" },
  fort: { ground: "#D4BE8A", back: "#C8A46A", wall: "#DDBE84", floor: "#B89A6A", trim: "#8E6F42", path: "#E6D3A6" },
  cave: { ground: "#5A5048", back: "#776B5E", wall: "#8C8072", floor: "#6E6458", trim: "#4E463E", path: "#8E8272" },
  keeper: { ground: "#5E9A50", back: "#F2F2EE", wall: "#F7F4ED", trim: "#C23B3B", path: "#D9D2C2" },
};
export type HouseObjectView = { id: string; room: string; kind: string; label: string };

const WALL_LOW = 0.9;
const WALL_HIGH = 2.8;
const T = 0.18;

type Point = { x: number; z: number };
/** A room in the plan: its centre and size (w along x, d along z), its doorway, the spot in the hall just outside it,
 * the spot just inside it, and how its contents turn to face the doorway. */
export type PlanRoom = { x: number; z: number; w: number; d: number; door: Point; front: Point; inside: Point; facing: number };
export type Plan = {
  layout: HouseLayout;
  rooms: PlanRoom[];
  /** Where you can walk between rooms (each a rectangle, centre and size). */
  walks: { x: number; z: number; w: number; d: number }[];
  /** On the porch, outside; and just inside the front door. */
  start: Point;
  entrance: Point;
  porch: { x: number; z: number; w: number; d: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  centre: Point;
};

/** A house's floor plan: given, else picked from its name (the same house always looks the same). */
export function layoutOf(title: string, given?: string | null): HouseLayout {
  if (given && (HOUSE_LAYOUTS as readonly string[]).includes(given)) return given as HouseLayout;
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HOUSE_LAYOUTS[h % HOUSE_LAYOUTS.length];
}

function roomAtDoor(x: number, z: number, w: number, d: number, door: Point, inward: Point, step = 1.1): PlanRoom {
  return {
    x, z, w, d, door,
    front: { x: door.x - inward.x * 0.6, z: door.z - inward.z * 0.6 },
    inside: { x: door.x + inward.x * step, z: door.z + inward.z * step },
    facing: Math.atan2(-inward.x, -inward.z), // local +z points back out of the doorway
  };
}

/** Sizes: a room's width and depth, the hall's width, a courtyard's, how far in the hunter stands. */
export type PlanSize = { w: number; d: number; hall: number; court: number; step: number };
export const HOUSE_SIZE: PlanSize = { w: 5.4, d: 4.8, hall: 2.8, court: 5.6, step: 1.1 };

export function planHouse(n: number, layout: HouseLayout, size: PlanSize = HOUSE_SIZE): Plan {
  const { w: ROOM_W, d: ROOM_D, hall: HALL, court: C, step } = size;
  const at = (x: number, z: number, w: number, d: number, door: Point, inward: Point) => roomAtDoor(x, z, w, d, door, inward, step);
  const rooms: PlanRoom[] = [];
  let walks: Plan["walks"];
  let start: Point, entrance: Point, porch: Plan["porch"];
  if (layout === "gallery") {
    // A gallery across the house; rooms behind it and in front of it; the way in at its west end.
    const cols = Math.ceil(n / 2);
    const len = cols * ROOM_W;
    for (let i = 0; i < n; i++) {
      const c = Math.floor(i / 2);
      const x = -len / 2 + c * ROOM_W + ROOM_W / 2;
      if (i % 2 === 0) rooms.push(at(x, -HALL / 2 - ROOM_D / 2, ROOM_W, ROOM_D, { x, z: -HALL / 2 }, { x: 0, z: -1 }));
      else rooms.push(at(x, HALL / 2 + ROOM_D / 2, ROOM_W, ROOM_D, { x, z: HALL / 2 }, { x: 0, z: 1 }));
    }
    walks = [{ x: 0, z: 0, w: len, d: HALL }];
    porch = { x: -len / 2 - 0.8, z: 0, w: 1.6, d: HALL };
    start = { x: -len / 2 - 0.9, z: 0 };
    entrance = { x: -len / 2 + 0.7, z: 0 };
  } else if (layout === "court") {
    // Rooms down both sides of an open courtyard and one across its far end; the gate at the front.
    const left = Math.ceil((n - 1) / 2);
    const right = n - 1 - left;
    const depth = Math.max(left, 1) * ROOM_D;
    let li = 0, ri = 0;
    for (let i = 0; i < n; i++) {
      if (i === n - 1) {
        rooms.push(at(0, -depth - ROOM_D / 2, C, ROOM_D, { x: 0, z: -depth }, { x: 0, z: -1 }));
      } else if (i % 2 === 0 && li < left) {
        const z = -(li++ * ROOM_D + ROOM_D / 2);
        rooms.push(at(-C / 2 - ROOM_W / 2, z, ROOM_W, ROOM_D, { x: -C / 2, z }, { x: -1, z: 0 }));
      } else {
        const z = -(ri++ * ROOM_D + ROOM_D / 2);
        rooms.push(at(C / 2 + ROOM_W / 2, z, ROOM_W, ROOM_D, { x: C / 2, z }, { x: 1, z: 0 }));
      }
    }
    void right;
    walks = [{ x: 0, z: -depth / 2, w: C, d: depth }];
    porch = { x: 0, z: 0.8, w: 2.6, d: 1.6 };
    start = { x: 0, z: 1.0 };
    entrance = { x: 0, z: -0.7 };
  } else {
    // A hall down the middle, rooms either side, rows going back from the front door.
    const rows = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -(Math.floor(i / 2) * ROOM_D + ROOM_D / 2);
      rooms.push(at(side * (HALL / 2 + ROOM_W / 2), z, ROOM_W, ROOM_D, { x: (side * HALL) / 2, z }, { x: side, z: 0 }));
    }
    walks = [{ x: 0, z: -(rows * ROOM_D) / 2, w: HALL, d: rows * ROOM_D }];
    porch = { x: 0, z: 0.8, w: HALL, d: 1.6 };
    start = { x: 0, z: 1.0 };
    entrance = { x: 0, z: -0.7 };
  }
  const xs = [...rooms.flatMap((r) => [r.x - r.w / 2, r.x + r.w / 2]), ...walks.flatMap((w) => [w.x - w.w / 2, w.x + w.w / 2]), porch.x - porch.w / 2, porch.x + porch.w / 2];
  const zs = [...rooms.flatMap((r) => [r.z - r.d / 2, r.z + r.d / 2]), ...walks.flatMap((w) => [w.z - w.d / 2, w.z + w.d / 2]), porch.z - porch.d / 2, porch.z + porch.d / 2];
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  return { layout, rooms, walks, start, entrance, porch, bounds, centre: { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 } };
}

const within = (p: Point, r: { x: number; z: number; w: number; d: number }, pad = 0) =>
  Math.abs(p.x - r.x) <= r.w / 2 + pad && Math.abs(p.z - r.z) <= r.d / 2 + pad;
/** The room a point is in (-1: the hall, the porch or outside). */
export function roomAt(plan: Plan, p: Point) {
  return plan.rooms.findIndex((r) => within(p, r, -0.05));
}
/** The way from where the hunter is to room i: out of the room they're in, across the hall, through the doorway
 * (and in, when `inside`). The halls are rectangles, so straight lines between their spots stay in them. */
export function routeTo(plan: Plan, from: Point, i: number, inside: boolean): Point[] {
  const pts: Point[] = [];
  const cur = roomAt(plan, from);
  if (cur >= 0) {
    if (cur === i) return inside ? [plan.rooms[i].inside] : [plan.rooms[i].door, plan.rooms[i].front];
    pts.push(plan.rooms[cur].door, plan.rooms[cur].front);
  } else if (!plan.walks.some((w) => within(from, w))) pts.push(plan.entrance); // on the porch: in at the front door
  const r = plan.rooms[i];
  pts.push(r.front, r.door);
  if (inside) pts.push(r.inside);
  return pts;
}
/** Back out into the hall from wherever the hunter is. */
export function outTo(plan: Plan, from: Point): Point[] {
  const cur = roomAt(plan, from);
  return cur >= 0 ? [plan.rooms[cur].door, plan.rooms[cur].front] : [];
}

// ---- Building blocks ---------------------------------------------------------------------------------------------

const mats = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string) {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}
const EDGE = new THREE.LineBasicMaterial({ color: "#1A140E", transparent: true, opacity: 0.45 });
/** A box, outlined (the outlines make things read on a small screen). */
function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, edges = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), EDGE));
  return m;
}
function cyl(r: number, h: number, color: string, x: number, y: number, z: number, top = r, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(top, r, h, seg), mat(color));
  m.position.set(x, y, z);
  return m;
}
function ball(r: number, color: string, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat(color));
  m.position.set(x, y, z);
  return m;
}

/** A floor's pattern: boards, tiles or flags, drawn once per colour. */
const floorTex = new Map<string, THREE.CanvasTexture>();
function floorMaterial(color: string, pattern: "boards" | "tiles" | "flags", w: number, d: number) {
  const key = `${color}:${pattern}`;
  let tex = floorTex.get(key);
  if (!tex) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(0,0,0,0.22)";
    g.lineWidth = 2;
    if (pattern === "tiles") {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) {
        g.fillStyle = "rgba(0,0,0,0.10)";
        g.fillRect(i * 32, j * 32, 32, 32);
      }
      for (let i = 0; i <= 128; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
      }
    } else if (pattern === "boards") {
      for (let i = 0; i <= 128; i += 16) {
        g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
        const j = ((i / 16) % 2) * 64 + 20;
        g.beginPath(); g.moveTo(j, i); g.lineTo(j, i + 16); g.stroke();
      }
    } else {
      for (const [x, y, w, h] of [[0, 0, 60, 44], [60, 0, 68, 44], [0, 44, 40, 40], [40, 44, 50, 40], [90, 44, 38, 40], [0, 84, 70, 44], [70, 84, 58, 44]]) g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    floorTex.set(key, tex);
  }
  const map = tex.clone(); // the pattern at its real size (about 1.6 m a repeat), whatever the floor
  map.repeat.set(w / 1.6, d / 1.6);
  map.needsUpdate = true;
  return new THREE.MeshLambertMaterial({ map });
}

const FLOOR: Record<string, [string, "boards" | "tiles" | "flags"]> = {
  study: ["#9A6A44", "boards"], bedroom: ["#C49A74", "boards"], kitchen: ["#E2D8C6", "tiles"], library: ["#86593A", "boards"],
  cellar: ["#77706A", "flags"], parlour: ["#B07A50", "boards"], bathroom: ["#D6E6EA", "tiles"], chapel: ["#A89A88", "flags"],
  storeroom: ["#8A7D6E", "boards"], hall: ["#A87648", "boards"],
};
const WALL: Record<string, string> = {
  study: "#EADBB8", bedroom: "#EDCFC8", kitchen: "#F4EEDD", library: "#DCCAA4", cellar: "#9A938A", parlour: "#E7D4AC",
  bathroom: "#E6F2F4", chapel: "#ECE6DA", storeroom: "#C2B6A4", hall: "#F1E5C8",
};

// ---- Furniture (only furniture: the touchable things are made by makeObject) --------------------------------------
// In the room's own frame: the doorway at +z (front), the back wall at -z. The middle front stays clear (the hunter
// stands just inside the doorway) and so does the front left corner (the chest).

function furnish(kind: string, w: number, d: number) {
  const g = new THREE.Group();
  const hw = w / 2 - 0.35, hd = d / 2 - 0.35;
  const back = -hd, right = hw, left = -hw;
  const rug = (rw: number, rd: number, x: number, z: number, a: string, b: string) => g.add(box(rw, 0.03, rd, a, x, 0.02, z, false), box(rw - 0.3, 0.035, rd - 0.3, b, x, 0.025, z, false));
  const lamp = (x: number, z: number, y = 0) => g.add(cyl(0.05, 0.6, "#3A3A3A", x, y + 0.3, z), cyl(0.22, 0.26, "#F2D58A", x, y + 0.72, z, 0.12));
  const plant = (x: number, z: number) => g.add(cyl(0.22, 0.4, "#9C5A3A", x, 0.2, z, 0.26), ball(0.38, "#3E8A3E", x, 0.75, z), ball(0.26, "#4FA24A", x + 0.15, 1.0, z - 0.05));
  const chair = (x: number, z: number, c: string, turn = 0) => {
    const ch = new THREE.Group();
    ch.add(box(0.5, 0.08, 0.5, c, 0, 0.45, 0), box(0.5, 0.55, 0.08, c, 0, 0.75, -0.21));
    for (const [a, b] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) ch.add(box(0.06, 0.45, 0.06, c, a, 0.22, b, false));
    ch.position.set(x, 0, z);
    ch.rotation.y = turn;
    g.add(ch);
  };
  if (kind === "bedroom") {
    const bx = right - 0.95, bz = back + 1.15;
    g.add(box(1.8, 0.4, 2.2, "#6B4A2B", bx, 0.2, bz), box(1.7, 0.2, 2.1, "#F6F2EA", bx, 0.5, bz), box(1.72, 0.06, 1.3, "#3E6FB0", bx, 0.62, bz + 0.4), box(1.4, 0.16, 0.45, "#FFFFFF", bx, 0.68, bz - 0.75), box(1.8, 0.9, 0.12, "#5A3A20", bx, 0.45, back + 0.02));
    g.add(box(0.5, 0.55, 0.45, "#7A5230", bx - 1.25, 0.28, back + 0.3));
    lamp(bx - 1.25, back + 0.3, 0.55);
    g.add(box(1.2, 2.0, 0.6, "#6B4A2B", left + 0.75, 1.0, back + 0.3), box(0.02, 1.8, 0.02, "#2A1A0E", left + 0.75, 1.0, back + 0.61, false));
    rug(1.8, 1.2, 0.2, 0.1, "#8A3A4A", "#C86A7A");
  } else if (kind === "kitchen") {
    g.add(box(w - 1.6, 0.95, 0.65, "#A8774A", -0.4, 0.48, back + 0.32), box(w - 1.6, 0.06, 0.7, "#DCD6CA", -0.4, 0.98, back + 0.32));
    g.add(box(0.75, 0.1, 0.55, "#2E2E2E", -1.0, 1.04, back + 0.32), cyl(0.2, 0.22, "#8A8A8A", -1.15, 1.2, back + 0.32), cyl(0.16, 0.18, "#B4553A", -0.8, 1.18, back + 0.32));
    g.add(box(0.6, 0.06, 0.4, "#9FB8C0", 0.6, 1.02, back + 0.3, false));
    g.add(box(0.8, 1.9, 0.7, "#F2F2F2", right - 0.4, 0.95, back + 0.35), box(0.04, 0.5, 0.04, "#8A8A8A", right - 0.72, 1.3, back + 0.71, false));
    g.add(box(1.3, 0.08, 0.9, "#8A5A3A", right - 1.0, 0.8, 0.5));
    for (const [a, b] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) g.add(box(0.07, 0.76, 0.07, "#6B4A2B", right - 1.0 + a, 0.38, 0.5 + b, false));
    chair(right - 1.0, 1.25, "#7A5230", Math.PI);
    g.add(cyl(0.12, 0.18, "#E8C24A", right - 1.0, 0.93, 0.5));
  } else if (kind === "study") {
    g.add(box(1.8, 0.08, 0.85, "#6B4A2B", 0.3, 0.82, back + 0.6), box(0.5, 0.78, 0.8, "#5A3A20", -0.35, 0.39, back + 0.6), box(0.08, 0.78, 0.8, "#5A3A20", 1.12, 0.39, back + 0.6));
    g.add(box(0.5, 0.03, 0.35, "#F4F1EA", 0.4, 0.88, back + 0.55, false), box(0.4, 0.3, 0.05, "#2E2E2E", 0.9, 1.0, back + 0.4));
    lamp(-0.1, back + 0.4, 0.86);
    chair(0.3, back + 1.35, "#3A2A1A", Math.PI);
    g.add(box(1.2, 2.0, 0.4, "#5C3B22", left + 0.7, 1.0, back + 0.22));
    for (const [y, c] of [[0.5, "#2E5E8A"], [1.0, "#8A2E2E"], [1.5, "#2E6A4A"]] as const) g.add(box(1.0, 0.32, 0.04, c, left + 0.7, y, back + 0.43, false));
    g.add(cyl(0.05, 0.6, "#5A3A20", right - 0.5, 0.3, 0.2), ball(0.32, "#4A8AC0", right - 0.5, 0.9, 0.2));
    rug(1.6, 1.1, 0.3, 0.3, "#2E4A6A", "#5A7A9A");
  } else if (kind === "library") {
    const shelf = (x: number, z: number, turn = 0) => {
      const s = new THREE.Group();
      s.add(box(1.4, 2.3, 0.42, "#5C3B22", 0, 1.15, 0));
      for (const [y, c] of [[0.35, "#2E5E8A"], [0.8, "#8A2E2E"], [1.25, "#C8A045"], [1.7, "#2E6A4A"]] as const) s.add(box(1.2, 0.34, 0.04, c, 0, y, 0.22, false));
      s.position.set(x, 0, z);
      s.rotation.y = turn;
      g.add(s);
    };
    shelf(-1.5, back + 0.21);
    shelf(0, back + 0.21);
    shelf(1.5, back + 0.21);
    shelf(right - 0.21, 0.2, -Math.PI / 2);
    g.add(box(0.9, 0.45, 0.8, "#7A2E2E", -0.6, 0.23, 0.2), box(0.9, 0.6, 0.18, "#6A2626", -0.6, 0.6, -0.15));
    lamp(0.25, -0.1);
    rug(2.2, 1.4, -0.2, 0.3, "#5A2E2E", "#8A5A3A");
  } else if (kind === "cellar") {
    for (const [x, z] of [[-1.7, back + 0.45], [-0.85, back + 0.45], [0, back + 0.45]]) g.add(cyl(0.4, 0.95, "#7A4E2A", x, 0.48, z, 0.34), cyl(0.41, 0.06, "#3A3A3A", x, 0.25, z), cyl(0.41, 0.06, "#3A3A3A", x, 0.72, z));
    g.add(box(1.2, 1.6, 0.45, "#5C3B22", 1.4, 0.8, back + 0.25));
    for (const y of [0.4, 0.8, 1.2]) for (const x of [1.05, 1.4, 1.75]) g.add(cyl(0.08, 0.38, "#2E4A2E", x, y, back + 0.4).rotateX(Math.PI / 2));
    g.add(box(0.8, 0.6, 0.8, "#A8875A", right - 0.5, 0.3, 0.6), box(0.6, 0.45, 0.6, "#94744A", right - 0.55, 0.83, 0.6));
    g.add(cyl(0.12, 0.3, "#C8A45C", right - 0.5, 1.25, 0.6));
  } else if (kind === "parlour") {
    g.add(box(2.4, 0.5, 0.9, "#8A2E3A", -0.2, 0.25, back + 0.5), box(2.4, 0.65, 0.2, "#7A2632", -0.2, 0.75, back + 0.12), box(0.22, 0.65, 0.9, "#7A2632", -1.35, 0.42, back + 0.5), box(0.22, 0.65, 0.9, "#7A2632", 0.95, 0.42, back + 0.5));
    g.add(box(1.2, 0.35, 0.7, "#6B4A2B", -0.2, 0.2, back + 1.6));
    g.add(box(0.9, 0.45, 0.85, "#2E5E6A", right - 0.55, 0.23, 0.0), box(0.9, 0.55, 0.2, "#264E58", right - 0.55, 0.6, 0.35));
    g.add(box(0.5, 0.55, 0.5, "#6B4A2B", right - 0.5, 0.28, back + 0.35));
    lamp(right - 0.5, back + 0.35, 0.55);
    plant(left + 0.45, back + 0.45);
    rug(2.4, 1.6, -0.2, back + 1.55, "#8A5A2E", "#C89A5A");
  } else if (kind === "bathroom") {
    g.add(box(1.8, 0.6, 0.85, "#FFFFFF", left + 1.1, 0.3, back + 0.45), box(1.6, 0.05, 0.65, "#8FC4D8", left + 1.1, 0.6, back + 0.45, false));
    g.add(box(0.7, 0.85, 0.5, "#FFFFFF", right - 0.5, 0.43, back + 0.27), box(0.6, 0.8, 0.04, "#BFD3DA", right - 0.5, 1.5, back + 0.03));
    g.add(box(0.45, 0.45, 0.6, "#FFFFFF", right - 0.35, 0.23, 0.4), box(0.45, 0.4, 0.15, "#FFFFFF", right - 0.35, 0.6, 0.15));
    g.add(box(0.7, 0.03, 0.5, "#4A8AC0", 0.2, 0.02, 0.2, false));
  } else if (kind === "chapel") {
    g.add(box(1.8, 0.95, 0.7, "#F2EDE2", 0, 0.48, back + 0.4), box(1.9, 0.05, 0.75, "#B4553A", 0, 0.97, back + 0.4));
    for (const x of [-0.6, 0.6]) g.add(cyl(0.05, 0.4, "#F4E2B0", x, 1.2, back + 0.4), cyl(0.07, 0.02, "#F4B41A", x, 1.42, back + 0.4));
    g.add(box(0.1, 0.8, 0.1, "#C8A45C", 0, 1.4, back + 0.15), box(0.45, 0.1, 0.1, "#C8A45C", 0, 1.55, back + 0.15));
    for (const z of [back + 1.6, back + 2.5]) for (const x of [-1.2, 1.2]) g.add(box(1.6, 0.45, 0.45, "#6B4A2B", x, 0.23, z), box(1.6, 0.5, 0.08, "#5A3A20", x, 0.6, z + 0.2));
    g.add(box(0.9, 0.03, d - 1.2, "#8A2E2E", 0, 0.02, 0.2, false));
  } else if (kind === "storeroom") {
    g.add(box(w - 1.2, 1.9, 0.5, "#6B4A2B", 0.3, 0.95, back + 0.25, false));
    for (const y of [0.45, 1.05, 1.65]) g.add(box(w - 1.2, 0.05, 0.5, "#5A3A20", 0.3, y, back + 0.25));
    for (let i = 0; i < 5; i++) g.add(box(0.5, 0.4, 0.4, i % 2 ? "#B08A5A" : "#9A7648", -1.2 + i * 0.75, 0.68 + (i % 2) * 0.6, back + 0.3));
    for (const [x, z, y] of [[right - 0.5, 0.0, 0.3], [right - 0.5, 0.8, 0.3], [right - 0.5, 0.4, 0.9]]) g.add(box(0.75, 0.6, 0.75, "#A8875A", x, y, z));
    g.add(ball(0.32, "#D8C8A0", left + 0.5, 0.3, 0.6), ball(0.3, "#CDBD94", left + 0.6, 0.3, 1.1));
  }
  return g;
}

/** Where a room's touchable things go, in its own frame: along its back wall, then its left wall. */
function slotOf(j: number, w: number, d: number): { x: number; z: number; turn: number } {
  const back = -d / 2 + T;
  return [
    { x: -w / 2 + 1.0, z: back, turn: 0 },
    { x: w / 2 - 1.0, z: back, turn: 0 },
    { x: 0, z: back, turn: 0 },
    { x: -w / 2 + T, z: -0.4, turn: Math.PI / 2 },
  ][j];
}

/** A touchable thing: looks like ordinary furniture (owner: nothing glows). */
function makeObject(kind: string) {
  const g = new THREE.Group();
  switch (kind) {
    case "picture":
      g.add(box(0.95, 1.15, 0.06, "#6B4A2B", 0, 1.75, 0.05), box(0.75, 0.95, 0.02, "#C9B48A", 0, 1.75, 0.09, false), box(0.36, 0.42, 0.02, "#5A4A3A", 0, 1.82, 0.1, false));
      break;
    case "drawer":
      g.add(box(1.1, 0.95, 0.5, "#7A5230", 0, 0.48, 0.3));
      for (const y of [0.3, 0.6]) g.add(box(0.95, 0.24, 0.02, "#8A6240", 0, y, 0.56, false), box(0.12, 0.04, 0.03, "#C8A45C", 0, y, 0.58, false));
      break;
    case "clock": {
      g.add(box(0.55, 2.0, 0.4, "#5C3B22", 0, 1.0, 0.25), box(0.3, 0.5, 0.02, "#C8A45C", 0, 0.8, 0.46, false));
      const face = cyl(0.2, 0.04, "#F4F1EA", 0, 1.65, 0.46);
      face.rotation.x = Math.PI / 2;
      g.add(face);
      break;
    }
    case "rug":
      g.add(box(1.8, 0.03, 1.2, "#8A2E2E", 0, 0.02, 0.9, false), box(1.5, 0.035, 0.9, "#C8A45C", 0, 0.025, 0.9, false));
      break;
    case "bookcase":
      g.add(box(1.3, 2.1, 0.45, "#5C3B22", 0, 1.05, 0.25));
      for (const [y, c] of [[0.5, "#2E5E8A"], [1.0, "#7A2E2E"], [1.5, "#2E6A4A"]] as const) g.add(box(1.1, 0.35, 0.05, c, 0, y, 0.48, false));
      break;
    case "vase":
      g.add(box(0.6, 0.7, 0.45, "#6B4A2B", 0, 0.35, 0.3), cyl(0.15, 0.45, "#2E5E8A", 0, 0.93, 0.3, 0.08));
      break;
    case "mirror":
      g.add(box(0.75, 1.3, 0.06, "#C8A45C", 0, 1.5, 0.05), box(0.62, 1.15, 0.02, "#BFD3DA", 0, 1.5, 0.09, false));
      break;
    case "safe": {
      g.add(box(0.75, 0.8, 0.6, "#3A3F45", 0, 0.4, 0.35));
      const dial = cyl(0.09, 0.04, "#C8A45C", 0.12, 0.45, 0.66);
      dial.rotation.x = Math.PI / 2;
      g.add(dial);
      break;
    }
    case "desk":
      g.add(box(1.5, 0.08, 0.75, "#6B4A2B", 0, 0.82, 0.45), box(0.08, 0.78, 0.7, "#6B4A2B", -0.68, 0.39, 0.45), box(0.08, 0.78, 0.7, "#6B4A2B", 0.68, 0.39, 0.45), box(0.4, 0.04, 0.3, "#F4F1EA", 0.2, 0.88, 0.45, false));
      break;
    case "bed":
      g.add(box(1.5, 0.45, 2, "#6B4A2B", 0, 0.25, 1.05), box(1.4, 0.22, 1.9, "#E8E2D6", 0, 0.56, 1.05));
      break;
    case "wardrobe":
      g.add(box(1.2, 2.1, 0.6, "#6B4A2B", 0, 1.05, 0.32), box(0.02, 1.9, 0.02, "#3A2A1A", 0, 1.05, 0.63, false), box(0.05, 0.2, 0.04, "#C8A45C", 0.1, 1.1, 0.64, false));
      break;
    case "radio":
      g.add(box(0.6, 0.7, 0.45, "#6B4A2B", 0, 0.35, 0.3), box(0.5, 0.35, 0.25, "#7A5230", 0, 0.88, 0.3), cyl(0.08, 0.02, "#C8A45C", 0.12, 0.9, 0.43));
      break;
    default:
      g.add(box(0.7, 0.6, 0.5, "#7A5230", 0, 0.3, 0.3));
  }
  return g;
}

/** The key's chest, in the right room once you're in it. */
function makeChest() {
  const g = new THREE.Group();
  g.add(box(1.1, 0.55, 0.7, "#7A4A22", 0, 0.28, 0), box(1.14, 0.25, 0.74, "#8A5A2A", 0, 0.66, 0), box(1.16, 0.08, 0.1, "#C8A45C", 0, 0.42, 0.36, false), box(0.16, 0.2, 0.06, "#C8A45C", 0, 0.5, 0.38, false));
  return g;
}

/** A label floating over a room: its name. */
function label(text: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(20,24,34,0.85)";
  g.beginPath();
  g.roundRect(8, 16, 496, 96, 40);
  g.fill();
  g.fillStyle = "#F4F1EA";
  g.font = "800 60px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 66, 470);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 10;
  return s;
}

export type Built = {
  group: THREE.Group;
  plan: Plan;
  /** Meshes you can tap, each with userData { tap: "room" | "object" | "chest" | "out" | "hall", id }. */
  targets: THREE.Object3D[];
  /** Show or hide the chest in a room; open or shut a room's door. */
  setChest(room: string | null): void;
  setLocked(room: string, locked: boolean): void;
  /** A building's roof lifts off as the hunter goes in (and its walls drop to a low cutaway). */
  setOpen?(room: string, open: boolean): void;
  /** The treasure building's five rooms (null: none showing), each shut or opened with what it held. */
  setInner?(room: string | null, inner: InnerRoomView[] | null): void;
  /** Where to stand in each of a building's five rooms (world points, rooms 1 to 5). */
  innerSpots?(room: string): Point[];
  /** Each frame: roofs and walls moving to where they're going. */
  tick?(dt: number): void;
};
/** A room of the treasure building: shut, or opened with what it held. */
export type InnerRoomView = { n: number; open: boolean; outcome: "coins" | "chapter" | "key" | "decoy" | "trap" | null };

/** A straight wall from a to b (along x or z), its height, with doorways cut where asked. */
function wallRun(group: THREE.Group, a: Point, b: Point, height: number, color: string, trim: string, gaps: Point[], windows: boolean) {
  const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
  const lo = alongX ? Math.min(a.x, b.x) : Math.min(a.z, b.z);
  const hi = alongX ? Math.max(a.x, b.x) : Math.max(a.z, b.z);
  const fixed = alongX ? a.z : a.x;
  const cuts = gaps.map((g) => (alongX ? g.x : g.z)).filter((c) => c > lo && c < hi).sort((p, q) => p - q);
  const pieces: [number, number][] = [];
  let s = lo;
  for (const c of cuts) {
    pieces.push([s, c - 0.7]);
    s = c + 0.7;
  }
  pieces.push([s, hi]);
  for (const [p, q] of pieces) {
    const len = q - p;
    if (len <= 0.05) continue;
    const mid = (p + q) / 2;
    const [w, d, x, z] = alongX ? [len, T, mid, fixed] : [T, len, fixed, mid];
    group.add(box(w, height, d, color, x, height / 2, z));
    group.add(box(alongX ? len : T + 0.04, 0.08, alongX ? T + 0.04 : len, trim, x, height + 0.04, z, false));
    // Windows in the tall outside walls: a frame and a pale blue pane every few metres.
    if (windows && height > 2) {
      for (let k = p + 1.3; k < q - 1.0; k += 2.6) {
        const [fx, fz] = alongX ? [k, fixed + T / 2 + 0.01] : [fixed + T / 2 + 0.01, k];
        group.add(box(alongX ? 1.1 : 0.04, 0.9, alongX ? 0.04 : 1.1, "#F4F1EA", fx, 1.65, fz, false), box(alongX ? 0.95 : 0.05, 0.75, alongX ? 0.05 : 0.95, "#A8D4E6", fx, 1.65, fz, false));
      }
    }
  }
}

/** The whole house: halls, rooms, doorways, furniture, the touchable things, the garden round it. */
export function buildHouse(rooms: HouseRoomView[], objects: HouseObjectView[], style: HouseStyle = "cottage", title = "", layout?: string | null): Built {
  const look = STYLE[style] ?? STYLE.cottage;
  const plan = planHouse(rooms.length, layoutOf(title, layout));
  const { bounds: B } = plan;
  const group = new THREE.Group();
  const targets: THREE.Object3D[] = [];
  const tag = <O extends THREE.Object3D>(o: O, tap: string, id: string) => {
    o.traverse((c) => (c.userData = { tap, id }));
    targets.push(o);
    return o;
  };
  const bw = B.maxX - B.minX, bd = B.maxZ - B.minZ;

  // The garden, and a path up to the porch
  group.add(box(bw + 8, 0.1, bd + 8, look.ground, plan.centre.x, -0.06, plan.centre.z, false));
  const porch = plan.porch;
  group.add(tag(box(porch.w, 0.12, porch.d, "#B9AD9C", porch.x, 0.02, porch.z), "out", "porch"));
  const out = { x: plan.start.x + (plan.start.x - plan.entrance.x) * 0.6, z: plan.start.z + (plan.start.z - plan.entrance.z) * 0.6 };
  for (let k = 1; k <= 3; k++) group.add(box(0.9, 0.04, 0.6, look.path, plan.start.x + (out.x - plan.start.x) * k * 1.4, 0.0, plan.start.z + (out.z - plan.start.z) * k * 1.4, false));
  // Bushes and flowers round the outside (the same for the same house)
  let seed = rooms.length * 7 + title.length;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 14; k++) {
    const onX = k % 2 === 0;
    const x = onX ? B.minX + rnd() * bw : (k % 4 === 1 ? B.minX - 1.6 : B.maxX + 1.6);
    const z = onX ? (k % 4 === 0 ? B.minZ - 1.6 : B.maxZ + 1.8) : B.minZ + rnd() * bd;
    if (Math.hypot(x - plan.start.x, z - plan.start.z) < 2.4) continue;
    if (style === "cave" || style === "fort") {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + rnd() * 0.6, 0), mat(style === "cave" ? "#4A423A" : "#A88E62"));
      rock.position.set(x, 0.3, z);
      group.add(rock);
    } else {
      group.add(ball(0.45 + rnd() * 0.25, k % 3 ? "#3E7A3A" : "#4E8E44", x, 0.35, z));
      if (k % 3 === 0) group.add(ball(0.12, ["#E85A5A", "#F4D35E", "#E890C8"][k % 3 === 0 ? (k / 3) % 3 : 0], x + 0.3, 0.75, z + 0.2));
    }
  }
  // Something outside that says what kind of place this is
  if (style === "keeper") {
    const lx = B.minX + 1.2, lz = B.minZ - 2.4;
    for (let i = 0; i < 4; i++) group.add(cyl(0.9 - i * 0.08, 1.1, i % 2 ? look.trim : "#F4F1EA", lx, 0.55 + i * 1.1, lz, 0.82 - i * 0.08));
    group.add(cyl(0.5, 0.7, "#F4D35E", lx, 4.8, lz), cyl(0.6, 0.3, "#2B2B2B", lx, 5.3, lz, 0.1));
  } else if (style === "fort") {
    for (const x of [B.minX - 0.4, B.maxX + 0.4]) group.add(box(1.3, 3.4, 1.3, look.back, x, 1.7, B.minZ - 0.4), box(1.5, 0.3, 1.5, look.trim, x, 3.5, B.minZ - 0.4));
  } else if (style === "cave") {
    for (const [x, z, r] of [[B.minX - 1.8, B.minZ - 1.2, 2.0], [B.maxX + 1.2, B.minZ - 1.6, 1.6], [B.minX - 2.0, B.maxZ - 2, 1.2]] as const) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat("#4E463E"));
      rock.position.set(x, r * 0.6, z);
      group.add(rock);
    }
  } else if (style === "manor") {
    for (const dx of [-1.6, 1.6]) group.add(cyl(0.45, 1.0, "#2F5E2A", plan.start.x + dx, 0.5, plan.start.z + 0.6, 0.05));
  } else if (style === "stone") {
    group.add(box(1.6, 1.2, 1.6, "#8E8C86", B.maxX + 1.6, 0.6, B.minZ + 1.2), cyl(0.5, 0.3, "#5A7A9A", B.maxX + 1.6, 1.25, B.minZ + 1.2));
  }

  // The halls
  for (const w of plan.walks) {
    const [color, pattern] = plan.layout === "court" ? ["#C9B99A", "flags" as const] : FLOOR.hall;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w.w, 0.12, w.d), floorMaterial(color, pattern, w.w, w.d));
    floor.position.set(w.x, 0.04, w.z);
    group.add(tag(floor, "hall", "hall"));
    if (plan.layout === "court") {
      // Planters in the courtyard's corners (out of the way of the paths between doorways)
      for (const [sx, sz] of [[-1, -1], [1, -1]] as const) {
        const px = w.x + sx * (w.w / 2 - 0.5), pz = w.z + sz * (w.d / 2 - 0.5);
        group.add(box(0.7, 0.4, 0.7, "#9C5A3A", px, 0.2, pz), ball(0.42, "#3E8A3E", px, 0.7, pz));
      }
    }
  }

  // The walls: tall on the outside at the back and the left (the far sides from the camera), low everywhere else.
  // Each wall line is built once (rooms side by side share theirs), with doorways cut into it.
  const doorsOn = (a: Point, b: Point) => plan.rooms.map((r) => r.door).filter((p) => (Math.abs(a.x - b.x) < 0.01 ? Math.abs(p.x - a.x) < 0.01 : Math.abs(p.z - a.z) < 0.01));
  const done = new Set<string>();
  const run = (a: Point, b: Point, color: string) => {
    const k = [a.x, a.z, b.x, b.z].map((v) => v.toFixed(2)).join(",");
    const k2 = [b.x, b.z, a.x, a.z].map((v) => v.toFixed(2)).join(",");
    if (done.has(k) || done.has(k2)) return;
    done.add(k);
    const outside = (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.x - B.minX) < 0.01) || (Math.abs(a.z - b.z) < 0.01 && Math.abs(a.z - B.minZ) < 0.01);
    wallRun(group, a, b, outside ? WALL_HIGH : WALL_LOW, outside ? look.back : color, look.trim, doorsOn(a, b), outside);
  };

  const doors = new Map<string, THREE.Object3D>();
  const chests = new Map<string, THREE.Object3D>();
  rooms.forEach((r, i) => {
    const p = plan.rooms[i];
    const kind = FLOOR[r.kind] ? r.kind : "study";
    const [fc, fp] = FLOOR[kind];
    const floor = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.12, p.d), floorMaterial(look.floor ?? fc, fp, p.w, p.d));
    floor.position.set(p.x, 0.04, p.z);
    group.add(tag(floor, "room", r.id));
    const wall = look.wall ?? WALL[kind];
    const [x0, x1, z0, z1] = [p.x - p.w / 2, p.x + p.w / 2, p.z - p.d / 2, p.z + p.d / 2];
    run({ x: x0, z: z0 }, { x: x1, z: z0 }, wall);
    run({ x: x0, z: z1 }, { x: x1, z: z1 }, wall);
    run({ x: x0, z: z0 }, { x: x0, z: z1 }, wall);
    run({ x: x1, z: z0 }, { x: x1, z: z1 }, wall);

    // The room's own frame: facing its doorway
    const frame = new THREE.Group();
    frame.position.set(p.x, 0.1, p.z);
    frame.rotation.y = p.facing;
    group.add(frame);
    const turned = Math.abs(Math.sin(p.facing)) > 0.5;
    const [lw, ld] = turned ? [p.d, p.w] : [p.w, p.d];
    frame.add(furnish(kind, lw, ld));
    objects
      .filter((o) => o.room === r.id)
      .slice(0, 4)
      .forEach((o, j) => {
        const s = slotOf(j, lw, ld);
        const m = tag(makeObject(o.kind), "object", o.id);
        m.position.set(s.x, 0, s.z);
        m.rotation.y = s.turn;
        frame.add(m);
      });
    const chest = tag(makeChest(), "chest", r.id);
    chest.position.set(-1.3, 0, ld / 2 - 0.85); // by the front wall, beside the doorway, in plain view
    chest.visible = r.chest === true;
    frame.add(chest);
    chests.set(r.id, chest);

    // A shut door (a room you need something to open)
    const door = tag(box(1.25, 2.0, 0.12, "#6B3E22", 0, 1.0, ld / 2), "room", r.id);
    door.add(box(0.1, 0.1, 0.06, "#C8A45C", 0.42, 0, 0.08, false));
    door.visible = r.locked === true;
    frame.add(door);
    doors.set(r.id, door);

    const name = label(r.name);
    name.position.set(p.x, 3.2, p.z);
    group.add(name);
  });

  // The outside of the halls where no room closes them in (the gallery's far end, a courtyard's open side and front)
  for (const w of plan.walks) {
    const [x0, x1, z0, z1] = [w.x - w.w / 2, w.x + w.w / 2, w.z - w.d / 2, w.z + w.d / 2];
    const covered = (a: Point, b: Point) => {
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      return plan.rooms.some((r) => within({ x: mid.x + (Math.abs(a.x - b.x) < 0.01 ? Math.sign(mid.x - w.x) * 0.3 : 0), z: mid.z + (Math.abs(a.z - b.z) < 0.01 ? Math.sign(mid.z - w.z) * 0.3 : 0) }, r));
    };
    const entranceGap = { x: (plan.start.x + plan.entrance.x) / 2, z: (plan.start.z + plan.entrance.z) / 2 }; // the front door
    for (const [a, b] of [[{ x: x0, z: z0 }, { x: x1, z: z0 }], [{ x: x0, z: z1 }, { x: x1, z: z1 }], [{ x: x0, z: z0 }, { x: x0, z: z1 }], [{ x: x1, z: z0 }, { x: x1, z: z1 }]] as [Point, Point][]) {
      if (covered(a, b)) continue;
      const k = [a.x, a.z, b.x, b.z].map((v) => v.toFixed(2)).join(",");
      if (done.has(k)) continue;
      done.add(k);
      const outside = (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.x - B.minX) < 0.01) || (Math.abs(a.z - b.z) < 0.01 && Math.abs(a.z - B.minZ) < 0.01);
      const gaps = [...doorsOn(a, b), entranceGap].filter((g) => (Math.abs(a.x - b.x) < 0.01 ? Math.abs(g.x - a.x) < 0.9 : Math.abs(g.z - a.z) < 0.9));
      wallRun(group, a, b, outside ? WALL_HIGH : WALL_LOW, look.back, look.trim, gaps, outside);
    }
  }

  return {
    group,
    plan,
    targets,
    setChest(room) {
      for (const [id, c] of chests) c.visible = id === room;
    },
    setLocked(room, locked) {
      const d = doors.get(room);
      if (d) d.visible = locked;
    },
  };
}

export { box, cyl, ball, mat, floorMaterial, makeObject, makeChest, label, FLOOR, STYLE };

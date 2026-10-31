/**
 * The house at a story key (owner, 31 Oct 2026: "a scene, like an open house, like sims"): a cutaway house seen from
 * above at an angle, rooms either side of a hall, the walls cut low so you see in. Built in code from simple shapes,
 * like the rest of the game's models. Nothing in it glows: what can be touched looks like everything else.
 * Units are metres; the front door is at +z, the hall runs back along −z.
 */
import * as THREE from "three";

export type HouseRoomView = { id: string; name: string; kind: string; locked: boolean; chest: boolean };
export type HouseObjectView = { id: string; room: string; kind: string; label: string };

export const ROOM_W = 5.2;
export const ROOM_D = 4.6;
export const HALL_W = 2.6;
const PORCH = 1.4;
const WALL_LOW = 0.9;
const WALL_HIGH = 2.7;
const T = 0.18;

const mats = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string) {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}
function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}
function cyl(r: number, h: number, color: string, x: number, y: number, z: number, top = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(top, r, h, 14), mat(color));
  m.position.set(x, y, z);
  return m;
}

/** Where a room sits: left of the hall for even places, right for odd, rows going back from the door. */
export function roomPlace(i: number) {
  const side = i % 2 === 0 ? -1 : 1;
  const row = Math.floor(i / 2);
  return { side, row, x: side * (HALL_W / 2 + ROOM_W / 2), z: -(row * ROOM_D + ROOM_D / 2) };
}
/** The doorway from the hall into a room (on the hall side of the room). */
export function doorOf(i: number) {
  const p = roomPlace(i);
  return { x: p.side * (HALL_W / 2), z: p.z };
}
export function houseSize(rooms: number) {
  const rows = Math.ceil(rooms / 2);
  return { width: HALL_W + ROOM_W * 2, depth: rows * ROOM_D, rows };
}

const FLOOR: Record<string, string> = {
  study: "#8A5A3A", bedroom: "#B98B6A", kitchen: "#D8CFC0", library: "#7A4E33", cellar: "#5C5650", parlour: "#A8714C",
  bathroom: "#CFE0E4", chapel: "#9C8E7E", storeroom: "#7B6F62", hall: "#9B6B45",
};
const WALL: Record<string, string> = {
  study: "#E8D9B5", bedroom: "#E9C9C2", kitchen: "#F2EBD9", library: "#D9C7A0", cellar: "#8D877E", parlour: "#E3D0A8",
  bathroom: "#E4F0F2", chapel: "#E8E2D6", storeroom: "#B9AD9C", hall: "#EFE2C4",
};

/** Furniture that's only furniture (the room's look); touchable objects are made by makeObject. */
function furnish(kind: string) {
  const g = new THREE.Group();
  const hw = ROOM_W / 2 - 0.5;
  const hd = ROOM_D / 2 - 0.5;
  if (kind === "bedroom") {
    g.add(box(1.7, 0.45, 2.1, "#6B4A2B", -hw + 1, 0.25, -hd + 1.1), box(1.6, 0.25, 2, "#F4F1EA", -hw + 1, 0.58, -hd + 1.1), box(1.4, 0.18, 0.5, "#FFFFFF", -hw + 1, 0.78, -hd + 0.35));
    g.add(box(1.6, 0.04, 1.1, "#7A3A4A", 0.6, 0.03, 0.6));
  } else if (kind === "kitchen") {
    g.add(box(ROOM_W - 1, 0.95, 0.65, "#9C6B3F", 0, 0.48, -hd), box(0.8, 0.1, 0.6, "#333333", -1.2, 1.0, -hd), cyl(0.18, 0.2, "#555555", -1.2, 1.15, -hd));
    g.add(box(1.4, 0.08, 0.9, "#8A5A3A", 0.4, 0.82, 0.5), box(0.08, 0.78, 0.08, "#8A5A3A", -0.25, 0.39, 0.1), box(0.08, 0.78, 0.08, "#8A5A3A", 1.05, 0.39, 0.9));
  } else if (kind === "study") {
    g.add(box(0.5, 0.9, 0.5, "#6B4A2B", hw - 0.2, 0.45, hd - 0.4));
  } else if (kind === "library") {
    for (const x of [-1.6, 1.6]) g.add(box(1.5, 2.2, 0.45, "#5C3B22", x, 1.1, -hd), box(1.3, 1.9, 0.05, "#B5452B", x, 1.1, -hd + 0.24));
    g.add(box(0.9, 0.5, 0.9, "#7A3A2A", 0, 0.25, 0.6));
  } else if (kind === "cellar") {
    for (const [x, z] of [[-hw + 0.5, -hd + 0.4], [-hw + 1.3, -hd + 0.4], [hw - 0.5, 0.4]]) g.add(cyl(0.38, 0.9, "#6B4A2B", x, 0.45, z, 0.32));
    g.add(box(0.8, 0.6, 0.8, "#9C7A4F", hw - 0.6, 0.3, -hd + 0.5), box(0.6, 0.45, 0.6, "#8A6A42", hw - 0.7, 0.82, -hd + 0.5));
  } else if (kind === "parlour") {
    g.add(box(2.2, 0.55, 0.85, "#7A2E3A", 0, 0.3, -hd + 0.5), box(2.2, 0.6, 0.2, "#6A2632", 0, 0.75, -hd + 0.15), box(1.1, 0.4, 0.6, "#6B4A2B", 0, 0.2, 0.3));
    g.add(box(1.3, 0.9, 0.6, "#1E1E22", hw - 0.7, 0.45, hd - 0.6));
  } else if (kind === "bathroom") {
    g.add(box(1.7, 0.6, 0.8, "#FFFFFF", -hw + 0.9, 0.3, -hd + 0.4), box(0.6, 0.9, 0.45, "#FFFFFF", hw - 0.4, 0.45, -hd + 0.3));
  } else if (kind === "chapel") {
    for (const z of [0.2, 1.2]) g.add(box(2.6, 0.45, 0.45, "#6B4A2B", 0, 0.23, z));
    g.add(box(1.4, 0.95, 0.6, "#E8E2D6", 0, 0.48, -hd + 0.2), cyl(0.05, 0.5, "#F4B41A", 0.4, 1.2, -hd + 0.2));
  } else if (kind === "storeroom") {
    for (let i = 0; i < 4; i++) g.add(box(0.7, 0.6, 0.7, i % 2 ? "#9C7A4F" : "#8A6A42", -hw + 0.6 + i * 0.85, 0.3, -hd + 0.4));
    g.add(box(2.4, 0.08, 0.5, "#6B4A2B", 0.8, 1.3, hd - 0.2));
  }
  return g;
}

/** Where a room's touchable things go: along its back wall first, then its far side. */
const SLOTS: { x: number; z: number; wall: "back" | "side" }[] = [
  { x: 0, z: -ROOM_D / 2 + T, wall: "back" },
  { x: -1.6, z: -ROOM_D / 2 + T, wall: "back" },
  { x: 1.6, z: -ROOM_D / 2 + T, wall: "back" },
  { x: 0, z: 0.6, wall: "side" },
];

/** A touchable thing: looks like ordinary furniture (owner: nothing glows). */
function makeObject(kind: string) {
  const g = new THREE.Group();
  switch (kind) {
    case "picture":
      g.add(box(0.95, 1.15, 0.06, "#6B4A2B", 0, 1.75, 0.05), box(0.75, 0.95, 0.02, "#B9A27A", 0, 1.75, 0.09), box(0.36, 0.42, 0.02, "#5A4A3A", 0, 1.82, 0.1));
      break;
    case "drawer":
      g.add(box(1.1, 0.95, 0.5, "#7A5230", 0, 0.48, 0.3));
      for (const y of [0.3, 0.6]) g.add(box(0.95, 0.24, 0.02, "#8A6240", 0, y, 0.56), box(0.12, 0.04, 0.03, "#C8A45C", 0, y, 0.58));
      break;
    case "clock":
      g.add(box(0.55, 2.0, 0.4, "#5C3B22", 0, 1.0, 0.25), cyl(0.2, 0.04, "#F4F1EA", 0, 1.65, 0.46), box(0.3, 0.5, 0.02, "#C8A45C", 0, 0.8, 0.46));
      g.children[1].rotation.x = Math.PI / 2;
      break;
    case "rug":
      g.add(box(1.8, 0.03, 1.2, "#8A2E2E", 0, 0.02, 0.9), box(1.5, 0.035, 0.9, "#C8A45C", 0, 0.025, 0.9));
      break;
    case "bookcase":
      g.add(box(1.3, 2.1, 0.45, "#5C3B22", 0, 1.05, 0.25));
      for (const [y, c] of [[0.5, "#2E5E8A"], [1.0, "#7A2E2E"], [1.5, "#2E6A4A"]] as const) g.add(box(1.1, 0.35, 0.05, c, 0, y, 0.48));
      break;
    case "vase":
      g.add(box(0.6, 0.7, 0.45, "#6B4A2B", 0, 0.35, 0.3), cyl(0.15, 0.45, "#2E5E8A", 0, 0.93, 0.3, 0.08));
      break;
    case "mirror":
      g.add(box(0.75, 1.3, 0.06, "#C8A45C", 0, 1.5, 0.05), box(0.62, 1.15, 0.02, "#BFD3DA", 0, 1.5, 0.09));
      break;
    case "safe":
      g.add(box(0.75, 0.8, 0.6, "#3A3F45", 0, 0.4, 0.35), cyl(0.09, 0.04, "#C8A45C", 0.12, 0.45, 0.66));
      g.children[1].rotation.x = Math.PI / 2;
      break;
    case "desk":
      g.add(box(1.5, 0.08, 0.75, "#6B4A2B", 0, 0.82, 0.45), box(0.08, 0.78, 0.7, "#6B4A2B", -0.68, 0.39, 0.45), box(0.08, 0.78, 0.7, "#6B4A2B", 0.68, 0.39, 0.45), box(0.4, 0.04, 0.3, "#F4F1EA", 0.2, 0.88, 0.45));
      break;
    case "bed":
      g.add(box(1.5, 0.45, 2, "#6B4A2B", 0, 0.25, 1.05), box(1.4, 0.22, 1.9, "#E8E2D6", 0, 0.56, 1.05));
      break;
    case "wardrobe":
      g.add(box(1.2, 2.1, 0.6, "#6B4A2B", 0, 1.05, 0.32), box(0.02, 1.9, 0.02, "#3A2A1A", 0, 1.05, 0.63), box(0.05, 0.2, 0.04, "#C8A45C", 0.1, 1.1, 0.64));
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
  g.add(box(1.1, 0.55, 0.7, "#7A4A22", 0, 0.28, 0), box(1.14, 0.25, 0.74, "#8A5A2A", 0, 0.66, 0), box(1.16, 0.08, 0.1, "#C8A45C", 0, 0.42, 0.36), box(0.16, 0.2, 0.06, "#C8A45C", 0, 0.5, 0.38));
  return g;
}

/** A label floating over a room: its name. */
function label(text: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(20,24,34,0.82)";
  g.beginPath();
  g.roundRect(8, 16, 496, 96, 40);
  g.fill();
  g.fillStyle = "#F4F1EA";
  g.font = "800 56px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(2.4, 0.6, 1);
  s.renderOrder = 10;
  return s;
}

export type Built = {
  group: THREE.Group;
  /** Meshes you can tap, each with userData { tap: "room" | "object" | "chest" | "out", id }. */
  targets: THREE.Object3D[];
  /** Show or hide the chest in a room; open or shut a room's door. */
  setChest(room: string | null): void;
  setLocked(room: string, locked: boolean): void;
};

/** The whole house: hall, rooms, doors, furniture, the touchable things. */
export function buildHouse(rooms: HouseRoomView[], objects: HouseObjectView[]): Built {
  const group = new THREE.Group();
  const targets: THREE.Object3D[] = [];
  const { width, depth } = houseSize(rooms.length);
  const tag = <O extends THREE.Object3D>(o: O, tap: string, id: string) => {
    o.traverse((c) => (c.userData = { tap, id }));
    targets.push(o);
    return o;
  };

  // The garden, the porch and the hall
  group.add(box(width + 6, 0.1, depth + PORCH + 6, "#5E8C4A", 0, -0.06, -depth / 2 + PORCH / 2));
  group.add(tag(box(HALL_W, 0.12, PORCH, "#B9AD9C", 0, 0.02, PORCH / 2), "out", "porch"));
  group.add(tag(box(HALL_W, 0.12, depth, FLOOR.hall, 0, 0.04, -depth / 2), "hall", "hall"));
  // The back wall, full height (the camera looks in from the front)
  group.add(box(width + T, WALL_HIGH, T, "#D9C9A6", 0, WALL_HIGH / 2, -depth - T / 2));

  const doors = new Map<string, THREE.Object3D>();
  const chests = new Map<string, THREE.Object3D>();
  rooms.forEach((r, i) => {
    const p = roomPlace(i);
    const kind = FLOOR[r.kind] ? r.kind : "study";
    const floor = tag(box(ROOM_W, 0.12, ROOM_D, FLOOR[kind], p.x, 0.04, p.z), "room", r.id);
    group.add(floor);
    const wall = WALL[kind];
    const outer = p.x + p.side * (ROOM_W / 2);
    // Outer side wall (full height on the left, the far side from the camera; low on the right)
    const outerH = p.side < 0 ? WALL_HIGH : WALL_LOW;
    group.add(box(T, outerH, ROOM_D, wall, outer, outerH / 2, p.z));
    // Front wall (low), and the wall shared with the next row back (low)
    group.add(box(ROOM_W, WALL_LOW, T, wall, p.x, WALL_LOW / 2, p.z + ROOM_D / 2));
    // The hall-side wall, with a doorway in the middle
    const seg = (ROOM_D - 1.3) / 2;
    const hx = p.side * (HALL_W / 2);
    group.add(box(T, WALL_LOW, seg, wall, hx, WALL_LOW / 2, p.z + ROOM_D / 2 - seg / 2), box(T, WALL_LOW, seg, wall, hx, WALL_LOW / 2, p.z - ROOM_D / 2 + seg / 2));
    const door = tag(box(0.12, 2.0, 1.25, "#6B3E22", hx, 1.0, p.z), "room", r.id);
    door.add(box(0.06, 0.1, 0.1, "#C8A45C", p.side * -0.08, 0, 0.42));
    door.visible = r.locked === true;
    group.add(door);
    doors.set(r.id, door);
    // Furniture, and the touchable things along the back wall
    const f = furnish(kind);
    f.position.set(p.x, 0.1, p.z);
    group.add(f);
    objects
      .filter((o) => o.room === r.id)
      .slice(0, SLOTS.length)
      .forEach((o, j) => {
        const slot = SLOTS[j];
        const m = tag(makeObject(o.kind), "object", o.id);
        if (slot.wall === "back") m.position.set(p.x + slot.x, 0.1, p.z + slot.z);
        else {
          m.position.set(p.x - p.side * (ROOM_W / 2 - T), 0.1, p.z + slot.z);
          m.rotation.y = p.side * (Math.PI / 2);
        }
        group.add(m);
      });
    const chest = tag(makeChest(), "chest", r.id);
    chest.position.set(p.x + p.side * 0.6, 0.1, p.z + 0.3);
    chest.visible = r.chest === true;
    group.add(chest);
    chests.set(r.id, chest);
    const name = label(r.name);
    name.position.set(p.x, 3.1, p.z);
    group.add(name);
  });
  return {
    group,
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

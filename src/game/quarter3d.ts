/**
 * The key's quarter (owner, 1 Nov 2026: "we create our own open street, which is still inside the key location… where
 * user can walk freely on their own to figure where the treasure is actually buried"; it replaces the house at every
 * key). A few plots along a street, round a square or either side of a lane: a food stall, a cottage, a well, a café,
 * a fountain, a shrine, a yard… each with a floating sign. The hunter walks about freely and digs where they think the
 * key is buried. The story's house is the quarter: its rooms are the plots (the same ids, names, roles and things).
 * Units are metres; the camera looks in from +x, +z.
 */
import * as THREE from "three";
import { ball, box, cyl, floorMaterial, label, layoutOf, makeChest, makeObject, mat, planHouse, STYLE, type Built, type HouseObjectView, type HouseRoomView, type HouseStyle, type PlanSize } from "./house3d";

/** Plots are bigger than rooms, and the street wider than a hall. */
export const QUARTER_SIZE: PlanSize = { w: 7, d: 6.4, hall: 4.4, court: 9, step: 1.8 };

/** What stands on each kind of plot (the story's room kinds), its sign and its ground. */
const PLOT: Record<string, { icon: string; ground: string; pattern: "boards" | "tiles" | "flags" }> = {
  kitchen: { icon: "🍲", ground: "#D9C7A0", pattern: "tiles" },
  bedroom: { icon: "🏠", ground: "#7FB069", pattern: "flags" },
  library: { icon: "📚", ground: "#C9B99A", pattern: "boards" },
  cellar: { icon: "🪣", ground: "#9C9488", pattern: "flags" },
  parlour: { icon: "☕", ground: "#D6B48A", pattern: "boards" },
  bathroom: { icon: "⛲", ground: "#C8D8DC", pattern: "tiles" },
  chapel: { icon: "🕯️", ground: "#BFB3A2", pattern: "flags" },
  storeroom: { icon: "📦", ground: "#A8957A", pattern: "boards" },
  study: { icon: "📜", ground: "#8FB37A", pattern: "flags" },
};

/** A round floating sign with an icon (drawn once per icon). */
const signs = new Map<string, THREE.CanvasTexture>();
function sign(icon: string) {
  let tex = signs.get(icon);
  if (!tex) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#FFFFFF";
    g.beginPath();
    g.arc(64, 60, 52, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(20,24,34,0.25)";
    g.lineWidth = 6;
    g.stroke();
    g.beginPath(); // the little point under the bubble
    g.moveTo(52, 106);
    g.lineTo(64, 124);
    g.lineTo(76, 106);
    g.fill();
    g.font = "64px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(icon, 64, 64);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    signs.set(icon, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(1.5, 1.5, 1);
  s.renderOrder = 11;
  return s;
}

/** A pitched roof over a box (w along x, d along z), its ridge along x. */
function roof(w: number, d: number, color: string, y: number) {
  const g = new THREE.Group();
  const slope = Math.hypot(d / 2, 0.9);
  for (const side of [-1, 1]) {
    const m = box(w + 0.3, 0.12, slope + 0.2, color, 0, y + 0.45, (side * d) / 4);
    m.rotation.x = side * Math.atan2(0.9, d / 2);
    g.add(m);
  }
  return g;
}

/** What stands on a plot, in the plot's own frame (its gate at +z, the back at −z): kept to the back and sides, so
 * the middle stays clear for the hunter and for digging. */
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
  } else if (kind === "bedroom") {
    // A cottage, its door on the street side
    const cw = Math.min(4.2, w - 1.6), cd = 2.6;
    g.add(box(cw, 2.0, cd, "#F1E2C4", 0, 1.0, back + 0.5));
    const r = roof(cw, cd, accent, 2.0);
    r.position.z = back + 0.5;
    g.add(r);
    g.add(box(0.8, 1.4, 0.06, "#6B3E22", 0, 0.7, back + 0.5 + cd / 2 + 0.02), box(0.7, 0.6, 0.05, "#A8D4E6", -1.2, 1.2, back + 0.5 + cd / 2 + 0.02, false), box(0.7, 0.6, 0.05, "#A8D4E6", 1.2, 1.2, back + 0.5 + cd / 2 + 0.02, false));
    plant(w / 2 - 0.7, back + 2.6);
  } else if (kind === "library") {
    // A book stall: shelves of coloured books under an awning
    for (const x of [-1.3, 0, 1.3]) {
      g.add(box(1.2, 1.8, 0.5, "#5C3B22", x, 0.9, back));
      for (const [y, c] of [[0.4, "#2E5E8A"], [0.85, "#8A2E2E"], [1.3, "#C8A045"]] as const) g.add(box(1.0, 0.34, 0.04, c, x, y, back + 0.27, false));
    }
    g.add(box(4.2, 0.1, 1.4, accent, 0, 2.1, back + 0.4));
    g.add(box(1.6, 0.8, 0.8, "#7A5230", 0.4, 0.4, back + 1.6), box(0.6, 0.06, 0.4, "#F4F1EA", 0.3, 0.83, back + 1.6, false));
  } else if (kind === "cellar") {
    // A well, and barrels
    g.add(cyl(0.9, 0.8, "#8E887D", 0, 0.4, back + 0.7), cyl(0.7, 0.05, "#2E5E8A", 0, 0.78, back + 0.7));
    for (const x of [-0.8, 0.8]) g.add(cyl(0.07, 1.6, "#5A3A20", x, 1.4, back + 0.7));
    g.add(box(2.0, 0.1, 1.2, accent, 0, 2.25, back + 0.7), cyl(0.06, 1.8, "#5A3A20", 0, 1.6, back + 0.7).rotateZ(Math.PI / 2));
    for (const [x, z] of [[w / 2 - 1.0, back], [w / 2 - 1.0, back + 1.0], [-w / 2 + 1.0, back + 0.2]]) g.add(cyl(0.42, 0.95, "#7A4E2A", x, 0.48, z, 0.36), cyl(0.43, 0.06, "#3A3A3A", x, 0.3, z));
  } else if (kind === "parlour") {
    // A café terrace: round tables, umbrellas, chairs
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
    const r = roof(2.6, 2.0, accent, 2.2);
    r.position.z = back + 0.5;
    g.add(r);
    g.add(box(1.0, 0.8, 0.6, "#F2EDE2", 0, 0.4, back + 0.4));
    for (const x of [-0.3, 0, 0.3]) g.add(cyl(0.04, 0.25, "#F4E2B0", x, 0.93, back + 0.4), ball(0.05, "#F4B41A", x, 1.1, back + 0.4));
  } else if (kind === "storeroom") {
    // A yard: crates, a tarp, a hand cart
    for (const [x, z, y] of [[-1.8, back, 0.35], [-1.0, back, 0.35], [-1.4, back, 1.05], [1.6, back + 0.2, 0.35]]) g.add(box(0.75, 0.7, 0.75, "#B08A5A", x, y, z));
    g.add(box(1.6, 0.9, 1.0, accent, 0.4, 0.45, back + 0.1));
    g.add(box(1.2, 0.1, 0.8, "#7A5230", w / 2 - 1.2, 0.6, back + 1.6), cyl(0.3, 0.08, "#3A3A3A", w / 2 - 1.2, 0.3, back + 1.2).rotateX(Math.PI / 2), cyl(0.3, 0.08, "#3A3A3A", w / 2 - 1.2, 0.3, back + 2.0).rotateX(Math.PI / 2));
  } else {
    // A garden with a notice board under a tree
    g.add(box(1.6, 1.1, 0.1, "#6B4A2B", -0.8, 1.2, back), box(1.4, 0.9, 0.04, "#F4F1EA", -0.8, 1.2, back + 0.07, false));
    for (const x of [-1.5, -0.1]) g.add(box(0.1, 0.9, 0.1, "#6B4A2B", x, 0.45, back));
    tree(w / 2 - 1.2, back);
  }
  return g;
}

/** The whole quarter: its street(s), plots with their gates and signs, the touchable things, the land round it. */
export function buildQuarter(rooms: HouseRoomView[], objects: HouseObjectView[], style: HouseStyle = "cottage", title = "", layout?: string | null): Built {
  const look = STYLE[style] ?? STYLE.cottage;
  const plan = planHouse(rooms.length, layoutOf(title, layout), QUARTER_SIZE);
  const { bounds: B } = plan;
  const group = new THREE.Group();
  const targets: THREE.Object3D[] = [];
  const tag = <O extends THREE.Object3D>(o: O, tap: string, id: string) => {
    o.traverse((c) => (c.userData = { tap, id }));
    targets.push(o);
    return o;
  };
  const bw = B.maxX - B.minX, bd = B.maxZ - B.minZ;
  const accents = [look.trim, "#2F6FEB", "#E5484D", "#1E9E62", "#F4B41A", "#9B5DE5", "#F28C28"];

  // The land round it
  group.add(box(bw + 16, 0.1, bd + 16, look.ground, plan.centre.x, -0.08, plan.centre.z, false));
  // The street(s): paved, with kerbs, a dashed line down a lane, lamps along it
  for (const wk of plan.walks) {
    const street = new THREE.Mesh(new THREE.BoxGeometry(wk.w, 0.1, wk.d), floorMaterial(plan.layout === "court" ? "#CDBFA6" : "#8E9096", plan.layout === "court" ? "flags" : "tiles", wk.w, wk.d));
    street.position.set(wk.x, 0.0, wk.z);
    group.add(tag(street, "hall", "street"));
    const along = wk.w > wk.d;
    if (plan.layout !== "court") {
      const len = along ? wk.w : wk.d;
      for (let t = -len / 2 + 1; t < len / 2 - 0.5; t += 2.2) group.add(box(along ? 1.1 : 0.12, 0.02, along ? 0.12 : 1.1, "#F4F1EA", along ? wk.x + t : wk.x, 0.06, along ? wk.z : wk.z + t, false));
      for (let t = -len / 2 + 2; t < len / 2; t += 7) {
        for (const side of [-1, 1]) {
          const lx = along ? wk.x + t : wk.x + side * (wk.w / 2 - 0.3);
          const lz = along ? wk.z + side * (wk.d / 2 - 0.3) : wk.z + t;
          group.add(cyl(0.06, 2.6, "#3A3F45", lx, 1.3, lz), ball(0.2, "#F4E2B0", lx, 2.65, lz));
        }
      }
    } else {
      // A square: a big tree in the middle of its far side, benches
      group.add(cyl(0.25, 2.0, "#6B4A2B", wk.x, 1.0, wk.z - wk.d / 2 + 1.4), ball(1.4, "#3E7A3A", wk.x, 2.8, wk.z - wk.d / 2 + 1.4), ball(0.9, "#4E8E44", wk.x + 0.6, 3.3, wk.z - wk.d / 2 + 1.6));
      for (const side of [-1, 1]) group.add(box(1.6, 0.45, 0.5, "#6B4A2B", wk.x + side * (wk.w / 2 - 1.2), 0.25, wk.z + wk.d / 2 - 1.2));
    }
  }
  // The way in: an arch over the entrance
  const porch = plan.porch;
  group.add(tag(box(porch.w, 0.1, porch.d, look.path, porch.x, 0.0, porch.z, false), "out", "gate"));
  const along = Math.abs(plan.entrance.x - plan.start.x) > Math.abs(plan.entrance.z - plan.start.z);
  for (const side of [-1, 1]) {
    const ax = along ? porch.x : porch.x + side * (porch.w / 2 + 0.2);
    const az = along ? porch.z + side * (porch.d / 2 + 0.2) : porch.z;
    group.add(box(0.35, 3.0, 0.35, look.trim, ax, 1.5, az));
  }
  group.add(box(along ? 0.4 : porch.w + 0.8, 0.35, along ? porch.d + 0.8 : 0.4, look.trim, porch.x, 3.1, porch.z));

  const chests = new Map<string, THREE.Object3D>();
  const gates = new Map<string, THREE.Object3D>();
  rooms.forEach((r, i) => {
    const p = plan.rooms[i];
    const kind = PLOT[r.kind] ? r.kind : "study";
    const info = PLOT[kind];
    const accent = accents[i % accents.length];
    const ground = new THREE.Mesh(new THREE.BoxGeometry(p.w - 0.3, 0.14, p.d - 0.3), floorMaterial(info.ground, info.pattern, p.w, p.d));
    ground.position.set(p.x, 0.02, p.z);
    group.add(tag(ground, "room", r.id));

    // The plot's own frame: facing its gate
    const frame = new THREE.Group();
    frame.position.set(p.x, 0.09, p.z);
    frame.rotation.y = p.facing;
    group.add(frame);
    const turned = Math.abs(Math.sin(p.facing)) > 0.5;
    const [lw, ld] = turned ? [p.d, p.w] : [p.w, p.d];
    // A low hedge round it, open at the gate
    const hedge = style === "fort" || style === "stone" || style === "cave" ? look.back : "#3E7A3A";
    const h = 0.5;
    frame.add(box(lw - 0.3, h, 0.3, hedge, 0, h / 2, -ld / 2 + 0.15));
    for (const sx of [-1, 1]) frame.add(box(0.3, h, ld - 0.3, hedge, sx * (lw / 2 - 0.15), h / 2, 0));
    const seg = (lw - 0.3 - 1.8) / 2;
    for (const sx of [-1, 1]) frame.add(box(seg, h, 0.3, hedge, sx * (0.9 + seg / 2), h / 2, ld / 2 - 0.15));
    // The gate (shut while the plot needs something to open)
    const gate = tag(box(1.8, 1.0, 0.1, "#6B3E22", 0, 0.5, ld / 2 - 0.15), "room", r.id);
    gate.visible = r.locked === true;
    frame.add(gate);
    gates.set(r.id, gate);
    frame.add(feature(kind, lw, ld, accent));
    objects
      .filter((o) => o.room === r.id)
      .slice(0, 3)
      .forEach((o, j) => {
        const m = tag(makeObject(o.kind), "object", o.id);
        m.position.set([-lw / 2 + 1.0, lw / 2 - 1.0, 0][j], 0, [0.2, 0.2, -0.6][j]);
        m.rotation.y = [Math.PI / 2, -Math.PI / 2, 0][j];
        frame.add(m);
      });
    // The chest, dug up in the middle of the plot (with its mound)
    const chest = tag(makeChest(), "chest", r.id);
    chest.position.set(-1.0, 0, ld / 2 - 2.2);
    chest.add(cyl(0.9, 0.18, "#6B4A2B", 0, 0.05, 0, 0.6));
    chest.visible = r.chest === true;
    frame.add(chest);
    chests.set(r.id, chest);

    // Its sign and name, floating over it
    const icon = sign(info.icon);
    icon.position.set(p.x, 3.7, p.z);
    group.add(icon);
    const name = label(r.name);
    name.position.set(p.x, 2.8, p.z);
    group.add(name);
  });

  // The land's own look round the edges
  let seed = rooms.length * 13 + title.length;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 18; k++) {
    const onX = k % 2 === 0;
    const x = onX ? B.minX + rnd() * bw : k % 4 === 1 ? B.minX - 2.2 : B.maxX + 2.2;
    const z = onX ? (k % 4 === 0 ? B.minZ - 2.2 : B.maxZ + 2.6) : B.minZ + rnd() * bd;
    if (Math.hypot(x - plan.start.x, z - plan.start.z) < 3.5) continue;
    if (style === "cave" || style === "fort") {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + rnd() * 0.8, 0), mat(style === "cave" ? "#6A5E50" : "#B8A272"));
      rock.position.set(x, 0.35, z);
      group.add(rock);
    } else {
      group.add(cyl(0.15, 1.4, "#6B4A2B", x, 0.7, z), ball(0.8 + rnd() * 0.4, k % 3 ? "#3E7A3A" : "#4E8E44", x, 1.8, z));
    }
  }
  if (style === "keeper") {
    const lx = B.minX - 3, lz = B.minZ - 3;
    for (let i = 0; i < 5; i++) group.add(cyl(1.3 - i * 0.1, 1.4, i % 2 ? look.trim : "#F4F1EA", lx, 0.7 + i * 1.4, lz, 1.2 - i * 0.1));
    group.add(cyl(0.7, 0.9, "#F4D35E", lx, 7.4, lz), cyl(0.85, 0.4, "#2B2B2B", lx, 8.0, lz, 0.1));
  } else if (style === "fort") {
    for (const x of [B.minX - 1.5, B.maxX + 1.5]) group.add(box(2, 4.5, 2, look.back, x, 2.25, B.minZ - 1.5), box(2.3, 0.4, 2.3, look.trim, x, 4.6, B.minZ - 1.5));
    group.add(box(bw + 2, 1.6, 0.6, look.back, plan.centre.x, 0.8, B.minZ - 1.6));
  } else if (style === "cave") {
    for (const [x, z, r] of [[B.minX - 3, B.minZ - 2, 3.2], [B.maxX + 2.5, B.minZ - 2.5, 2.6], [B.minX - 3.5, B.maxZ - 3, 2]] as const) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat("#5A5048"));
      rock.position.set(x, r * 0.6, z);
      group.add(rock);
    }
  } else if (style === "stone") {
    group.add(box(bw + 2, 1.2, 0.6, look.back, plan.centre.x, 0.6, B.minZ - 1.6));
  }

  return {
    group,
    plan,
    targets,
    setChest(room) {
      for (const [id, c] of chests) c.visible = id === room;
    },
    setLocked(room, locked) {
      const g = gates.get(room);
      if (g) g.visible = locked;
    },
  };
}

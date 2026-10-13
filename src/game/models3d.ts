/**
 * Low-poly models built in code (design doc 13.2): the hunter avatar for every
 * look option, a bicycle, a floating name tag and a destination marker.
 * Geometries and materials are shared, so hundreds of avatars stay cheap.
 * Units are metres; an avatar is about 2.45 m tall before map enlargement.
 */
import * as THREE from "three";
import type { AvatarLook } from "@/lib/avatar";
import type { Mode, Phase } from "./movement";

const materials = new Map<string, THREE.MeshLambertMaterial>();
function material(color: string) {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    materials.set(color, m);
  }
  return m;
}

const G = {
  torso: new THREE.BoxGeometry(0.5, 0.95, 0.28),
  head: new THREE.SphereGeometry(0.34, 16, 12),
  hairCap: new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  afro: new THREE.SphereGeometry(0.42, 14, 10),
  bun: new THREE.SphereGeometry(0.15, 10, 8),
  braid: new THREE.BoxGeometry(0.09, 0.55, 0.09),
  eye: new THREE.SphereGeometry(0.045, 6, 6),
  leg: new THREE.BoxGeometry(0.19, 0.85, 0.19),
  shoe: new THREE.BoxGeometry(0.22, 0.12, 0.38),
  arm: new THREE.BoxGeometry(0.14, 0.75, 0.14),
  sleeve: new THREE.BoxGeometry(0.17, 0.26, 0.17),
  hand: new THREE.SphereGeometry(0.09, 8, 8),
  hood: new THREE.BoxGeometry(0.42, 0.22, 0.2),
  stripe: new THREE.BoxGeometry(0.06, 0.95, 0.02),
  capTop: new THREE.SphereGeometry(0.37, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.BoxGeometry(0.4, 0.04, 0.26),
  lens: new THREE.BoxGeometry(0.15, 0.1, 0.03),
  bridge: new THREE.BoxGeometry(0.06, 0.025, 0.03),
  band: new THREE.TorusGeometry(0.38, 0.035, 6, 20, Math.PI),
  earcup: new THREE.CylinderGeometry(0.1, 0.1, 0.08, 12),
  tyre: new THREE.CylinderGeometry(0.5, 0.5, 0.22, 16),
  spoke: new THREE.BoxGeometry(0.24, 0.86, 0.08),
  tube: new THREE.BoxGeometry(0.16, 0.16, 1.45),
  post: new THREE.BoxGeometry(0.14, 0.6, 0.14),
  fork: new THREE.BoxGeometry(0.14, 0.7, 0.14),
  bar: new THREE.BoxGeometry(0.8, 0.1, 0.1),
  seat: new THREE.BoxGeometry(0.36, 0.1, 0.55),
  guard: new THREE.BoxGeometry(0.3, 0.08, 0.9),
};

const DARK = "#222831";
const SHOE = "#222222";
const EYE = "#111111";
const STRIPE = "#F4F1EA";
const BIKE = "#D62828";

function mesh(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material(color));
  m.position.set(x, y, z);
  return m;
}

function limb(parent: THREE.Object3D, x: number, y: number, parts: THREE.Object3D[]) {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  g.add(...parts);
  parent.add(g);
  return g;
}

export type Avatar3D = {
  root: THREE.Group;
  rig: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  vehicles: Record<"bicycle" | "motorbike" | "car", Vehicle3D>;
  wt: number;
  amp: number;
};

export function buildAvatar(look: AvatarLook): Avatar3D {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);
  const { skin, hair, hairColour, top, topColour, bottomsColour, extra } = look;

  // Body and head
  rig.add(mesh(G.torso, topColour, 0, 1.3, 0));
  rig.add(mesh(G.head, skin, 0, 2.0, 0));
  rig.add(mesh(G.eye, EYE, -0.12, 2.03, 0.31), mesh(G.eye, EYE, 0.12, 2.03, 0.31));

  if (top === "hoodie") rig.add(mesh(G.hood, topColour, 0, 1.8, -0.17));
  if (top === "jersey") rig.add(mesh(G.stripe, STRIPE, -0.12, 1.3, 0.145), mesh(G.stripe, STRIPE, 0.12, 1.3, 0.145));

  // Hair
  if (hair !== "bald") rig.add(mesh(G.hairCap, hairColour, 0, 2.03, -0.02));
  if (hair === "afro") rig.add(mesh(G.afro, hairColour, 0, 2.15, -0.12));
  if (hair === "bun") rig.add(mesh(G.bun, hairColour, 0, 2.38, -0.12));
  if (hair === "braids") rig.add(mesh(G.braid, hairColour, -0.3, 1.8, -0.08), mesh(G.braid, hairColour, 0.3, 1.8, -0.08));

  // Extras
  if (extra === "cap") rig.add(mesh(G.capTop, DARK, 0, 2.05, 0), mesh(G.brim, DARK, 0, 2.18, 0.25));
  if (extra === "glasses") {
    rig.add(mesh(G.lens, EYE, -0.12, 2.03, 0.33), mesh(G.lens, EYE, 0.12, 2.03, 0.33), mesh(G.bridge, EYE, 0, 2.04, 0.34));
  }
  if (extra === "headphones") {
    rig.add(mesh(G.band, DARK, 0, 2.0, 0));
    const left = mesh(G.earcup, DARK, -0.37, 2.0, 0);
    const right = mesh(G.earcup, DARK, 0.37, 2.0, 0);
    left.rotation.z = right.rotation.z = Math.PI / 2;
    rig.add(left, right);
  }

  // Limbs pivot at the hips and shoulders
  const leg = () => [mesh(G.leg, bottomsColour, 0, -0.425, 0), mesh(G.shoe, SHOE, 0, -0.88, 0.06)];
  const legL = limb(rig, -0.13, 0.85, leg());
  const legR = limb(rig, 0.13, 0.85, leg());
  const fullSleeves = top === "hoodie";
  const arm = () => [
    mesh(G.arm, fullSleeves ? topColour : skin, 0, -0.375, 0),
    ...(fullSleeves ? [] : [mesh(G.sleeve, topColour, 0, -0.13, 0)]),
    mesh(G.hand, skin, 0, -0.77, 0),
  ];
  const armL = limb(rig, -0.34, 1.72, arm());
  const armR = limb(rig, 0.34, 1.72, arm());

  // Vehicles, hidden until the hunter rides one
  const vehicles = { bicycle: buildBicycle(), motorbike: buildMotorbike(), car: buildCar() };
  for (const v of Object.values(vehicles)) {
    v.group.visible = false;
    root.add(v.group);
  }

  return { root, rig, legL, legR, armL, armR, vehicles, wt: Math.random() * 6, amp: 0 };
}

// ---------------------------------------------------------------------------
// Vehicles (shared by riders and parked vehicles)
// ---------------------------------------------------------------------------
type Vehicle3D = { group: THREE.Group; wheels: THREE.Group[]; wheelRadius: number };

const MOTO = "#C1121F";
const CAR = "#1D7FD6";
const V_G = {
  motoBody: new THREE.BoxGeometry(0.45, 0.4, 1.3),
  motoSeat: new THREE.BoxGeometry(0.4, 0.14, 0.8),
  motoBar: new THREE.BoxGeometry(0.75, 0.08, 0.08),
  lamp: new THREE.SphereGeometry(0.13, 8, 8),
  motoTyre: new THREE.CylinderGeometry(0.42, 0.42, 0.24, 16),
  carBody: new THREE.BoxGeometry(1.7, 0.55, 3.6),
  carCabin: new THREE.BoxGeometry(1.5, 0.12, 1.6),
  carSeat: new THREE.BoxGeometry(1.2, 0.7, 0.2),
  windscreen: new THREE.BoxGeometry(1.5, 0.7, 0.06),
  wheelHub: new THREE.TorusGeometry(0.2, 0.03, 8, 16),
  carTyre: new THREE.CylinderGeometry(0.45, 0.45, 0.3, 16),
};

function wheel(geo: THREE.BufferGeometry, x: number, y: number, z: number) {
  const w = new THREE.Group();
  w.position.set(x, y, z);
  const tyre = mesh(geo, "#1D1D1D");
  tyre.rotation.z = Math.PI / 2;
  w.add(tyre, mesh(G.spoke, "#BBBBBB"));
  return w;
}

function buildBicycle(): Vehicle3D {
  const group = new THREE.Group();
  const wheels = [wheel(G.tyre, 0, 0.5, -0.95), wheel(G.tyre, 0, 0.5, 0.95)];
  group.add(
    ...wheels,
    mesh(G.tube, BIKE, 0, 0.85, 0),
    mesh(G.post, BIKE, 0, 0.75, -0.55),
    mesh(G.fork, BIKE, 0, 0.75, 0.8),
    mesh(G.bar, DARK, 0, 1.1, 0.78),
    mesh(G.seat, DARK, 0, 1.05, -0.55),
    mesh(G.guard, BIKE, 0, 1.08, -1.0),
  );
  return { group, wheels, wheelRadius: 0.5 };
}

function buildMotorbike(): Vehicle3D {
  const group = new THREE.Group();
  const wheels = [wheel(V_G.motoTyre, 0, 0.42, -0.85), wheel(V_G.motoTyre, 0, 0.42, 0.85)];
  group.add(
    ...wheels,
    mesh(V_G.motoBody, MOTO, 0, 0.75, 0),
    mesh(V_G.motoSeat, DARK, 0, 1.0, -0.25),
    mesh(V_G.motoBar, DARK, 0, 1.15, 0.62),
    new THREE.Mesh(V_G.lamp, glow("#FFEE88")),
  );
  group.children[group.children.length - 1].position.set(0, 1.05, 0.8);
  return { group, wheels, wheelRadius: 0.42 };
}

function buildCar(): Vehicle3D {
  const group = new THREE.Group();
  const wheels = [
    wheel(V_G.carTyre, -0.9, 0.45, -1.1),
    wheel(V_G.carTyre, 0.9, 0.45, -1.1),
    wheel(V_G.carTyre, -0.9, 0.45, 1.2),
    wheel(V_G.carTyre, 0.9, 0.45, 1.2),
  ];
  const screen = mesh(V_G.windscreen, "#9FD8FF", 0, 1.25, 0.6);
  screen.rotation.x = -0.4;
  group.add(...wheels, mesh(V_G.carBody, CAR, 0, 0.6, 0), mesh(V_G.carSeat, DARK, 0, 1.1, -0.5), screen);
  return { group, wheels, wheelRadius: 0.45 };
}

/** A parked vehicle on the map (the player's own, waiting where they left it). */
export function makeVehicleModel(kind: "bicycle" | "motorbike" | "car") {
  const v = kind === "bicycle" ? buildBicycle() : kind === "motorbike" ? buildMotorbike() : buildCar();
  return v.group;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Pose the avatar for this frame. `moving` is speed relative to full pace
 * (above 1 when sprinting); `distance` is how far it moved, in model units.
 */
export function animateAvatar(
  av: Avatar3D,
  state: { mode: Mode; phase: Phase; moving: number; distance: number },
  dt: number,
  t: number,
) {
  const k = Math.min(1, 10 * dt);
  const { legL, legR, armL, armR, rig } = av;
  for (const [kind, v] of Object.entries(av.vehicles)) v.group.visible = state.mode === kind && state.phase !== "fainted";
  const riding = state.mode === "walk" ? null : av.vehicles[state.mode];
  if (riding) for (const w of riding.wheels) w.rotation.x += state.distance / riding.wheelRadius;
  if (state.mode !== "car") rig.position.x = 0;

  if (state.phase === "fainted") {
    rig.rotation.x = lerp(rig.rotation.x, -Math.PI / 2, k * 0.5);
    rig.position.y = lerp(rig.position.y, 0.22, k);
    for (const l of [legL, legR, armL, armR]) l.rotation.x = lerp(l.rotation.x, 0, k);
    armL.rotation.z = lerp(armL.rotation.z, -1.2, k);
    armR.rotation.z = lerp(armR.rotation.z, 1.2, k);
    return;
  }
  armL.rotation.z = lerp(armL.rotation.z, 0, k);
  armR.rotation.z = lerp(armR.rotation.z, 0, k);

  if (state.phase === "celebrate") {
    rig.rotation.x = lerp(rig.rotation.x, 0, k);
    armL.rotation.x = lerp(armL.rotation.x, Math.PI, k);
    armR.rotation.x = lerp(armR.rotation.x, Math.PI, k);
    legL.rotation.x = legR.rotation.x = 0;
    rig.position.y = Math.abs(Math.sin(t * 8)) * 0.35 + (state.mode === "bicycle" ? 0.25 : 0);
    return;
  }

  if (state.mode === "bicycle") {
    av.wt += dt * 9 * Math.min(1.6, state.moving);
    const pedal = Math.sin(av.wt) * 0.45;
    legL.rotation.x = -0.8 + pedal;
    legR.rotation.x = -0.8 - pedal;
    armL.rotation.x = armR.rotation.x = -1;
    rig.position.y = 0.25;
    rig.rotation.x = lerp(rig.rotation.x, 0.35, k); // lean over the handlebars
    return;
  }

  if (state.mode === "motorbike") {
    legL.rotation.x = legR.rotation.x = -1.1;
    armL.rotation.x = armR.rotation.x = -1;
    rig.position.y = 0.2;
    rig.rotation.x = lerp(rig.rotation.x, 0.2, k);
    return;
  }

  if (state.mode === "car") {
    // Sitting at the wheel, a little to the left like a driver in Nigeria.
    legL.rotation.x = legR.rotation.x = -1.4;
    armL.rotation.x = armR.rotation.x = -0.9;
    rig.position.set(-0.35, -0.15, 0);
    rig.rotation.x = lerp(rig.rotation.x, 0, k);
    return;
  }


  rig.rotation.x = lerp(rig.rotation.x, 0, k);
  const moving = state.moving > 0.05;
  av.wt += dt * 11 * (moving ? Math.max(0.6, state.moving) : 0);
  av.amp = lerp(av.amp, moving ? Math.min(1.1, 0.85 * Math.max(1, state.moving)) : 0, k);
  const swing = Math.sin(av.wt) * av.amp;
  legL.rotation.x = swing;
  legR.rotation.x = -swing;
  armL.rotation.x = -swing;
  armR.rotation.x = swing;
  rig.position.y = Math.abs(Math.sin(av.wt)) * 0.07 * (av.amp / 0.85);
}

/**
 * A name tag that floats above an avatar. Register it with
 * ThreeMapLayer.billboard() so it turns to face the camera every frame.
 */
export function makeNameplate(text: string, background: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext("2d")!;
  g.fillStyle = background;
  g.beginPath();
  g.roundRect(4, 4, 248, 56, 28);
  g.fill();
  g.fillStyle = "#FFFFFF";
  g.font = "bold 34px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text.length > 14 ? `${text.slice(0, 13)}…` : text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // A flat card rather than a THREE.Sprite: sprites assume a normal camera,
  // and on the map layer they turned edge-on whenever the hunter faced east or west.
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 0.7),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, side: THREE.DoubleSide }),
  );
  plate.position.y = 3.2;
  plate.renderOrder = 10;
  return plate;
}

// ---------------------------------------------------------------------------
// Things to find while roaming
// ---------------------------------------------------------------------------
const glowMaterials = new Map<string, THREE.MeshLambertMaterial>();
function glow(color: string) {
  let m = glowMaterials.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45 });
    glowMaterials.set(color, m);
  }
  return m;
}

const ITEM_G = {
  coin: new THREE.CylinderGeometry(0.35, 0.35, 0.08, 20),
  chest: new THREE.BoxGeometry(0.8, 0.5, 0.55),
  chestBand: new THREE.BoxGeometry(0.84, 0.08, 0.59),
  scroll: new THREE.CylinderGeometry(0.13, 0.13, 0.7, 12),
  scrollBand: new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12),
  crystal: new THREE.IcosahedronGeometry(0.32, 0),
  ring: new THREE.TorusGeometry(0.7, 0.05, 6, 24),
};

export type ItemModel = { group: THREE.Group; spin: THREE.Group };

/** A coin, a treasure chest (coin cache), an intel scroll or a glowing relic crystal. */
export function makeItemModel(kind: "coins" | "cache" | "intel" | "relic", relicColour = "#F4B41A"): ItemModel {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);

  if (kind === "coins") {
    const coin = new THREE.Mesh(ITEM_G.coin, glow("#F4B41A"));
    coin.rotation.x = Math.PI / 2;
    spin.add(coin);
    spin.position.y = 0.9;
  } else if (kind === "cache") {
    spin.add(mesh(ITEM_G.chest, "#7A4A22", 0, 0.25, 0));
    const band = new THREE.Mesh(ITEM_G.chestBand, glow("#F4B41A"));
    band.position.y = 0.38;
    spin.add(band);
  } else if (kind === "intel") {
    const scroll = mesh(ITEM_G.scroll, "#F1E3C2");
    const band = new THREE.Mesh(ITEM_G.scrollBand, glow("#D93B3B"));
    scroll.rotation.z = band.rotation.z = Math.PI / 2;
    spin.add(scroll, band);
    spin.position.y = 0.9;
  } else {
    spin.add(new THREE.Mesh(ITEM_G.crystal, glow(relicColour)));
    spin.position.y = 1.0;
  }

  const ring = new THREE.Mesh(ITEM_G.ring, new THREE.MeshBasicMaterial({ color: kind === "relic" ? relicColour : "#F4B41A", transparent: true, opacity: 0.45 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);
  return { group, spin };
}

/** Purple beam where an intel scroll says something is hidden. */
export function makeLeadMarker() {
  const purple = new THREE.MeshBasicMaterial({ color: 0xc3a6ff, transparent: true, opacity: 0.55 });
  const group = new THREE.Group();
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 32), purple);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.1;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 40, 8), purple);
  beam.position.y = 20;
  group.add(halo, beam);
  return group;
}

/** Gold ring and beam marking where the player is heading. */
export function makeDestinationMarker() {
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.5 });
  const group = new THREE.Group();
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.1, 8, 32), glow);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.1;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 30, 8), glow);
  beam.position.y = 15;
  group.add(halo, beam);
  group.visible = false;
  return { group, halo };
}

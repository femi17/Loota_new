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

/** A vehicle on its own (the player's, shrinking into their pocket). */
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
  state: { mode: Mode; phase: Phase; moving: number; distance: number; sitting?: boolean },
  dt: number,
  t: number,
) {
  const k = Math.min(1, 10 * dt);
  const { legL, legR, armL, armR, rig } = av;
  for (const [kind, v] of Object.entries(av.vehicles)) v.group.visible = state.mode === kind && state.phase !== "fainted" && !state.sitting;

  if (state.sitting && state.phase !== "fainted") {
    // Resting by the road: sitting on the ground, legs out in front, hands on the knees, a slow breath.
    rig.position.x = 0;
    rig.rotation.x = lerp(rig.rotation.x, -0.08, k);
    rig.position.y = lerp(rig.position.y, -0.78 + Math.sin(t * 1.6) * 0.012, k);
    legL.rotation.x = lerp(legL.rotation.x, -1.45, k);
    legR.rotation.x = lerp(legR.rotation.x, -1.3, k);
    armL.rotation.x = lerp(armL.rotation.x, -0.75, k);
    armR.rotation.x = lerp(armR.rotation.x, -0.75, k);
    armL.rotation.z = lerp(armL.rotation.z, 0, k);
    armR.rotation.z = lerp(armR.rotation.z, 0, k);
    return;
  }
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

/**
 * A Lockdown dome (design doc 7.2): a translucent purple half-sphere `radius`
 * metres across its base, with a lighter lattice so its curve reads in 3D.
 * Drawn at true size (add it to the map with scale 1).
 */
export function makeDome(radius: number) {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9b5de5, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  const lattice = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xd8b8ff, transparent: true, opacity: 0.35, wireframe: true, depthWrite: false }),
  );
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, Math.max(2, radius / 250), 6, 96),
    new THREE.MeshBasicMaterial({ color: 0xc89bff, transparent: true, opacity: 0.7 }),
  );
  rim.rotation.x = Math.PI / 2;
  group.add(shell, lattice, rim);
  return group;
}

// ---- Public transport (design doc 13.2: generic, unbranded) -----------------
// Forward is +z, like the other vehicles. Sizes are squashed a little so they
// read well next to the enlarged avatars.

const T_G = {
  busBody: new THREE.BoxGeometry(2.4, 2.2, 7.5),
  busRoof: new THREE.BoxGeometry(2.3, 0.15, 7.2),
  busWindows: new THREE.BoxGeometry(2.46, 0.7, 6.2),
  busStripe: new THREE.BoxGeometry(2.47, 0.18, 7.52),
  busScreen: new THREE.BoxGeometry(2.1, 0.9, 0.06),
  busTyre: new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14),
  carriage: new THREE.BoxGeometry(2.6, 2.6, 8.4),
  carriageRoof: new THREE.BoxGeometry(2.3, 0.3, 8.2),
  carriageWindows: new THREE.BoxGeometry(2.66, 0.6, 7.4),
  carriageStripe: new THREE.BoxGeometry(2.67, 0.3, 8.42),
  nose: new THREE.BoxGeometry(2.6, 1.6, 1.4),
  noseScreen: new THREE.BoxGeometry(2.2, 0.8, 0.08),
  bogie: new THREE.BoxGeometry(2.0, 0.5, 2.2),
  fuselage: new THREE.CylinderGeometry(1.3, 1.3, 13, 16),
  noseCone: new THREE.SphereGeometry(1.3, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  tailCone: new THREE.ConeGeometry(1.3, 3.2, 16),
  wing: new THREE.BoxGeometry(15, 0.25, 2.6),
  tailWing: new THREE.BoxGeometry(5.6, 0.2, 1.4),
  fin: new THREE.BoxGeometry(0.25, 3.2, 2.2),
  engine: new THREE.CylinderGeometry(0.5, 0.5, 2.2, 12),
  cabinWindows: new THREE.CylinderGeometry(1.32, 1.32, 9, 16, 1, true, -0.35, 0.7),
};

/** A city bus: yellow, with a black stripe (like a Lagos danfo, but bigger). */
export function makeBus() {
  const group = new THREE.Group();
  const tyre = (x: number, z: number) => {
    const w = mesh(T_G.busTyre, "#1D1D1D", x, 0.5, z);
    w.rotation.z = Math.PI / 2;
    return w;
  };
  const screen = mesh(T_G.busScreen, "#9FD8FF", 0, 1.9, 3.76);
  group.add(
    mesh(T_G.busBody, "#F4B41A", 0, 1.5, 0),
    mesh(T_G.busRoof, "#E8E2D0", 0, 2.67, 0),
    mesh(T_G.busWindows, "#2F4B63", 0, 1.95, -0.3),
    mesh(T_G.busStripe, "#111111", 0, 1.1, 0),
    screen,
    tyre(-1.15, 2.4), tyre(1.15, 2.4), tyre(-1.15, -2.4), tyre(1.15, -2.4),
  );
  return group;
}

/** One train carriage; the lead one has a sloped nose and windscreen. */
export function makeTrainCar(lead: boolean) {
  const group = new THREE.Group();
  group.add(
    mesh(T_G.carriage, "#F4F1EA", 0, 1.8, 0),
    mesh(T_G.carriageRoof, "#9A9C9E", 0, 3.2, 0),
    mesh(T_G.carriageWindows, "#2F4B63", 0, 2.25, 0),
    mesh(T_G.carriageStripe, "#1E9E62", 0, 1.2, 0),
    mesh(T_G.bogie, "#333333", 0, 0.35, 2.8),
    mesh(T_G.bogie, "#333333", 0, 0.35, -2.8),
  );
  if (lead) {
    group.add(mesh(T_G.nose, "#1E9E62", 0, 1.3, 4.9), mesh(T_G.noseScreen, "#9FD8FF", 0, 2.6, 4.25));
  }
  return group;
}

/** Length of a carriage plus the gap to the next, before enlargement. */
export const TRAIN_CAR_SPACING = 8.9;

/** A passenger plane: white, with a green tail. */
export function makePlane() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const fuselage = mesh(T_G.fuselage, "#F7F7F7");
  fuselage.rotation.x = Math.PI / 2;
  const windows = new THREE.Mesh(T_G.cabinWindows, material("#2F4B63"));
  windows.rotation.x = Math.PI / 2;
  windows.position.z = 0.5;
  const nose = mesh(T_G.noseCone, "#F7F7F7", 0, 0, 6.5);
  nose.rotation.x = Math.PI / 2;
  const tail = mesh(T_G.tailCone, "#F7F7F7", 0, 0, -8.1);
  tail.rotation.x = -Math.PI / 2;
  const engineL = mesh(T_G.engine, "#9A9C9E", -3.4, -0.7, 0.8);
  const engineR = mesh(T_G.engine, "#9A9C9E", 3.4, -0.7, 0.8);
  engineL.rotation.x = engineR.rotation.x = Math.PI / 2;
  body.add(
    fuselage,
    windows,
    nose,
    tail,
    mesh(T_G.wing, "#DADADA", 0, -0.3, 0),
    mesh(T_G.tailWing, "#DADADA", 0, 0.3, -8.4),
    mesh(T_G.fin, "#1E9E62", 0, 1.9, -8.6),
    engineL,
    engineR,
  );
  body.position.y = 1.6; // wheels-down height on the ground
  group.add(body);
  return { group, body };
}

/** An ambulance: a white van with a red stripe and cross, and a blue light on the roof. */
export function makeAmbulance() {
  const group = new THREE.Group();
  const tyre = (x: number, z: number) => {
    const w = mesh(T_G.busTyre, "#1D1D1D", x, 0.5, z);
    w.rotation.z = Math.PI / 2;
    return w;
  };
  const cab = mesh(V_G.carBody, "#F7F7F7", 0, 1.05, 2.1);
  cab.scale.set(1.25, 1.6, 0.5);
  const screen = mesh(T_G.busScreen, "#9FD8FF", 0, 1.7, 3.0);
  screen.scale.set(0.95, 0.75, 1);
  const crossH = mesh(new THREE.BoxGeometry(0.9, 0.28, 0.06), "#D62828", 0, 1.6, -2.27);
  const crossV = mesh(new THREE.BoxGeometry(0.28, 0.9, 0.06), "#D62828", 0, 1.6, -2.27);
  const light = new THREE.Mesh(V_G.lamp, glow("#3D7BFF"));
  light.position.set(0, 2.75, 1.2);
  light.scale.setScalar(1.6);
  group.add(
    mesh(new THREE.BoxGeometry(2.2, 2.2, 4.4), "#F7F7F7", 0, 1.5, -0.1),
    mesh(new THREE.BoxGeometry(2.22, 0.3, 4.42), "#D62828", 0, 1.2, -0.1),
    cab,
    screen,
    crossH,
    crossV,
    light,
    tyre(-1.05, 1.9), tyre(1.05, 1.9), tyre(-1.05, -1.6), tyre(1.05, -1.6),
  );
  return { group, light };
}

/** A taxi: a yellow car with a black stripe and a sign on the roof. */
export function makeTaxi() {
  const group = new THREE.Group();
  const tyre = (x: number, z: number) => {
    const w = mesh(V_G.carTyre, "#1D1D1D", x, 0.45, z);
    w.rotation.z = Math.PI / 2;
    return w;
  };
  const screen = mesh(V_G.windscreen, "#9FD8FF", 0, 1.25, 0.6);
  screen.rotation.x = -0.4;
  group.add(
    mesh(V_G.carBody, "#F4B41A", 0, 0.6, 0),
    mesh(new THREE.BoxGeometry(1.72, 0.12, 3.62), "#111111", 0, 0.62, 0),
    mesh(V_G.carSeat, DARK, 0, 1.1, -0.5),
    screen,
    mesh(new THREE.BoxGeometry(0.7, 0.3, 0.35), "#111111", 0, 1.55, -0.3),
    mesh(new THREE.BoxGeometry(0.6, 0.2, 0.37), "#F4F1EA", 0, 1.58, -0.3),
    tyre(-0.9, -1.1), tyre(0.9, -1.1), tyre(-0.9, 1.2), tyre(0.9, 1.2),
  );
  return group;
}

/** A landmark on the map: a stone plinth with a gold star on a column. */
/**
 * A hunt key's chest (the metal detector found it): wood with gold bands, the lid ajar and gold light inside, a
 * glowing ring on the ground. `body` rises out of the ground (its y from −1.6 to 0) and turns slowly.
 */
export function makeChest() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const lid = new THREE.Group();
  lid.position.set(0, 1.1, -0.6);
  lid.rotation.x = -0.5; // ajar
  lid.add(
    mesh(new THREE.BoxGeometry(1.9, 0.45, 1.2), "#7A4B22", 0, 0.22, 0.6),
    mesh(new THREE.BoxGeometry(1.95, 0.12, 0.14), "#F4B41A", 0, 0.3, 1.18),
  );
  const light = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.9), glow("#FFD45C"));
  light.position.y = 1.1;
  body.add(
    mesh(new THREE.BoxGeometry(1.9, 1.1, 1.2), "#7A4B22", 0, 0.55, 0),
    mesh(new THREE.BoxGeometry(1.95, 0.14, 1.25), "#F4B41A", 0, 0.2, 0),
    mesh(new THREE.BoxGeometry(1.95, 0.14, 1.25), "#F4B41A", 0, 0.9, 0),
    mesh(new THREE.BoxGeometry(0.3, 0.36, 0.08), "#F4B41A", 0, 0.75, 0.62),
    light,
    lid,
  );
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.12, 6, 28), glow("#F4B41A"));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  group.add(body, ring);
  return { group, body, ring };
}

export function makeLandmarkMarker() {
  const group = new THREE.Group();
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), glow("#F4B41A"));
  star.position.y = 5.2;
  group.add(
    mesh(new THREE.BoxGeometry(2.4, 0.6, 2.4), "#D8CFC0", 0, 0.3, 0),
    mesh(new THREE.CylinderGeometry(0.45, 0.6, 3.6, 10), "#EDE6D8", 0, 2.4, 0),
    mesh(new THREE.BoxGeometry(1.3, 0.3, 1.3), "#D8CFC0", 0, 4.3, 0),
    star,
  );
  return { group, star };
}

/**
 * A traffic light on a pole: a dark head with red, amber and green lamps on both faces and a cap that glows
 * the same colour. `show(light)` lights one (src/game/signals.ts) and dims the others.
 */
export function makeTrafficLight() {
  const group = new THREE.Group();
  const lit = { red: "#FF3B30", amber: "#FFB020", green: "#2EE07A" } as const;
  const off = { red: "#4A1C1C", amber: "#4A3A14", green: "#163A24" } as const;
  const lamps = (["red", "amber", "green"] as const).map((c) => ({ c, m: new THREE.MeshBasicMaterial({ color: off[c] }) }));
  const lamp = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14);
  group.add(
    mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.4, 8), "#3A3F47", 0, 2.2, 0),
    mesh(new THREE.BoxGeometry(0.6, 1.6, 0.42), "#1B1F24", 0, 4.5, 0),
  );
  // The cap glows in the lit colour too, so the light reads from above.
  const capMaterial = new THREE.MeshBasicMaterial({ color: off.green });
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.52), capMaterial);
  cap.position.y = 5.34;
  group.add(cap);
  lamps.forEach(({ m }, i) => {
    for (const side of [1, -1]) {
      const l = new THREE.Mesh(lamp, m);
      l.rotation.x = Math.PI / 2;
      l.position.set(0, 5 - i * 0.5, 0.23 * side);
      group.add(l);
    }
  });
  let shown = "";
  return {
    group,
    show(light: "red" | "amber" | "green") {
      if (light === shown) return;
      shown = light;
      for (const { c, m } of lamps) m.color.set(c === light ? lit[c] : off[c]);
      capMaterial.color.set(lit[light]);
    },
  };
}

// ---------------------------------------------------------------------------
// Places you go into (in-world scenes): open-roof buildings seen from above
// ---------------------------------------------------------------------------

/** A painted sign: white letters on a coloured board, facing +z. */
function signBoard(text: string, colour: string, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = Math.round((1024 * height) / width);
  const g = canvas.getContext("2d")!;
  g.fillStyle = colour;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = "#1B2433";
  g.lineWidth = 10;
  g.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  g.fillStyle = "#FFFFFF";
  let size = Math.round(canvas.height * 0.62);
  g.font = `800 ${size}px system-ui, sans-serif`;
  while (g.measureText(text.toUpperCase()).width > canvas.width - 60 && size > 20) g.font = `800 ${(size -= 4)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2 + size * 0.05);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
}

/** Where things stand in an open shop (model units; the door is at the origin, the shop runs back along −z). */
export const SHOP_SPOTS = {
  width: 11,
  depth: 7.5,
  /** The keeper waits here, facing the door. */
  keeper: { x: -2.2, z: -4.6 },
  /** The customer stands here, facing the keeper. */
  customer: { x: 1.9, z: -2.6 },
  /** The vehicle being repaired, side-on to the door. */
  stand: { x: 0, z: -3.7 },
  /** The keeper at work beside it. */
  work: { x: -1.9, z: -3.7 },
  /** Just outside the door. */
  outside: { x: 0, z: 2.6 },
} as const;

/**
 * A repair shop with no roof, seen from above (the in-world scene, owner 18 Oct 2026): walls on three sides,
 * a low front wall with the doorway, rafters where the roof would be, the sign on the back wall, and inside
 * a bicycle repairer's tyres, bicycles and workbench, or a mechanic's oil drums, tool chest and a car.
 */
export function makeOpenShop(style: "bicycle" | "workshop", sign: string) {
  const { width: W, depth: D } = SHOP_SPOTS;
  const H = 3.4;
  const T = 0.25;
  const bike = style === "bicycle";
  const wall = bike ? "#EAD9B6" : "#C9C3B6";
  const group = new THREE.Group();
  group.add(
    // Floor, a step up from the pavement
    mesh(new THREE.BoxGeometry(W, 0.14, D), bike ? "#C9B08A" : "#8F8A80", 0, 0.07, -D / 2),
    // Back and side walls, full height; the front wall only knee-high, with the doorway
    mesh(new THREE.BoxGeometry(W, H, T), wall, 0, H / 2, -D + T / 2),
    mesh(new THREE.BoxGeometry(T, H, D), wall, -W / 2 + T / 2, H / 2, -D / 2),
    mesh(new THREE.BoxGeometry(T, H, D), wall, W / 2 - T / 2, H / 2, -D / 2),
    mesh(new THREE.BoxGeometry(W / 2 - 1.5, 0.9, T), wall, -(W / 2 + 1.5) / 2, 0.45, -T / 2),
    mesh(new THREE.BoxGeometry(W / 2 - 1.5, 0.9, T), wall, (W / 2 + 1.5) / 2, 0.45, -T / 2),
    // Wall tops and the posts either side of the door
    mesh(new THREE.BoxGeometry(W + 0.1, 0.12, T + 0.1), "#7A5230", 0, H, -D + T / 2),
    mesh(new THREE.BoxGeometry(T + 0.1, 0.12, D), "#7A5230", -W / 2 + T / 2, H, -D / 2),
    mesh(new THREE.BoxGeometry(T + 0.1, 0.12, D), "#7A5230", W / 2 - T / 2, H, -D / 2),
    // Short posts either side of the doorway
    mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), "#7A5230", -1.5, 0.6, -T / 2),
    mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), "#7A5230", 1.5, 0.6, -T / 2),
    // Rafters where the roof would be, and a strip of zinc along the back
    mesh(new THREE.BoxGeometry(W, 0.14, 0.14), "#6B4A2B", 0, H + 0.08, -D * 0.35),
    mesh(new THREE.BoxGeometry(W, 0.14, 0.14), "#6B4A2B", 0, H + 0.08, -D * 0.7),
  );
  const zinc = mesh(new THREE.BoxGeometry(W + 0.4, 0.06, 1.4), bike ? "#A7B1B9" : "#8B5A3C", 0, H + 0.3, -D + 0.4);
  zinc.rotation.x = 0.35;
  group.add(zinc);
  // The sign, high on the back wall, facing the door
  const board = signBoard(sign, bike ? "#1E6FB8" : "#B8322A", 7, 0.95);
  board.position.set(0, H - 0.65, -D + T + 0.02);
  group.add(board);

  if (bike) {
    // Bicycles for sale or waiting, along the back wall
    for (const [x, colour] of [
      [-3.4, "#E5484D"],
      [3.4, "#1E9E62"],
    ] as const) {
      const b = buildBicycle().group;
      b.rotation.y = Math.PI / 2;
      b.position.set(x, 0.14, -D + 0.9);
      b.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material === material(BIKE)) o.material = material(colour);
      });
      group.add(b);
    }
    // Tyres hanging on the left wall
    for (const [z, y] of [
      [-2.2, 2.3],
      [-3.4, 2.1],
      [-4.6, 2.3],
    ]) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 8, 20), material("#1D1D1D"));
      tyre.rotation.y = Math.PI / 2;
      tyre.position.set(-W / 2 + T + 0.15, y, z);
      group.add(tyre);
    }
    // The workbench and the tool board on the right
    group.add(
      mesh(new THREE.BoxGeometry(1.3, 1, 2.6), "#8B5A3C", W / 2 - 1, 0.5, -4.2),
      mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), "#5B6475", W / 2 - 1.1, 1.15, -3.6),
      mesh(new THREE.BoxGeometry(0.08, 1.3, 2.6), "#6B4A2B", W / 2 - T - 0.06, 2.2, -4.2),
    );
    for (let i = 0; i < 5; i++) group.add(mesh(new THREE.BoxGeometry(0.06, 0.7, 0.1), "#C9CED6", W / 2 - T - 0.13, 2.2, -5.1 + i * 0.45));
    // A stack of old tyres by the door
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.14, 8, 18), material("#2A2A2A"));
      t.rotation.x = Math.PI / 2;
      t.position.set(-W / 2 + 1.2, 0.3 + i * 0.26, -1.1);
      group.add(t);
    }
  } else {
    // Oil drums, a red tool chest, a tyre stack, and a car in for repair on the left
    for (const [x, z, colour] of [
      [W / 2 - 0.8, -D + 0.8, "#1E6FB8"],
      [W / 2 - 1.8, -D + 0.8, "#B8322A"],
      [W / 2 - 0.8, -D + 1.8, "#1E9E62"],
    ] as const) {
      group.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.2, 14), colour, x, 0.74, z));
    }
    group.add(
      mesh(new THREE.BoxGeometry(1.4, 1.1, 0.8), "#D62828", W / 2 - 1.1, 0.69, -3),
      mesh(new THREE.BoxGeometry(1.42, 0.06, 0.82), "#8C969E", W / 2 - 1.1, 0.9, -3),
    );
    const car = buildCar().group;
    car.rotation.y = Math.PI;
    car.scale.setScalar(0.85);
    car.position.set(-W / 2 + 1.6, 0.14, -D / 2 - 0.2);
    group.add(car);
    // Oil stains on the floor
    for (const [x, z, r] of [
      [0.5, -3.2, 0.7],
      [-1.5, -1.8, 0.4],
    ]) {
      const stain = new THREE.Mesh(new THREE.CircleGeometry(r, 16), material("#4A4540"));
      stain.rotation.x = -Math.PI / 2;
      stain.position.set(x, 0.15, z);
      group.add(stain);
    }
  }
  return group;
}

/** A few sparkles over something mended; spin them with `.rotation.y`. */
export function makeSparkles() {
  const group = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), glow("#FFD45C"));
    const a = (i / 5) * Math.PI * 2;
    s.position.set(Math.cos(a) * 1.1, 1.6 + (i % 2) * 0.5, Math.sin(a) * 1.1);
    group.add(s);
  }
  return group;
}

/** Where people stand in a place you go into (model units; the doorway at the origin, the place along −z). */
export type PlaceSpots = {
  width: number;
  depth: number;
  /** The keeper (cook, attendant, nurse, renter) waits here. */
  keeper: { x: number; z: number };
  /** You stand here to talk, facing the keeper. */
  customer: { x: number; z: number };
  /** What the event is about: the vehicle at the pump or on the stand, the plate on the table, the bed. */
  stand: { x: number; z: number };
  /** The keeper at work on it. */
  work: { x: number; z: number };
  /** Just outside, where you come in from. */
  outside: { x: number; z: number };
  /** A seat (the buka's bench): where you sit, facing +z. */
  seat?: { x: number; z: number; y: number };
};

/** Three walls, a knee-high front wall with a doorway, rafters, no roof; the sign high on the back wall. */
function openRoom(W: number, D: number, wall: string, floor: string, sign: string, signColour: string, H = 3.4) {
  const T = 0.25;
  const group = new THREE.Group();
  group.add(
    mesh(new THREE.BoxGeometry(W, 0.14, D), floor, 0, 0.07, -D / 2),
    mesh(new THREE.BoxGeometry(W, H, T), wall, 0, H / 2, -D + T / 2),
    mesh(new THREE.BoxGeometry(T, H, D), wall, -W / 2 + T / 2, H / 2, -D / 2),
    mesh(new THREE.BoxGeometry(T, H, D), wall, W / 2 - T / 2, H / 2, -D / 2),
    mesh(new THREE.BoxGeometry(W / 2 - 1.5, 0.9, T), wall, -(W / 2 + 1.5) / 2, 0.45, -T / 2),
    mesh(new THREE.BoxGeometry(W / 2 - 1.5, 0.9, T), wall, (W / 2 + 1.5) / 2, 0.45, -T / 2),
    mesh(new THREE.BoxGeometry(W + 0.1, 0.12, T + 0.1), "#7A5230", 0, H, -D + T / 2),
    mesh(new THREE.BoxGeometry(T + 0.1, 0.12, D), "#7A5230", -W / 2 + T / 2, H, -D / 2),
    mesh(new THREE.BoxGeometry(T + 0.1, 0.12, D), "#7A5230", W / 2 - T / 2, H, -D / 2),
    mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), "#7A5230", -1.5, 0.6, -T / 2),
    mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), "#7A5230", 1.5, 0.6, -T / 2),
    mesh(new THREE.BoxGeometry(W, 0.14, 0.14), "#6B4A2B", 0, H + 0.08, -D * 0.35),
    mesh(new THREE.BoxGeometry(W, 0.14, 0.14), "#6B4A2B", 0, H + 0.08, -D * 0.7),
  );
  const board = signBoard(sign, signColour, Math.min(W - 2, 7), 0.95);
  board.position.set(0, H - 0.65, -D + T + 0.02);
  group.add(board);
  return group;
}

/** A table top with legs. */
function table(x: number, z: number, w: number, d: number, colour = "#7A5230") {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, 0.1, d), colour, 0, 0.95, 0));
  for (const [lx, lz] of [
    [-w / 2 + 0.1, -d / 2 + 0.1],
    [w / 2 - 0.1, -d / 2 + 0.1],
    [-w / 2 + 0.1, d / 2 - 0.1],
    [w / 2 - 0.1, d / 2 - 0.1],
  ]) {
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), colour, lx, 0.45, lz));
  }
  g.position.set(x, 0.14, z);
  return g;
}

export const BUKA_SPOTS: PlaceSpots = {
  width: 11,
  depth: 7.5,
  keeper: { x: -2.6, z: -4.9 },
  customer: { x: 1.4, z: -2.4 },
  stand: { x: 2.6, z: -3.4 },
  work: { x: 1.1, z: -3.4 },
  outside: { x: 0, z: 2.6 },
  seat: { x: 2.6, z: -4.35, y: 0.5 },
};

/**
 * A buka with no roof: pots steaming on the fire at the back, the day's menu on the wall, tables and benches.
 * `plate(state)` shows the plate on the table (full, half eaten, empty) or takes it away (null).
 */
export function makeOpenBuka(sign: string, menu: string[]) {
  const { width: W, depth: D } = BUKA_SPOTS;
  const group = openRoom(W, D, "#E9C79A", "#C9A27A", sign, "#F07A28");
  // The cooking: three pots on a stand over the fire, steam rising
  group.add(mesh(new THREE.BoxGeometry(3.4, 0.6, 1.2), "#5B4636", -3, 0.44, -D + 1.2));
  const steam: THREE.Mesh[] = [];
  for (const [i, x] of [-4.1, -3, -1.9].entries()) {
    group.add(mesh(new THREE.CylinderGeometry(0.45, 0.38, 0.6, 14), i === 1 ? "#7A2232" : "#3A3A3A", x, 1.05, -D + 1.2));
    group.add(mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.06, 14), "#555555", x, 1.37, -D + 1.2));
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.6 }));
    puff.position.set(x, 1.7, -D + 1.2);
    group.add(puff);
    steam.push(puff);
  }
  const fire = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.0), glow("#F07A28"));
  fire.position.set(-3, 0.2, -D + 1.2);
  group.add(fire);
  // The menu on the back wall, right
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#2B3A2F";
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = "#7A5230";
  g.lineWidth = 16;
  g.strokeRect(8, 8, 496, 304);
  g.fillStyle = "#F4F1EA";
  g.textAlign = "center";
  g.font = "800 52px system-ui, sans-serif";
  g.fillText("TODAY", 256, 76);
  g.font = "600 40px system-ui, sans-serif";
  menu.slice(0, 3).forEach((m, i) => g.fillText(m.toUpperCase(), 256, 146 + i * 58));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: texture }));
  board.position.set(3, 1.9, -D + 0.27);
  group.add(board);
  // Tables and benches; you sit behind the first one, facing the door
  const { stand, seat } = BUKA_SPOTS;
  group.add(table(stand.x, stand.z, 2.4, 1.2));
  group.add(
    mesh(new THREE.BoxGeometry(2.4, 0.12, 0.5), "#9C6B3F", stand.x, 0.62, seat!.z),
    mesh(new THREE.BoxGeometry(2.4, 0.12, 0.5), "#9C6B3F", stand.x, 0.62, stand.z + 1),
  );
  group.add(table(-1.8, -2.4, 2, 1.1));
  group.add(mesh(new THREE.BoxGeometry(2, 0.12, 0.5), "#9C6B3F", -1.8, 0.62, -1.5));
  // A crate of soft drinks by the door
  group.add(mesh(new THREE.BoxGeometry(1, 0.6, 0.7), "#F4B41A", W / 2 - 1, 0.44, -1));
  for (let i = 0; i < 4; i++) group.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), "#1E9E62", W / 2 - 1.35 + i * 0.23, 0.94, -1));
  // The plate
  const plate = new THREE.Group();
  plate.position.set(stand.x, 1.13, stand.z);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.06, 18), material("#FFFFFF"));
  const food = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), material("#D9531E"));
  food.scale.set(1, 0.45, 1);
  food.position.y = 0.06;
  const side = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 6), material("#C98A4B"));
  side.scale.set(1, 0.6, 1);
  side.position.set(0.22, 0.07, 0.1);
  plate.add(dish, food, side);
  plate.visible = false;
  group.add(plate);
  return {
    group,
    steam,
    /** The plate on the table: its food (colours of the dish), half eaten, cleared, or gone. */
    plate(state: "full" | "half" | "empty" | null, colours?: { base: string; side: string }) {
      plate.visible = state !== null;
      if (colours) {
        food.material = material(colours.base);
        side.material = material(colours.side);
      }
      food.visible = side.visible = state === "full" || state === "half";
      food.scale.set(state === "half" ? 0.6 : 1, state === "half" ? 0.3 : 0.45, state === "half" ? 0.6 : 1);
    },
  };
}

export const FUEL_SPOTS: PlaceSpots = {
  width: 12,
  depth: 8,
  keeper: { x: -2.8, z: -5.4 },
  customer: { x: 3, z: -2.4 },
  stand: { x: 0.9, z: -3.8 },
  work: { x: -0.7, z: -2.4 },
  outside: { x: 0, z: 2.6 },
};

/**
 * A petrol station's forecourt with the canopy's frame (no roof, so you see the pump): the island, two pumps
 * whose displays show `meter(n)`, the kiosk at the back, the sign over the canopy.
 */
export function makeOpenPetrol(sign: string) {
  const { width: W, depth: D } = FUEL_SPOTS;
  const group = new THREE.Group();
  const H = 4.2;
  group.add(mesh(new THREE.BoxGeometry(W, 0.1, D), "#B9B4AA", 0, 0.05, -D / 2));
  // The canopy: four columns and the edge beams in the station's green, a gold stripe along the back
  for (const [x, z] of [
    [-W / 2 + 0.8, -0.8],
    [W / 2 - 0.8, -0.8],
    [-W / 2 + 0.8, -D + 1.6],
    [W / 2 - 0.8, -D + 1.6],
  ]) {
    group.add(mesh(new THREE.BoxGeometry(0.4, H, 0.4), "#D8D8D8", x, H / 2, z));
  }
  // (No beam along the front: it would cross the view into the forecourt.)
  group.add(
    mesh(new THREE.BoxGeometry(W - 1, 0.5, 0.3), "#1E9E62", 0, H, -D + 1.6),
    mesh(new THREE.BoxGeometry(0.3, 0.5, D - 2.4), "#1E9E62", -W / 2 + 0.8, H, -D / 2 + 0.4),
    mesh(new THREE.BoxGeometry(0.3, 0.5, D - 2.4), "#1E9E62", W / 2 - 0.8, H, -D / 2 + 0.4),
    mesh(new THREE.BoxGeometry(W - 1, 0.12, 0.32), "#F4B41A", 0, H - 0.3, -D + 1.6),
  );
  // The kiosk at the back
  group.add(
    mesh(new THREE.BoxGeometry(5, 2.6, 1.4), "#F4F1EA", 2.5, 1.35, -D + 0.7),
    mesh(new THREE.BoxGeometry(5.05, 0.4, 1.45), "#1E9E62", 2.5, 2.6, -D + 0.7),
    mesh(new THREE.BoxGeometry(1.8, 1.1, 0.05), "#9FC6E8", 1.5, 1.5, -D + 1.42),
    mesh(new THREE.BoxGeometry(0.9, 1.8, 0.05), "#6B8BA4", 3.6, 0.95, -D + 1.42),
  );
  const board = signBoard(sign, "#1E9E62", 6, 0.8);
  board.position.set(0, H + 0.6, -D + 1.6);
  group.add(board);
  // The island and the pumps, their displays facing the vehicle
  group.add(mesh(new THREE.BoxGeometry(1, 0.25, 4.4), "#8C8C8C", -0.7, 0.17, -4.2));
  const displays: { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture }[] = [];
  for (const z of [-3.2, -5.3]) {
    group.add(mesh(new THREE.BoxGeometry(0.7, 1.7, 0.9), "#F4F1EA", -0.7, 1.15, z), mesh(new THREE.BoxGeometry(0.72, 0.25, 0.92), "#1E9E62", -0.7, 2.05, z));
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: texture }));
    screen.rotation.y = Math.PI / 2;
    screen.position.set(-0.33, 1.55, z);
    group.add(screen);
    displays.push({ ctx: canvas.getContext("2d")!, texture });
  }
  let shown = -1;
  const meter = (n: number) => {
    const v = Math.round(n);
    if (v === shown) return;
    shown = v;
    for (const { ctx, texture } of displays) {
      ctx.fillStyle = "#10141A";
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = "#5CF08A";
      ctx.font = "700 84px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(v).padStart(4, "0"), 128, 68);
      texture.needsUpdate = true;
    }
  };
  meter(0);
  // The hose: from the pump to the tank while it fills
  const hose = mesh(new THREE.BoxGeometry(1.3, 0.08, 0.08), "#222222", 0.05, 1.25, -3.5);
  hose.visible = false;
  group.add(hose);
  // A sand bucket and an oil drum
  group.add(mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.5, 12), "#D62828", -W / 2 + 1.6, 0.35, -2.4));
  group.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12), "#B8322A", -W / 2 + 1.6, 0.6, -D + 1));
  return { group, meter, hose };
}

export const WARD_SPOTS: PlaceSpots = {
  width: 11,
  depth: 7.5,
  keeper: { x: -1.5, z: -4.3 },
  customer: { x: 1.2, z: -2.6 },
  stand: { x: 0.2, z: -5.6 },
  work: { x: -1.5, z: -4.3 },
  outside: { x: 0, z: 2.6 },
};

/** A hospital ward with no roof: three beds along the back wall (yours in the middle), a cabinet, the red cross. */
export function makeOpenWard(sign: string) {
  const { width: W, depth: D } = WARD_SPOTS;
  const group = openRoom(W, D, "#F4F6F8", "#CFE3EE", sign, "#D62828");
  for (const x of [-3.6, 0.2, 4]) {
    group.add(
      mesh(new THREE.BoxGeometry(1.6, 0.5, 3), "#C9CED6", x, 0.45, -D + 1.9),
      mesh(new THREE.BoxGeometry(1.5, 0.2, 2.9), "#FFFFFF", x, 0.8, -D + 1.9),
      mesh(new THREE.BoxGeometry(1.1, 0.2, 0.5), "#E8EEF4", x, 0.95, -D + 0.75),
      mesh(new THREE.BoxGeometry(1.52, 0.08, 1.6), "#7FB2D9", x, 0.92, -D + 2.4),
    );
  }
  // The red cross on the back wall, a cabinet, a drip stand
  group.add(
    mesh(new THREE.BoxGeometry(0.9, 0.28, 0.05), "#D62828", 2.1, 1.9, -D + 0.3),
    mesh(new THREE.BoxGeometry(0.28, 0.9, 0.05), "#D62828", 2.1, 1.9, -D + 0.3),
    mesh(new THREE.BoxGeometry(0.9, 1.4, 0.6), "#E8EEF4", -W / 2 + 0.8, 0.84, -2.2),
    mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), "#9AA1AC", 1.4, 1.24, -D + 1.2),
    mesh(new THREE.BoxGeometry(0.3, 0.4, 0.12), "#CFE6F7", 1.4, 2.2, -D + 1.2),
  );
  return group;
}

export const HIRE_SPOTS: PlaceSpots = {
  width: 8,
  depth: 5,
  keeper: { x: -1.6, z: -2.6 },
  customer: { x: 2.2, z: -1.8 },
  stand: { x: 0.4, z: -2.4 },
  work: { x: -0.6, z: -2.4 },
  outside: { x: 1.5, z: 2.6 },
};

/** A renter's spot in a side street: an umbrella over a stool, more for hire lined up, the A-frame sign. */
export function makeHireStand(kind: "bicycle" | "motorbike") {
  const group = new THREE.Group();
  // The umbrella (open) over the renter's stool
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 8, 1, true), material("#E5484D"));
  top.position.set(-2.8, 2.9, -3.4);
  group.add(top, mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6), "#5B6475", -2.8, 1.35, -3.4), mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), "#7A5230", -2.8, 0.25, -3.4));
  // More for hire, lined up behind
  for (const [x, colour] of [
    [1.4, "#1E9E62"],
    [3.1, "#F4B41A"],
  ] as const) {
    const v = (kind === "bicycle" ? buildBicycle() : buildMotorbike()).group;
    v.position.set(x, 0, -4.2);
    v.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material === material(BIKE) || o.material === material(MOTO))) o.material = material(colour);
    });
    group.add(v);
  }
  const board = signBoard(kind === "bicycle" ? "Bicycle hire" : "Okada hire", "#1E9E62", 1.8, 0.5);
  board.position.set(-0.6, 1.1, -0.6);
  group.add(board, mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), "#4A3A2A", -1.4, 0.55, -0.62), mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), "#4A3A2A", 0.2, 0.55, -0.62));
  return group;
}

export const ROADSIDE_SPOTS: PlaceSpots = {
  width: 8,
  depth: 5,
  keeper: { x: -1.3, z: -2.2 },
  customer: { x: 1.3, z: -2.0 },
  stand: { x: 0.2, z: -2.6 },
  work: { x: -1.3, z: -2.2 },
  outside: { x: 1.5, z: 2.6 },
};

/** Where paramedics treated someone by the road: their ambulance parked behind. */
export function makeRoadsideCare() {
  const group = new THREE.Group();
  const amb = makeAmbulance().group;
  amb.rotation.y = Math.PI / 2;
  amb.position.set(0, 0, -5);
  group.add(amb);
  return group;
}

/**
 * Something on the road during a hunt, where you were stopped: the kerb at the origin, the roadside along −z,
 * the road along +z. Your vehicle stands in the road (`stand`); you step off it to talk.
 */
export const ROAD_EVENT_SPOTS: PlaceSpots = {
  width: 9,
  depth: 5,
  keeper: { x: -1.3, z: -1.7 },
  customer: { x: 1.1, z: -0.9 },
  stand: { x: 2.8, z: 1.4 },
  work: { x: -1.3, z: -1.7 },
  outside: { x: 1.6, z: 1.6 },
};

/** A strip of pavement along the kerb. */
function pavement(W: number) {
  return mesh(new THREE.BoxGeometry(W, 0.12, 4.6), "#C9C2B4", 0, 0.06, -2.3);
}

/** A police checkpoint: a striped barrier half across the road, cones, the patrol van with its lights flashing. */
export function makeCheckpointScene() {
  const group = new THREE.Group();
  group.add(pavement(ROAD_EVENT_SPOTS.width));
  // The barrier, on two trestles, half into the road
  const pole = new THREE.Group();
  for (let i = 0; i < 6; i++) pole.add(mesh(new THREE.BoxGeometry(0.6, 0.22, 0.22), i % 2 ? "#FFFFFF" : "#D62828", -2.6 + i * 0.6, 1, 0));
  pole.position.set(-1.6, 0, 1.4);
  group.add(pole, mesh(new THREE.BoxGeometry(0.15, 1, 0.6), "#5B6475", -3.6, 0.5, 1.4), mesh(new THREE.BoxGeometry(0.15, 1, 0.6), "#5B6475", -0.6, 0.5, 1.4));
  // Cones along the lane
  for (const x of [0.6, 1.6, 2.6]) {
    group.add(mesh(new THREE.ConeGeometry(0.28, 0.75, 12), "#F07A28", x - 3.4, 0.38, 3));
    group.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 12), "#FFFFFF", x - 3.4, 0.4, 3));
  }
  // The patrol van on the pavement behind
  const van = new THREE.Group();
  van.add(
    mesh(new THREE.BoxGeometry(4.2, 1.8, 2), "#F4F1EA", 0, 1.2, 0),
    mesh(new THREE.BoxGeometry(4.22, 0.35, 2.02), "#1E3A6E", 0, 1.0, 0),
    mesh(new THREE.BoxGeometry(1.2, 0.6, 1.9), "#9FC6E8", 1.4, 1.75, 0),
  );
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), glow("#FF3B30"));
  red.position.set(0.3, 2.2, -0.3);
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), glow("#3D7BFF"));
  blue.position.set(0.3, 2.2, 0.3);
  van.add(red, blue);
  for (const [x, z] of [
    [-1.4, -1],
    [1.4, -1],
    [-1.4, 1],
    [1.4, 1],
  ]) {
    const w = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 14), "#1D1D1D", x, 0.4, z);
    w.rotation.x = Math.PI / 2;
    van.add(w);
  }
  van.position.set(1.8, 0, -3.2);
  group.add(van);
  return { group, lights: [red, blue] };
}

/** By the road where a traveller is stranded: a shade tree, a street lamp, their bag at their feet. */
export function makeTravellerScene() {
  const group = new THREE.Group();
  group.add(pavement(ROAD_EVENT_SPOTS.width));
  group.add(mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.4, 8), "#6B4A2B", -3.4, 1.2, -3.2));
  for (const [x, y, z, r] of [
    [-3.4, 3, -3.2, 1.4],
    [-2.5, 2.6, -2.8, 0.9],
    [-4.2, 2.6, -3.4, 0.9],
  ]) {
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), material("#2E7D4F"));
    leaves.position.set(x, y, z);
    group.add(leaves);
  }
  group.add(
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 6), "#5B6475", 3.4, 1.8, -0.6),
    mesh(new THREE.BoxGeometry(0.9, 0.08, 0.2), "#5B6475", 3.0, 3.6, -0.6),
    mesh(new THREE.BoxGeometry(0.7, 0.5, 0.45), "#7A4B22", -0.6, 0.37, -1.9),
    mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), "#4A2E14", -0.6, 0.67, -1.9),
  );
  return group;
}

/** A street seller's stall by the road: an umbrella over a table of oranges and snacks, a cooler, a sign. */
export function makeStallScene(sign: string) {
  const group = new THREE.Group();
  group.add(pavement(ROAD_EVENT_SPOTS.width));
  // The umbrella over the table
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.7, 10, 1, true), material("#E5484D"));
  top.position.set(-2.4, 2.8, -2.6);
  group.add(top, mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6), "#5B6475", -2.4, 1.35, -2.6));
  // The table: oranges in a pyramid, snacks in packets
  group.add(table(-2.4, -2.6, 2.2, 1.1));
  for (const [x, y, z] of [
    [-2.9, 1.25, -2.6],
    [-2.6, 1.25, -2.6],
    [-2.3, 1.25, -2.6],
    [-2.75, 1.48, -2.6],
    [-2.45, 1.48, -2.6],
    [-2.6, 1.7, -2.6],
  ]) {
    const orange = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), material("#F28C28"));
    orange.position.set(x, y, z);
    group.add(orange);
  }
  group.add(mesh(new THREE.BoxGeometry(0.4, 0.3, 0.25), "#F4B41A", -1.8, 1.27, -2.5), mesh(new THREE.BoxGeometry(0.4, 0.3, 0.25), "#C89B5A", -1.8, 1.27, -2.85));
  // A cooler of cold drinks, and the hand-painted sign
  group.add(mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), "#2F6FEB", -0.6, 0.42, -3.2), mesh(new THREE.BoxGeometry(0.92, 0.12, 0.62), "#F4F1EA", -0.6, 0.76, -3.2));
  const board = signBoard(sign, "#F07A28", 2.6, 0.55);
  board.position.set(-2.4, 2.1, -3.5);
  group.add(board);
  return group;
}

/** A board of departures: a title and up to five lines, in amber on black. */
function departuresBoard(title: string, rows: string[], width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = Math.round((768 * height) / width);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#10141A";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#F4B41A";
  g.font = "800 54px system-ui, sans-serif";
  g.fillText(title.toUpperCase(), 28, 66);
  g.font = "600 40px ui-monospace, monospace";
  g.fillStyle = "#FFD45C";
  rows.slice(0, 5).forEach((r, i) => g.fillText(r.toUpperCase().slice(0, 30), 28, 130 + i * 56));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
}

export const TICKET_SPOTS: PlaceSpots = {
  width: 11,
  depth: 7.5,
  keeper: { x: -1.2, z: -5.7 },
  customer: { x: -1.2, z: -3.4 },
  stand: { x: -1.2, z: -4.6 },
  work: { x: 0.6, z: -5.7 },
  outside: { x: 0, z: 2.6 },
};

/**
 * A railway station's ticket hall with no roof: the counter with its glass windows and the clerk behind, the
 * departures board, benches, the turnstile to the platform, and a train waiting beyond the back wall.
 * `ticket(true)` shows the printed ticket on the counter.
 */
export function makeTicketHall(station: string, departures: string[]) {
  const { width: W, depth: D } = TICKET_SPOTS;
  const group = openRoom(W, D, "#E3E8EE", "#B9B4AA", `${station} station`, "#1E9E62");
  // The counter, with glass above it and two windows
  group.add(
    mesh(new THREE.BoxGeometry(5, 1.1, 0.7), "#1E9E62", -1.5, 0.69, -4.6),
    mesh(new THREE.BoxGeometry(5.05, 0.08, 0.75), "#F4F1EA", -1.5, 1.27, -4.6),
  );
  const glass = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 0.05), new THREE.MeshLambertMaterial({ color: "#BFDDF2", transparent: true, opacity: 0.35 }));
  glass.position.set(-1.5, 1.9, -4.6);
  group.add(glass, mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), "#5B6475", -2.6, 1.9, -4.6), mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), "#5B6475", 0, 1.9, -4.6));
  // The ticket printer behind, and the ticket itself when printed
  group.add(mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), "#3A3F47", 0.6, 1.05, -5.4));
  const ticket = mesh(new THREE.BoxGeometry(0.5, 0.03, 0.28), "#F4B41A", -1.2, 1.33, -4.35);
  ticket.visible = false;
  group.add(ticket);
  // The departures board, benches, the turnstile to the platform
  const board = departuresBoard("Departures", departures, 3, 1.6);
  board.position.set(3, 2.1, -D + 0.27);
  group.add(board);
  for (const z of [-2.2, -3.6]) group.add(mesh(new THREE.BoxGeometry(2.6, 0.12, 0.6), "#7A5230", 3.2, 0.62, z), mesh(new THREE.BoxGeometry(2.6, 0.5, 0.1), "#7A5230", 3.2, 0.9, z - 0.3));
  group.add(mesh(new THREE.BoxGeometry(0.2, 1, 1.2), "#9AA1AC", W / 2 - 1.8, 0.64, -D + 1.2), mesh(new THREE.BoxGeometry(0.2, 1, 1.2), "#9AA1AC", W / 2 - 0.8, 0.64, -D + 1.2));
  // The platform and the train beyond the back wall
  group.add(mesh(new THREE.BoxGeometry(W + 4, 0.4, 2.2), "#C9C2B4", 0, 0.2, -D - 1.3));
  for (let i = 0; i < 2; i++) {
    const car = makeTrainCar(i === 0);
    car.rotation.y = Math.PI / 2;
    car.scale.setScalar(0.85);
    car.position.set(-4 + i * 8.6, 0, -D - 3.6);
    group.add(car);
  }
  return { group, ticket: (shown: boolean) => (ticket.visible = shown) };
}

export const TERMINAL_SPOTS: PlaceSpots = {
  width: 12,
  depth: 8,
  keeper: { x: -1.2, z: -5.1 },
  customer: { x: -1.2, z: -3.2 },
  stand: { x: 0.25, z: -3.9 },
  work: { x: -1.2, z: -5.1 },
  outside: { x: 0, z: 2.6 },
};

/**
 * An airport terminal's check-in hall with no roof: three desks (airline colours), the baggage scale and the belt
 * behind them, the departures board, queue posts, and a plane at the gate beyond the back wall. `bag(at)` puts your
 * bag by you, on the scale, or along the belt (0–1), or away (null).
 */
export function makeTerminal(airport: string, departures: string[]) {
  const { width: W, depth: D } = TERMINAL_SPOTS;
  const group = openRoom(W, D, "#EEF1F4", "#D8DDE3", airport, "#2F6FEB", 3.8);
  // The desks, each with its airline's colour
  for (const [x, colour] of [
    [-3.6, "#D62828"],
    [-1.2, "#1E9E62"],
    [1.2, "#7C4DCC"],
  ] as const) {
    group.add(mesh(new THREE.BoxGeometry(1.8, 1.1, 0.8), "#F4F1EA", x, 0.69, -4.4), mesh(new THREE.BoxGeometry(1.82, 0.3, 0.82), colour, x, 1.1, -4.4));
    group.add(mesh(new THREE.BoxGeometry(0.5, 0.35, 0.05), "#10141A", x - 0.3, 1.45, -4.6));
  }
  // The scale beside the middle desk, the belt behind the desks
  group.add(mesh(new THREE.BoxGeometry(0.8, 0.25, 0.8), "#5B6475", 0.25, 0.27, -3.9));
  group.add(mesh(new THREE.BoxGeometry(W - 2, 0.5, 0.9), "#2A2A2A", 0, 0.39, -5.9), mesh(new THREE.BoxGeometry(W - 2, 0.06, 0.8), "#3A3F47", 0, 0.66, -5.9));
  const bag = new THREE.Group();
  bag.add(mesh(new THREE.BoxGeometry(0.7, 0.5, 0.35), "#2F6FEB", 0, 0.25, 0), mesh(new THREE.BoxGeometry(0.25, 0.12, 0.06), "#1B2433", 0, 0.56, 0));
  group.add(bag);
  // The departures board, queue posts with a strap
  const board = departuresBoard("Departures", departures, 3.4, 1.8);
  board.position.set(3.4, 2.4, -D + 0.27);
  group.add(board);
  for (const x of [-4.2, -2.4, -0.6]) group.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, 1, 8), "#C9CED6", x, 0.64, -2.2));
  group.add(mesh(new THREE.BoxGeometry(3.6, 0.08, 0.04), "#D62828", -2.4, 1.05, -2.2));
  // The plane at the gate beyond the back wall
  const plane = makePlane().group;
  plane.rotation.y = Math.PI / 2;
  plane.scale.setScalar(0.35);
  plane.position.set(0, 0, -D - 5);
  group.add(plane);
  const place = (at: "you" | "scale" | number | null) => {
    bag.visible = at !== null;
    if (at === "you") bag.position.set(-0.4, 0.14, -3.2);
    else if (at === "scale") bag.position.set(0.25, 0.4, -3.9);
    else if (typeof at === "number") bag.position.set(0.25 + at * (W / 2 - 1.5), 0.69, -5.9);
  };
  place("you");
  return { group, bag: place };
}

/** A landmark's plaza or the Lamp's spot, by the road where you are: the host stands by it, you come up to talk. */
export const PLAZA_SPOTS: PlaceSpots = {
  width: 9,
  depth: 6,
  keeper: { x: -1.2, z: -2.4 },
  customer: { x: 1.2, z: -1.6 },
  stand: { x: -0.2, z: -3.6 },
  work: { x: -1.2, z: -2.4 },
  outside: { x: 1.6, z: 2.4 },
};

/** A palm tree. */
function palm(x: number, z: number) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.14, 0.22, 3.2, 8), "#8B6A43", 0, 1.6, 0);
  trunk.rotation.z = 0.08;
  g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = mesh(new THREE.BoxGeometry(1.8, 0.06, 0.4), "#2E7D4F", 0.8, 3.15, 0);
    const holder = new THREE.Group();
    holder.rotation.y = (i / 6) * Math.PI * 2;
    leaf.rotation.z = -0.35;
    holder.add(leaf);
    holder.position.y = 0;
    g.add(holder);
  }
  g.position.set(x, 0, z);
  return g;
}

/** A landmark's plaza: paving, a stone plinth with the gold star, the board with its name, palms and a bench. */
export function makeLandmarkPlaza(name: string) {
  const group = new THREE.Group();
  const { width: W, depth: D } = PLAZA_SPOTS;
  group.add(mesh(new THREE.BoxGeometry(W, 0.12, D), "#D8CFC0", 0, 0.06, -D / 2));
  for (let i = 0; i < 4; i++) group.add(mesh(new THREE.BoxGeometry(W, 0.02, 0.05), "#C2B8A6", 0, 0.13, -0.8 - i * 1.4));
  const marker = makeLandmarkMarker();
  marker.group.position.set(PLAZA_SPOTS.stand.x, 0.12, PLAZA_SPOTS.stand.z - 0.6);
  group.add(marker.group);
  const board = signBoard(name, "#7A5230", 3.2, 0.7);
  board.position.set(2.2, 1.5, -D + 0.6);
  group.add(board, mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), "#4A3A2A", 1, 0.6, -D + 0.58), mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), "#4A3A2A", 3.4, 0.6, -D + 0.58));
  group.add(palm(-3.6, -4.6), palm(3.8, -2.2));
  group.add(mesh(new THREE.BoxGeometry(2, 0.12, 0.5), "#7A5230", -2.8, 0.55, -1.2), mesh(new THREE.BoxGeometry(0.1, 0.5, 0.4), "#5B6475", -3.6, 0.3, -1.2), mesh(new THREE.BoxGeometry(0.1, 0.5, 0.4), "#5B6475", -2, 0.3, -1.2));
  return { group, star: marker.star };
}

/**
 * Where the Lamp sends you (a Detour): a rug by the road, a brass lamp glowing on a stool, purple smoke curling up;
 * `reward(true)` lifts the prize out of the lamp, glowing.
 */
export function makeLampShrine() {
  const group = new THREE.Group();
  const { stand } = PLAZA_SPOTS;
  const rug = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 2.2), material("#7A2232"));
  rug.position.set(stand.x, 0.03, stand.z);
  group.add(rug, mesh(new THREE.BoxGeometry(3.0, 0.06, 1.8), "#C9A227", stand.x, 0.04, stand.z), mesh(new THREE.BoxGeometry(2.7, 0.07, 1.5), "#7A2232", stand.x, 0.05, stand.z));
  group.add(mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.7, 10), "#4A2E14", stand.x, 0.4, stand.z));
  const lamp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), glow("#F4B41A"));
  body.scale.set(1.3, 0.7, 0.9);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, 0.6, 8), glow("#F4B41A"));
  spout.rotation.z = -1.1;
  spout.position.set(0.45, 0.12, 0);
  lamp.add(body, spout);
  lamp.position.set(stand.x, 0.95, stand.z);
  group.add(lamp);
  const smoke: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: "#B48CFF", transparent: true, opacity: 0.5 }));
    puff.position.set(stand.x + 0.7, 1.3, stand.z);
    group.add(puff);
    smoke.push(puff);
  }
  const prize = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), glow("#C3A6FF"));
  prize.position.set(stand.x, 1.8, stand.z);
  prize.visible = false;
  group.add(prize);
  return { group, smoke, prize, reward: (shown: boolean) => (prize.visible = shown) };
}

/** The key's trial: the Keeper by the open chest in a ring of standing stones; you stand before them. */
export const TRIAL_SPOTS: PlaceSpots = {
  width: 10,
  depth: 8,
  keeper: { x: -1.4, z: -4.2 },
  customer: { x: 1.2, z: -2.6 },
  stand: { x: 0, z: -4.4 },
  work: { x: -1.4, z: -4.2 },
  outside: { x: 1.6, z: 2.4 },
};

/**
 * Where a hunt key is won: a ring of standing stones on trodden earth, two torches burning, the chest open in the
 * middle with the key's gold light rising out of it. `flames` flicker; `glow` is the light over the chest.
 */
export function makeKeyCircle() {
  const group = new THREE.Group();
  const { stand } = TRIAL_SPOTS;
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.1, 32), material("#8C7A5B"));
  ground.position.set(stand.x, 0.05, stand.z);
  group.add(ground);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.05, 6, 40), glow("#F4B41A"));
  inner.rotation.x = Math.PI / 2;
  inner.position.set(stand.x, 0.12, stand.z);
  group.add(inner);
  // The standing stones (a gap at the front, where you come in)
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 0.62 + (i / 8) * Math.PI * 1.76;
    const h = 1.6 + (i % 3) * 0.35;
    const stone = mesh(new THREE.BoxGeometry(0.6, h, 0.45), "#8A8F96", stand.x + Math.cos(a) * 4, h / 2, stand.z - Math.sin(a) * 4);
    stone.rotation.y = -a;
    group.add(stone);
  }
  // Two torches either side of the chest
  const flames: THREE.Mesh[] = [];
  for (const x of [-2.4, 2.4]) {
    group.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.8, 6), "#4A2E14", stand.x + x, 0.9, stand.z - 0.8));
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 8), glow("#FF8A1F"));
    flame.position.set(stand.x + x, 2.05, stand.z - 0.8);
    group.add(flame);
    flames.push(flame);
  }
  // The chest, open, its gold light rising
  const chest = makeChest();
  chest.ring.visible = false;
  chest.group.position.set(stand.x, 0.1, stand.z);
  chest.group.scale.setScalar(0.8);
  group.add(chest.group);
  const light = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 2.6, 16, 1, true), new THREE.MeshBasicMaterial({ color: "#FFD45C", transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
  light.position.set(stand.x, 2.2, stand.z);
  group.add(light);
  return { group, flames, glow: light };
}

/**
 * The Djinn's chamber (design doc 7.6), open to the sky: three bays, one per room, the vault door at the back.
 * `keeper` is where the Djinn hovers; `rooms[i]` where you stand to work on room i.
 */
export const VAULT_SPOTS: PlaceSpots & { rooms: { x: number; z: number }[] } = {
  width: 13,
  depth: 8.5,
  keeper: { x: 0, z: -7.2 },
  customer: { x: -4.3, z: -2.4 },
  stand: { x: 0, z: -8.2 },
  work: { x: 0, z: -7.2 },
  outside: { x: 0, z: 2.6 },
  rooms: [
    { x: -4.3, z: -2.4 },
    { x: 0, z: -1.2 },
    { x: 4.3, z: -2.4 },
  ],
};

/**
 * Sandstone walls, a knee-high front with the doorway; in bay I the cipher on a glowing tablet and the wheel before it,
 * in bay II the cursed floor (rows × cols tiles, the stones you step on glowing), in bay III the idol's scales; the
 * golden vault door at the back. Set them as the puzzle goes: `wheel(n)`, `path(cols)`, `scales(stones, tilt)`,
 * `open()` (the door swings, the Wonder's light rises).
 */
export function makeDjinnVault(place: string, cipher: string, rows: number, cols: number) {
  const { width: W, depth: D } = VAULT_SPOTS;
  const group = openRoom(W, D, "#C9A66B", "#B08D57", `The Chamber of ${place}`, "#7C4DCC", 3.6);
  // Low walls between the bays
  for (const x of [-2.2, 2.2]) group.add(mesh(new THREE.BoxGeometry(0.3, 1.3, D - 2.6), "#B8925A", x, 0.79, -D / 2 - 0.6));
  // ---- Bay I: the cipher on a glowing tablet, the wheel on its pedestal
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#1B0F2E";
  g.fillRect(0, 0, 768, 384);
  g.fillStyle = "#C89BFF";
  g.font = "700 46px ui-monospace, monospace";
  g.textAlign = "center";
  const words = cipher.split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const last = lines.at(-1);
    if (last !== undefined && (last + " " + w).length <= 16) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  lines.slice(0, 5).forEach((l, i) => g.fillText(l, 384, 80 + i * 68));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const tablet = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({ map: texture }));
  tablet.position.set(-4.3, 2.0, -D + 0.28);
  group.add(tablet, mesh(new THREE.CylinderGeometry(0.3, 0.4, 1, 10), "#8A6B3E", -4.3, 0.64, -4.6));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 8, 24), glow("#F4B41A"));
  wheel.position.set(-4.3, 1.55, -4.6);
  const spoke = mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), "#F4B41A");
  wheel.add(spoke);
  group.add(wheel);
  // ---- Bay II: the cursed floor
  const tileW = Math.min(0.9, 3.4 / cols);
  const tileD = Math.min(0.9, 4.2 / rows);
  const tiles: THREE.Mesh[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: THREE.Mesh[] = [];
    for (let c = 0; c < cols; c++) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(tileW * 0.9, 0.08, tileD * 0.9), material("#8C7A5B"));
      // Row 0 is the bottom row: nearest the door.
      tile.position.set((c - (cols - 1) / 2) * tileW, 0.18, -1.9 - r * tileD);
      group.add(tile);
      row.push(tile);
    }
    tiles.push(row);
  }
  // ---- Bay III: the idol's scales
  const scales = new THREE.Group();
  scales.position.set(4.3, 0.14, -4.4);
  scales.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.2, 8), "#E0A82E", 0, 1.1, 0), mesh(new THREE.BoxGeometry(1, 0.12, 0.5), "#8A6B3E", 0, 0.06, 0));
  const beam = new THREE.Group();
  beam.position.y = 2.2;
  beam.add(mesh(new THREE.BoxGeometry(2.6, 0.1, 0.1), "#E0A82E"));
  const stonesPan = new THREE.Group();
  stonesPan.position.set(-1.2, -0.6, 0);
  stonesPan.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16), "#E0A82E"));
  const idolPan = new THREE.Group();
  idolPan.position.set(1.2, -0.6, 0);
  idolPan.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16), "#E0A82E"), mesh(new THREE.BoxGeometry(0.3, 0.55, 0.3), "#F4B41A", 0, 0.3, 0));
  beam.add(stonesPan, idolPan);
  scales.add(beam);
  group.add(scales);
  const stones: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), material("#7A7F86"));
    s.position.set(((i % 3) - 1) * 0.22, 0.12 + Math.floor(i / 3) * 0.18, ((i % 2) - 0.5) * 0.18);
    s.visible = false;
    stonesPan.add(s);
    stones.push(s);
  }
  // ---- The vault door, and the Wonder's light behind it
  const door = new THREE.Group();
  door.position.set(-1.1, 0, -D + 0.3);
  const leaf = mesh(new THREE.BoxGeometry(2.2, 2.8, 0.2), "#C9A227", 1.1, 1.54, 0);
  door.add(leaf, mesh(new THREE.TorusGeometry(0.35, 0.06, 6, 18), "#7C4DCC", 1.1, 1.7, 0.12));
  group.add(door);
  const light = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 3.2, 16, 1, true), new THREE.MeshBasicMaterial({ color: "#E8D8FF", transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
  light.position.set(0, 1.8, -D + 0.9);
  light.visible = false;
  const prize = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), glow("#C3A6FF"));
  prize.position.set(0, 2.2, -D + 0.9);
  prize.visible = false;
  group.add(light, prize);
  return {
    group,
    prize,
    wheel: (n: number) => (wheel.rotation.z = (-n / 26) * Math.PI * 2),
    path: (cols: number[]) =>
      tiles.forEach((row, r) => row.forEach((tile, c) => (tile.material = material(cols[r] === c ? "#F4B41A" : "#8C7A5B")))),
    scales: (count: number, tilt: number) => {
      stones.forEach((s, i) => (s.visible = i < count));
      beam.rotation.z = (tilt * Math.PI) / 180;
      stonesPan.rotation.z = idolPan.rotation.z = -beam.rotation.z;
    },
    open: () => {
      door.rotation.y = -1.9;
      light.visible = prize.visible = true;
    },
  };
}

/** The open chest with the key's gold light rising, at the middle of a key's scene. */
function keyChest(group: THREE.Group) {
  const { stand } = TRIAL_SPOTS;
  const chest = makeChest();
  chest.ring.visible = false;
  chest.group.position.set(stand.x, 0.1, stand.z);
  chest.group.scale.setScalar(0.8);
  const light = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 2.6, 16, 1, true), new THREE.MeshBasicMaterial({ color: "#FFD45C", transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
  light.position.set(stand.x, 2.2, stand.z);
  group.add(chest.group, light);
  return light;
}

/** A disc of ground under a scene. */
function ground(colour: string, r = 5) {
  const g = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.1, 32), material(colour));
  g.position.set(0, 0.05, TRIAL_SPOTS.stand.z + 0.4);
  return g;
}

function tree(x: number, z: number, r = 1.2) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.22, 2, 8), "#6B4A2B", 0, 1, 0));
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), material("#2E7D4F"));
  leaves.position.y = 2.4;
  g.add(leaves);
  g.position.set(x, 0, z);
  return g;
}

function umbrella(x: number, z: number, colour: string, r = 1.3, h = 2.4) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.ConeGeometry(r, 0.5, 8, 1, true), material(colour));
  top.position.y = h;
  g.add(top, mesh(new THREE.CylinderGeometry(0.04, 0.04, h, 6), "#5B6475", 0, h / 2, 0));
  g.position.set(x, 0, z);
  return g;
}

/**
 * Where a key is won, as the place it is (src/game/keyScenes.ts): a market, a monument's plaza, a beach, a park, a
 * motor park, a school, a football pitch, a palace, or the stone circle anywhere else. Each has the open chest with the
 * key's light in the middle (TRIAL_SPOTS.stand); `flames` flicker where there are any; `glow` is the key's light.
 */
export function makeKeyScene(scene: string, sign: string) {
  if (scene === "circle" || !scene) {
    const c = makeKeyCircle();
    return { group: c.group, flames: c.flames, glow: c.glow };
  }
  const group = new THREE.Group();
  const flames: THREE.Mesh[] = [];
  const { stand } = TRIAL_SPOTS;
  const board = (text: string, colour: string, x: number, z: number, w = 2.6) => {
    const b = signBoard(text, colour, w, 0.55);
    b.position.set(x, 2.3, z);
    group.add(b, mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), "#4A3A2A", x - w / 2 + 0.2, 1.05, z - 0.02), mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), "#4A3A2A", x + w / 2 - 0.2, 1.05, z - 0.02));
  };

  if (scene === "market") {
    group.add(ground("#C9A27A"));
    // Stalls round the chest: tables under bright umbrellas, piled with tomatoes, peppers and yams; baskets
    const stalls: [number, number, string][] = [
      [-3.2, -6.2, "#E5484D"],
      [0, -7.6, "#F4B41A"],
      [3.2, -6.2, "#1E9E62"],
      [3.6, -2.6, "#2F6FEB"],
    ];
    for (const [x, z, colour] of stalls) {
      group.add(table(x, z, 1.8, 1), umbrella(x, z, colour, 1.3));
      for (let i = 0; i < 5; i++) {
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), material(i % 2 ? "#D62828" : "#F28C28"));
        fruit.position.set(x - 0.5 + i * 0.25, 1.25, z);
        group.add(fruit);
      }
      group.add(mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 8), "#8A5A36", x + 0.6, 1.3, z - 0.2));
    }
    for (const [x, z] of [
      [-3.8, -2.6],
      [-1.6, -1.6],
    ])
      group.add(mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.45, 12), "#C89B5A", x, 0.3, z));
    board(sign || "Market", "#F07A28", 0, -8.6, 2.8);
  } else if (scene === "landmark") {
    const plaza = makeLandmarkPlaza(sign || "Monument");
    plaza.group.position.z = -1;
    group.add(plaza.group);
  } else if (scene === "beach") {
    group.add(ground("#E8D3A2"));
    // The sea along the back, a canoe drawn up, palms and a beach umbrella with a chair
    const sea = new THREE.Mesh(new THREE.BoxGeometry(14, 0.08, 3), new THREE.MeshLambertMaterial({ color: "#2F8FD6", transparent: true, opacity: 0.85 }));
    sea.position.set(0, 0.06, stand.z - 4.6);
    group.add(sea, mesh(new THREE.BoxGeometry(14, 0.1, 0.3), "#F4F1EA", 0, 0.08, stand.z - 3.1));
    const canoe = mesh(new THREE.BoxGeometry(3.4, 0.45, 0.8), "#7A4B22", -2.6, 0.3, stand.z - 2.2);
    canoe.rotation.y = 0.35;
    group.add(canoe, palm(-4, -1.6), palm(4.2, -6.4), umbrella(3.2, -2.4, "#E5484D", 1.2, 2.2), mesh(new THREE.BoxGeometry(0.6, 0.12, 1.2), "#F4F1EA", 3.2, 0.45, -1.6));
  } else if (scene === "park") {
    group.add(ground("#6FB559"));
    // Trees, a fountain, flower beds, a bench
    group.add(tree(-3.6, -6.6), tree(3.8, -6.8, 1.4), tree(-4.2, -2.2, 1));
    const fountain = new THREE.Group();
    fountain.add(mesh(new THREE.CylinderGeometry(1, 1.1, 0.5, 18), "#C9C2B4", 0, 0.3, 0));
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 18), glow("#7FC1EE"));
    water.position.y = 0.55;
    fountain.add(water, mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.2, 8), "#C9C2B4", 0, 0.9, 0));
    fountain.position.set(3, 0, -2.4);
    group.add(fountain);
    for (const x of [-1.8, 1.8]) group.add(mesh(new THREE.BoxGeometry(1.4, 0.25, 0.6), "#E85D9E", x, 0.2, -7.6));
    group.add(mesh(new THREE.BoxGeometry(2, 0.12, 0.5), "#7A5230", -2.6, 0.55, -4.8), mesh(new THREE.BoxGeometry(2, 0.6, 0.1), "#7A5230", -2.6, 0.85, -5.05));
    board(sign || "Park", "#1E9E62", 0, -8.6);
  } else if (scene === "motor_park") {
    group.add(ground("#6E6A64"));
    // A danfo waiting, the shelter, a stack of tyres, the motor park's sign
    const bus = makeBus();
    bus.rotation.y = Math.PI / 2;
    bus.scale.setScalar(0.85);
    bus.position.set(0, 0, stand.z - 3.4);
    group.add(bus);
    group.add(
      mesh(new THREE.BoxGeometry(0.15, 2.2, 0.15), "#5B6475", -4.4, 1.1, -2),
      mesh(new THREE.BoxGeometry(0.15, 2.2, 0.15), "#5B6475", -4.4, 1.1, -4),
      mesh(new THREE.BoxGeometry(1.6, 0.12, 2.4), "#1E9E62", -4, 2.25, -3),
      mesh(new THREE.BoxGeometry(0.4, 0.4, 1.8), "#7A5230", -4.2, 0.4, -3),
    );
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.14, 8, 18), material("#2A2A2A"));
      t.rotation.x = Math.PI / 2;
      t.position.set(3.8, 0.25 + i * 0.26, -2.2);
      group.add(t);
    }
    board(sign || "Motor park", "#F4B41A", 2.6, -8.8);
  } else if (scene === "school") {
    group.add(ground("#B8925A"));
    // The classroom block, the flagpole with the Nigerian flag, the gate
    group.add(mesh(new THREE.BoxGeometry(9, 2.6, 1.6), "#F4F1EA", 0, 1.4, stand.z - 4), mesh(new THREE.BoxGeometry(9.2, 0.25, 1.9), "#B8322A", 0, 2.8, stand.z - 4));
    for (let i = 0; i < 6; i++) group.add(mesh(new THREE.BoxGeometry(0.8, 0.7, 0.05), "#9FC6E8", -3.5 + i * 1.4, 1.6, stand.z - 3.17));
    group.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 6), "#9AA1AC", 3.6, 2, -2.4));
    ["#008751", "#FFFFFF", "#008751"].forEach((c, i) => group.add(mesh(new THREE.BoxGeometry(0.3, 0.6, 0.03), c, 3.78 + i * 0.3, 3.6, -2.4)));
    group.add(mesh(new THREE.BoxGeometry(0.4, 2, 0.4), "#7A5230", -3.6, 1, 0.4), mesh(new THREE.BoxGeometry(0.4, 2, 0.4), "#7A5230", -1.4, 1, 0.4));
    board(sign || "Government College", "#1E3A6E", 0, stand.z - 4.9, 4.4);
  } else if (scene === "stadium") {
    group.add(ground("#3E9B4F"));
    // The lines, a goal with its net, a corner flag, the stands behind
    group.add(mesh(new THREE.BoxGeometry(9, 0.02, 0.1), "#FFFFFF", 0, 0.12, -1.2), mesh(new THREE.BoxGeometry(0.1, 0.02, 6), "#FFFFFF", 0, 0.12, -4.2));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.05, 6, 32), material("#FFFFFF"));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.12, -4.2);
    group.add(ring);
    const goal = new THREE.Group();
    goal.add(mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12), "#FFFFFF", -1.8, 0.9, 0), mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12), "#FFFFFF", 1.8, 0.9, 0), mesh(new THREE.BoxGeometry(3.7, 0.12, 0.12), "#FFFFFF", 0, 1.8, 0));
    const net = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.7), new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    net.position.set(0, 0.9, -0.6);
    goal.add(net);
    goal.position.set(0, 0, stand.z - 3.6);
    group.add(goal);
    for (let i = 0; i < 3; i++) group.add(mesh(new THREE.BoxGeometry(11, 0.5, 0.9), i % 2 ? "#2F6FEB" : "#E5484D", 0, 0.25 + i * 0.5, stand.z - 5.2 - i * 0.9));
    group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), "#F4F1EA", 4.4, 0.7, -1.2), mesh(new THREE.BoxGeometry(0.03, 0.35, 0.45), "#F4B41A", 4.4, 1.25, -1.0));
  } else if (scene === "palace") {
    group.add(ground("#B5651D"));
    // The palace wall and its gate, talking drums, the royal umbrella over the chest, torches
    group.add(mesh(new THREE.BoxGeometry(11, 2.6, 0.6), "#C1440E", 0, 1.3, stand.z - 3.6));
    group.add(mesh(new THREE.BoxGeometry(2.2, 3.2, 0.7), "#7A2F0E", 0, 1.6, stand.z - 3.55), mesh(new THREE.BoxGeometry(1.6, 2.4, 0.72), "#3A1F0A", 0, 1.2, stand.z - 3.5));
    for (let i = 0; i < 9; i++) group.add(mesh(new THREE.BoxGeometry(0.5, 0.35, 0.62), "#F4F1EA", -5 + i * 1.25, 2.75, stand.z - 3.6));
    group.add(umbrella(stand.x, stand.z, "#F4B41A", 1.6, 3));
    for (const x of [-2.6, -2]) {
      const drum = mesh(new THREE.CylinderGeometry(0.25, 0.18, 0.9, 12), "#7A4B22", x, 0.5, -2.2);
      group.add(drum, mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 12), "#F4F1EA", x, 0.96, -2.2));
    }
    for (const x of [-2.8, 2.8]) {
      group.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.8, 6), "#4A2E14", x, 0.9, stand.z - 2.4));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 8), glow("#FF8A1F"));
      flame.position.set(x, 2.05, stand.z - 2.4);
      group.add(flame);
      flames.push(flame);
    }
  }
  const light = keyChest(group);
  return { group, flames, glow: light };
}

export const VULCANIZER_SPOTS: PlaceSpots = {
  width: 9,
  depth: 6,
  keeper: { x: -2, z: -3.4 },
  customer: { x: 2.2, z: -2 },
  stand: { x: 0.3, z: -3.2 },
  work: { x: -0.9, z: -3.3 },
  outside: { x: 1.5, z: 2.4 },
};

/**
 * A vulcanizer's spot by the road: the compressor with its gauge and hose, a pile of old tyres, the basin of water
 * for finding punctures, a board with a rim and the sign, a bench. `running(on)` shakes the compressor.
 */
export function makeVulcanizer(sign: string) {
  const group = new THREE.Group();
  group.add(mesh(new THREE.BoxGeometry(9, 0.1, 6), "#9C8E7C", 0, 0.05, -3));
  // The compressor
  const compressor = new THREE.Group();
  compressor.add(
    mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 14), "#D62828", 0, 0.75, 0),
    mesh(new THREE.BoxGeometry(0.7, 0.5, 0.6), "#3A3F47", 0, 1.75, 0),
    mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 14), "#F4F1EA", 0.36, 1.75, 0),
  );
  compressor.children[0].rotation.z = Math.PI / 2;
  compressor.position.set(-2.4, 0, -4.8);
  group.add(compressor);
  const hose = mesh(new THREE.BoxGeometry(2.2, 0.06, 0.06), "#1D1D1D", -1, 0.35, -4);
  hose.rotation.y = -0.5;
  group.add(hose);
  // Old tyres, a basin of water, a bench
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.15, 8, 18), material("#2A2A2A"));
    t.rotation.x = Math.PI / 2;
    t.position.set(3.2, 0.25 + i * 0.28, -4.6);
    group.add(t);
  }
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.4, 0.3, 14), material("#5B6475"));
  water.position.set(1.8, 0.25, -4.9);
  const surface = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 14), glow("#7FC1EE"));
  surface.position.set(1.8, 0.4, -4.9);
  group.add(water, surface, mesh(new THREE.BoxGeometry(1.8, 0.12, 0.45), "#7A5230", -3.4, 0.5, -2.2));
  // The board: a rim hanging, the sign
  group.add(mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), "#4A3A2A", -0.8, 1.2, -5.6), mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), "#4A3A2A", 1.6, 1.2, -5.6));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 6, 18), material("#9AA1AC"));
  rim.position.set(0.4, 1.4, -5.55);
  group.add(rim);
  const board = signBoard(sign, "#F07A28", 2.6, 0.55);
  board.position.set(0.4, 2.3, -5.55);
  group.add(board);
  let shake = 0;
  return {
    group,
    running(on: boolean, t: number) {
      shake = on ? Math.sin(t * 40) * 0.03 : 0;
      compressor.position.x = -2.4 + shake;
    },
  };
}

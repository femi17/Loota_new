/**
 * The game's sounds and buzzes (owner, 24 Oct 2026: "thrill & suspense… sound & haptics first"). Every sound is made
 * here with Web Audio (no files to download): the detector's heartbeat, a talking-drum roll as a chest rises, the last
 * seconds ticking, a fanfare for a key, a whoosh for a relay clue, a fall for a throw-out, coins, thunder. Browsers
 * only let sound start after the player touches the screen: the first touch wakes it. Sound can be turned off (kept on
 * this device); buzzes follow the same switch.
 */

import { radioDip } from "./radio";

type Ctx = AudioContext;
let ctx: Ctx | null = null;
const KEY = "loota:sound";

let on = true;
try {
  on = typeof localStorage === "undefined" || localStorage.getItem(KEY) !== "off";
} catch {
  on = true;
}

export const soundOn = () => on;
export function setSound(value: boolean) {
  on = value;
  try {
    localStorage.setItem(KEY, value ? "on" : "off");
  } catch {
    // Private browsing: for this visit only.
  }
  if (value) cue("tap");
}

function audio(): Ctx | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
// The first touch anywhere wakes the sound (browsers' rule).
if (typeof window !== "undefined") {
  const wake = () => audio();
  window.addEventListener("pointerdown", wake, { once: true, capture: true });
  window.addEventListener("keydown", wake, { once: true, capture: true });
}

/** A note: a frequency (sliding to `to`), a wave, a length and loudness, starting `at` seconds from now. */
function tone(c: Ctx, freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; to?: number } = {}) {
  const t = c.currentTime + (opts.at ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? "sine";
  o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** A burst of noise through a filter (a rumble, a whoosh, a crowd), sweeping from `freq` to `to`. */
function noise(c: Ctx, dur: number, opts: { gain?: number; at?: number; freq?: number; to?: number; type?: BiquadFilterType } = {}) {
  const t = c.currentTime + (opts.at ?? 0);
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const f = c.createBiquadFilter();
  f.type = opts.type ?? "lowpass";
  f.frequency.setValueAtTime(opts.freq ?? 800, t);
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

/** A talking drum's note: a thump whose pitch bends down. */
function drum(c: Ctx, at: number, pitch = 200, gain = 0.35) {
  tone(c, pitch, 0.28, { at, to: pitch * 0.62, gain });
  noise(c, 0.05, { at, gain: gain * 0.4, freq: 2400 });
}

export type Cue =
  | "tap" | "heartbeat" | "chest" | "tick" | "wrong" | "right" | "solved" | "key" | "relay" | "failed"
  | "coin" | "countdown" | "go" | "thunder" | "news" | "rival" | "stop" | "trap" | "beep" | "siren";

const BUZZ: Partial<Record<Cue, number | number[]>> = {
  heartbeat: [18, 90, 28],
  chest: [40, 60, 40, 60, 120],
  wrong: [80, 60, 80],
  key: [60, 50, 60, 50, 200],
  relay: [120, 80, 120],
  failed: [300],
  go: [150],
  thunder: [200, 80, 300],
  rival: [30, 60, 30],
  stop: [60],
  trap: [40, 40, 40, 40, 250],
  beep: [12],
  siren: [70, 60, 70],
};

/** Play a moment's sound (and buzz), if sound is on. `level` (0–1): how strong (the heartbeat) or how close (the beep). */
export function cue(name: Cue, level = 1) {
  // The moments' sounds, in order, for tests (a test can't listen).
  if (typeof window !== "undefined") ((window as unknown as { __lootaCues?: Cue[] }).__lootaCues ??= []).push(name);
  if (!on) return;
  const buzz = BUZZ[name];
  if (buzz && typeof navigator !== "undefined") navigator.vibrate?.(buzz);
  const c = audio();
  if (!c || c.state !== "running") return;
  // The radio dips so the moment is heard (not for the detector's steady beeps and heartbeat).
  if (name !== "beep" && name !== "heartbeat" && name !== "tick") radioDip();
  switch (name) {
    case "tap":
      tone(c, 900, 0.05, { type: "triangle", gain: 0.06 });
      break;
    case "heartbeat": {
      // Lub-dub, louder and higher as the key gets closer.
      const g = 0.12 + 0.3 * level;
      tone(c, 55 + 25 * level, 0.16, { gain: g, to: 40 });
      tone(c, 50 + 25 * level, 0.14, { gain: g * 0.75, at: 0.17, to: 38 });
      break;
    }
    case "chest":
      // A talking-drum roll, then a shimmer as the lid catches the light.
      [0, 0.09, 0.18, 0.26, 0.33, 0.4, 0.46].forEach((at, i) => drum(c, at, 170 + i * 12, 0.25 + i * 0.02));
      tone(c, 660, 0.7, { type: "triangle", at: 0.55, to: 1320, gain: 0.08 });
      tone(c, 990, 0.6, { type: "sine", at: 0.62, to: 1980, gain: 0.05 });
      break;
    case "tick":
      tone(c, 1500, 0.035, { type: "square", gain: 0.05 });
      break;
    case "wrong":
      tone(c, 150, 0.16, { type: "square", gain: 0.12 });
      tone(c, 110, 0.22, { type: "square", gain: 0.12, at: 0.18 });
      break;
    case "right":
      tone(c, 880, 0.09, { type: "triangle", gain: 0.12 });
      tone(c, 1320, 0.14, { type: "triangle", gain: 0.12, at: 0.08 });
      break;
    case "solved":
      [523, 659, 784, 1047].forEach((f, i) => tone(c, f, 0.22, { type: "triangle", at: i * 0.09, gain: 0.14 }));
      break;
    case "key":
      // A fanfare: the arpeggio, a chord, the crowd.
      [523, 659, 784, 1047].forEach((f, i) => tone(c, f, 0.25, { type: "triangle", at: i * 0.1, gain: 0.15 }));
      [523, 659, 784].forEach((f) => tone(c, f, 1.1, { type: "sawtooth", at: 0.45, gain: 0.05 }));
      noise(c, 1.4, { at: 0.45, gain: 0.08, freq: 1200, to: 500, type: "bandpass" });
      drum(c, 0.42, 140, 0.4);
      break;
    case "relay":
      // A whoosh, then a question in a minor key.
      noise(c, 0.8, { gain: 0.14, freq: 300, to: 3000, type: "bandpass" });
      [440, 523, 622, 587].forEach((f, i) => tone(c, f, 0.35, { type: "sine", at: 0.5 + i * 0.16, gain: 0.12 }));
      break;
    case "failed":
      tone(c, 420, 0.75, { type: "sawtooth", to: 70, gain: 0.12 });
      noise(c, 0.9, { gain: 0.12, freq: 2000, to: 150, type: "lowpass" });
      break;
    case "coin":
      tone(c, 1320, 0.08, { type: "square", gain: 0.06 });
      tone(c, 1760, 0.22, { type: "square", gain: 0.06, at: 0.07 });
      break;
    case "countdown":
      tone(c, 880, 0.12, { type: "square", gain: 0.08 });
      break;
    case "go":
      [523, 784, 1047].forEach((f) => tone(c, f, 0.6, { type: "sawtooth", gain: 0.06 }));
      drum(c, 0, 160, 0.4);
      break;
    case "thunder":
      noise(c, 1.8, { gain: 0.35, freq: 900, to: 60 });
      noise(c, 0.25, { gain: 0.25, freq: 4000, to: 800, at: 0.02 });
      break;
    case "news":
      tone(c, 740, 0.1, { type: "sine", gain: 0.06 });
      tone(c, 988, 0.16, { type: "sine", gain: 0.06, at: 0.09 });
      break;
    case "rival":
      // Tension: two low notes a semitone apart.
      tone(c, 196, 0.3, { type: "sawtooth", gain: 0.06 });
      tone(c, 208, 0.4, { type: "sawtooth", gain: 0.06, at: 0.28 });
      break;
    case "stop":
      // Stopped on the road: a danfo's horn.
      tone(c, 392, 0.22, { type: "sawtooth", gain: 0.07 });
      tone(c, 494, 0.22, { type: "sawtooth", gain: 0.07 });
      tone(c, 392, 0.3, { type: "sawtooth", gain: 0.07, at: 0.28 });
      tone(c, 494, 0.3, { type: "sawtooth", gain: 0.07, at: 0.28 });
      break;
    case "siren":
      // A police siren: a wail up and down.
      tone(c, 640, 0.42, { type: "triangle", to: 980, gain: 0.07 });
      tone(c, 980, 0.42, { type: "triangle", to: 640, gain: 0.07, at: 0.42 });
      break;
    case "beep":
      // The metal detector: a short electronic beep, higher as the key gets closer.
      tone(c, 700 + 900 * level, 0.07, { type: "square", gain: 0.05 + 0.05 * level });
      break;
    case "trap":
      // The Masquerade's trap chest: a pop, a sad trombone, and his giggle.
      noise(c, 0.12, { gain: 0.3, freq: 3000, to: 400 });
      [392, 370, 349].forEach((f, i) => tone(c, f, 0.3, { type: "sawtooth", at: 0.15 + i * 0.3, gain: 0.08 }));
      tone(c, 330, 0.8, { type: "sawtooth", at: 1.05, to: 300, gain: 0.08 });
      [0, 0.09, 0.18, 0.27, 0.36].forEach((at, i) => tone(c, 880 - i * 40, 0.07, { type: "triangle", at: 1.9 + at, to: 700 - i * 40, gain: 0.07 }));
      break;
  }
}

/**
 * Loota Radio (owner, 27 Oct 2026: "enable music or radio, so users can listen as they move so it is not just boring"):
 * real stations, live from their own internet streams (the country the hunter is in, and Nigeria's), played while they
 * walk, ride or drive. One player for the whole game; it carries on through scenes and screens, dips under the game's
 * own sounds, and shows on the phone's lock screen. The station, volume and whether it was on are kept on this device.
 *
 * The streams come from a public directory (radio-browser.info), checked 27 Oct 2026: https only (an http stream is
 * blocked on an https page), plain MP3 (plays in every browser). Before launch: the stations' OK (see GAME_DESIGN).
 */
import { countryNow, onCountry } from "./locale";

export type Station = { id: string; name: string; what: string; url: string };

/** Nigeria's stations: everywhere (a Nigerian abroad still has them), and all there is at home. */
export const NIGERIA_STATIONS: Station[] = [
  { id: "coolfm", name: "Cool FM 96.9", what: "Lagos · hits", url: "https://coolfmlagos969-atunwadigital.streamguys1.com/coolfmlagos969" },
  { id: "beatfm", name: "Beat FM 99.9", what: "Lagos · hits", url: "https://beatfmlagos-atunwadigital.streamguys1.com/beatfmlagos" },
  { id: "wazobia", name: "Wazobia FM 95.1", what: "Lagos · pidgin", url: "https://wazobiafmlagos951-atunwadigital.streamguys1.com/wazobiafmlagos951" },
  { id: "naijafm", name: "Naija FM 102.7", what: "Lagos · pidgin, music", url: "https://naijafmlagos-atunwadigital.streamguys1.com/naijafmlagos" },
  { id: "rhythm", name: "Rhythm 93.7", what: "Lagos · music", url: "https://rhythmfmlagos-atunwadigital.streamguys1.com/rhythmfmlagos" },
  { id: "lagosjump", name: "LagosJump Radio", what: "Afrobeats, non-stop", url: "https://radio.lagosjumpradio.com/listen/lagosjump_radio/radio.mp3" },
  { id: "softlife", name: "Softlife Afrofusion", what: "Afrofusion, Amapiano", url: "https://a10.asurahosting.com:7540/radio.mp3" },
  { id: "interspace", name: "InterSpace Sound", what: "Port Harcourt · Amapiano, Afro house", url: "https://radio.interspacemusic.com/stream.mp3" },
  { id: "eagle7", name: "Eagle 7 Sports 103.7", what: "Ogun · sports", url: "https://eagle7fm-atunwadigital.streamguys1.com/eagle7fm" },
  { id: "nigeriainfo", name: "Nigeria Info 99.3", what: "Lagos · news, talk", url: "https://nigeriainfofmlagos993-atunwadigital.streamguys1.com/nigeriainfofmlagos993" },
];

export type RadioState = {
  /** The dial: the stations of the country the hunter is in, then Nigeria's (/api/radio). */
  stations: Station[];
  station: number;
  /** "off"; "tuning" (asked, not yet sounding); "on"; "down" (the station isn't answering). */
  status: "off" | "tuning" | "on" | "down";
  volume: number;
};

const KEY = "loota:radio";
let state: RadioState = { stations: NIGERIA_STATIONS, station: 0, status: "off", volume: 0.7 };
let wasOn = false;
let wanted: string | null = null; // the station last chosen, if it's one from abroad (found when that country's dial loads)
try {
  const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as { station?: string; volume?: number; on?: boolean } | null;
  if (kept) {
    const i = NIGERIA_STATIONS.findIndex((s) => s.id === kept.station);
    if (i < 0 && kept.station) wanted = kept.station;
    state = { ...state, station: i >= 0 ? i : 0, volume: typeof kept.volume === "number" ? Math.min(1, Math.max(0, kept.volume)) : state.volume };
    wasOn = !!kept.on;
  }
} catch {
  // No storage (private browsing): defaults, for this visit.
}

const listeners = new Set<() => void>();
export const radioState = () => state;
export function onRadio(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function set(next: Partial<RadioState>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify({ station: state.stations[state.station].id, volume: state.volume, on: state.status !== "off" }));
  } catch {
    // Not kept: fine.
  }
  listeners.forEach((fn) => fn());
}

let player: HTMLAudioElement | null = null;
let dip = 1; // under a game sound, the radio plays this much quieter
let tuneTimer = 0;

function audio() {
  if (!player) {
    player = new Audio();
    player.preload = "none";
    player.addEventListener("playing", () => {
      window.clearTimeout(tuneTimer);
      if (state.status !== "off") set({ status: "on" });
    });
    player.addEventListener("waiting", () => state.status === "on" && set({ status: "tuning" }));
    player.addEventListener("error", () => state.status !== "off" && set({ status: "down" }));
  }
  return player;
}

function tune() {
  const a = audio();
  const st = state.stations[state.station];
  a.src = st.url;
  a.volume = state.volume * dip;
  set({ status: "tuning" });
  window.clearTimeout(tuneTimer);
  // A station that hasn't started in 15 s isn't answering.
  tuneTimer = window.setTimeout(() => state.status === "tuning" && set({ status: "down" }), 15_000);
  a.play().catch(() => state.status === "tuning" && set({ status: "down" }));
  showOnLockScreen(st);
}

/** Turns the radio on (the station last chosen), or off. */
export function radioOn(on: boolean) {
  if (on) return tune();
  window.clearTimeout(tuneTimer);
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load(); // let go of the stream: no data used while off
  }
  set({ status: "off" });
}

/** Another station: by number, or the next (+1) or previous (−1) one. Turns the radio on. */
export function radioStation(to: number, step = false) {
  const n = state.stations.length;
  set({ station: (((step ? state.station + to : to) % n) + n) % n });
  tune();
}

export function radioVolume(v: number) {
  set({ volume: Math.min(1, Math.max(0, v)) });
  if (player) player.volume = state.volume * dip;
}

/** A game sound is playing: the radio dips for a moment so it can be heard. */
export function radioDip(seconds = 1.5) {
  if (!player || state.status === "off") return;
  dip = 0.3;
  player.volume = state.volume * dip;
  window.setTimeout(() => {
    dip = 1;
    if (player) player.volume = state.volume;
  }, seconds * 1000);
}

/** The phone's lock screen and headphone buttons: the station, play/pause, next and previous. */
function showOnLockScreen(st: Station) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: st.name,
    artist: `${st.what} · Loota Radio`,
    artwork: [{ src: "/brand/loota-gold.png", sizes: "265x240", type: "image/png" }],
  });
  navigator.mediaSession.setActionHandler("play", () => radioOn(true));
  navigator.mediaSession.setActionHandler("pause", () => radioOn(false));
  navigator.mediaSession.setActionHandler("stop", () => radioOn(false));
  navigator.mediaSession.setActionHandler("nexttrack", () => radioStation(1, true));
  navigator.mediaSession.setActionHandler("previoustrack", () => radioStation(-1, true));
}

// On last time: back on at the first touch (browsers only let sound start after one).
if (typeof window !== "undefined" && wasOn) {
  const wake = () => state.status === "off" && tune();
  window.addEventListener("pointerdown", wake, { once: true, capture: true });
  window.addEventListener("keydown", wake, { once: true, capture: true });
}

/**
 * The dial follows the hunter (owner, 27 Oct 2026: "it is not only focused on Nigeria but the country which you find
 * yourself"): the stations of the country they're in, then Nigeria's. What's playing keeps playing across a border.
 */
async function dialFor(code: string) {
  let found: Station[] = [];
  if (code !== "NG" && /^[A-Z]{2}$/.test(code)) {
    try {
      const res = await fetch(`/api/radio?country=${code}`);
      if (res.ok) found = ((await res.json()) as { stations: Station[] }).stations;
    } catch {
      // Offline: Nigeria's for now.
    }
  }
  if (code !== countryNow()) return; // moved on meanwhile
  const ids = new Set(NIGERIA_STATIONS.map((s) => s.id));
  const stations = [...found.filter((s) => !ids.has(s.id)), ...NIGERIA_STATIONS];
  const current = state.stations[state.station];
  let station = stations.findIndex((s) => s.id === (state.status === "off" && wanted ? wanted : current.id));
  if (station < 0 && state.status !== "off") {
    stations.unshift(current); // the one playing stays on the dial
    station = 0;
  }
  if (station >= 0 && stations[station].id === wanted) wanted = null;
  set({ stations, station: Math.max(0, station) });
}
if (typeof window !== "undefined") onCountry(() => void dialFor(countryNow()));

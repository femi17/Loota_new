/**
 * Night and day, and traffic (design doc 15, 14 Oct 2026). Real time where the
 * player is: the sun rises and sets as it really does there, and the roads are
 * busy at the real rush hours. The rules match the database (migration
 * rest_traffic_night: utc_offset_h, sun_altitude, is_night, traffic_level,
 * traffic_factor, night_taxi_fare, night_bus_wait); keep the two in step.
 */
import type { RoadClass } from "./roadData";

const HOUR = 3_600_000;
const rad = Math.PI / 180;

/** Hours ahead of UTC on the local clock: Nigeria is on West Africa Time (UTC+1); elsewhere, by longitude. */
export function utcOffsetH(lng: number, lat: number) {
  return lng >= 2.6 && lng <= 14.7 && lat >= 4 && lat <= 14 ? 1 : Math.round(lng / 15);
}

/** The local clock: hour of the day (with minutes as a fraction) and day of the week (0 = Sunday). */
export function localTime(ms: number, lng: number, lat: number) {
  const d = new Date(ms + utcOffsetH(lng, lat) * HOUR);
  return { hour: d.getUTCHours() + d.getUTCMinutes() / 60, day: d.getUTCDay(), minutes: d.getUTCMinutes() };
}

/** "8:42 pm" */
export function clockText(ms: number, lng: number, lat: number) {
  const { hour, minutes } = localTime(ms, lng, lat);
  const h = Math.floor(hour);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(minutes).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** The sun's height above the horizon in degrees (a simple formula, good to a degree or so). */
export function sunAltitude(ms: number, lng: number, lat: number) {
  const d = new Date(ms);
  const dayOfYear = Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / (24 * HOUR)) + 1;
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const hours = (ms - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / HOUR;
  const hourAngle = (hours + lng / 15 - 12) * 15;
  const s =
    Math.sin(lat * rad) * Math.sin(declination * rad) + Math.cos(lat * rad) * Math.cos(declination * rad) * Math.cos(hourAngle * rad);
  return Math.asin(Math.max(-1, Math.min(1, s))) / rad;
}

/** Night: the sun more than 4° below the horizon (is_night in the database). */
export function isNight(ms: number, lng: number, lat: number) {
  return sunAltitude(ms, lng, lat) < -4;
}

/** How light it is, for the map: 1 in daylight, 0 at night, in between at dawn and dusk. */
export function daylight(ms: number, lng: number, lat: number) {
  return Math.max(0, Math.min(1, (sunAltitude(ms, lng, lat) + 8) / 14));
}

/** How busy the roads are, 0 (empty) to 1 (the weekday evening rush), by local time and day. */
export function trafficLevel(ms: number, lng: number, lat: number) {
  const { hour: h, day } = localTime(ms, lng, lat);
  if (day === 0) return h >= 10 && h < 20 ? 0.15 : 0;
  if (day === 6) return h >= 9 && h < 20 ? 0.35 : h >= 20 && h < 22 ? 0.1 : 0;
  if (h >= 6.5 && h < 10) return 0.8;
  if (h >= 16 && h < 20.5) return 1;
  if (h >= 10 && h < 16) return 0.3;
  if (h >= 20.5 && h < 22) return 0.2;
  return 0;
}

/** Taxis and city buses take longer in traffic: up to 1.8 times as long at the evening rush. */
export function trafficFactor(ms: number, lng: number, lat: number) {
  return 1 + 0.8 * trafficLevel(ms, lng, lat);
}

/** After dark taxis charge more and city buses come less often. */
export const NIGHT_TAXI_FARE = 1.3;
export const NIGHT_BUS_WAIT = 3;

// ---- Jams on the roads -------------------------------------------------------

/** Which roads jam, and how readily: the main roads through town. */
const JAM_PRONE: Partial<Record<RoadClass, number>> = {
  motorway: 0.7,
  motorway_link: 0.6,
  trunk: 0.9,
  trunk_link: 0.6,
  primary: 1,
  primary_link: 0.6,
  secondary: 0.8,
  secondary_link: 0.5,
  tertiary: 0.45,
};

/** A jam lasts this long, then the traffic moves on and may build up somewhere else. */
export const JAM_WINDOW_MS = 15 * 60_000;

/** 0 to 1 from a stretch of road and a time window: the same for every player. */
function hash01(a: number, b: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export type Jam = 0 | 1 | 2; // none, slow, at a standstill ("go-slow")

/**
 * The traffic on a stretch of road: `stretch` identifies it (the same on every
 * device), `urban` how built-up the area is (0 to 1), `level` from trafficLevel.
 */
export function jamOn(cls: RoadClass | undefined, stretch: number, urban: number, level: number, ms: number): Jam {
  const prone = cls ? (JAM_PRONE[cls] ?? 0) : 0;
  const chance = 0.75 * level * prone * urban;
  if (chance <= 0) return 0;
  const r = hash01(stretch, Math.floor(ms / JAM_WINDOW_MS));
  return r < chance * 0.45 ? 2 : r < chance ? 1 : 0;
}

/** How fast a motorbike or car can go in traffic: cars crawl; motorbikes weave through. */
export function jamSpeed(mode: string, jam: Jam) {
  if (jam === 0 || (mode !== "car" && mode !== "motorbike")) return 1;
  if (mode === "motorbike") return jam === 2 ? 0.5 : 0.8;
  return jam === 2 ? 0.15 : 0.45;
}

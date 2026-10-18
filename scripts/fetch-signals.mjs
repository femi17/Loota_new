// Traffic lights in Nigeria from OpenStreetMap (highway=traffic_signals), via the Overpass API, into
// public/data/traffic-signals.json: { fetched, signals: [[osmId, lng, lat], ...] }. Run again to refresh.
//   npm run signals:fetch
import { writeFileSync, mkdirSync } from "node:fs";

const query = `[out:json][timeout:200];area["ISO3166-1"="NG"][admin_level=2]->.a;node["highway"="traffic_signals"](area.a);out;`;
const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "loota-game-data/1.0" },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass: ${res.status} ${await res.text()}`);
const { elements } = await res.json();
const signals = elements
  .filter((e) => e.type === "node")
  .map((e) => [e.id, Math.round(e.lon * 1e6) / 1e6, Math.round(e.lat * 1e6) / 1e6])
  .sort((a, b) => a[0] - b[0]);
const out = new URL("../public/data/traffic-signals.json", import.meta.url);
mkdirSync(new URL(".", out), { recursive: true });
writeFileSync(out, JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), signals }));
console.log(`${signals.length} traffic lights written to public/data/traffic-signals.json`);

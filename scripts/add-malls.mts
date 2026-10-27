/**
 * Adds Nigeria's shopping malls as chill spots (owner, 27 Oct 2026: "to chill, it should be either restaurants or
 * eateries, malls"), from OpenStreetMap, to the places already imported (scripts/build-places.mts takes them in from
 * now on too). Asked for a box of the country at a time (all of it at once is too much for the public servers); malls
 * already there are skipped, so it can be run again.
 *
 *   node scripts/add-malls.mts
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { kindOf, nameOf, type Tags } from "../src/lib/osm-places.ts";

process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
type El = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Tags };

async function ask(box: string): Promise<El[] | null> {
  for (let round = 0; round < 3; round++) {
    for (const server of SERVERS) {
      try {
        const res = await fetch(server, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Loota/1.0 (treasure-hunt game)" },
          body: `data=${encodeURIComponent(`[out:json][timeout:60];nwr["shop"="mall"](${box});out center tags;`)}`,
          signal: AbortSignal.timeout(70_000),
        });
        if (!res.ok) throw new Error(String(res.status));
        return ((await res.json()) as { elements: El[] }).elements;
      } catch (e) {
        console.log(`  ${new URL(server).host}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return null;
}

let found = 0;
let added = 0;
let missed = 0;
for (let s = 4; s < 14; s += 2.5)
  for (let w = 2.6; w < 14.7; w += 3) {
    const box = `${s},${w.toFixed(1)},${Math.min(14, s + 2.5)},${Math.min(14.7, w + 3).toFixed(1)}`;
    const elements = await ask(box);
    if (!elements) {
      console.log(`box ${box}: OpenStreetMap busy, run again later`);
      missed++;
      continue;
    }
    for (const el of elements) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat === undefined || lng === undefined || !el.tags || kindOf(el.tags) !== "rest") continue;
      found++;
      const m = { kind: "rest", name: nameOf(el.tags, "rest"), lng: +lng.toFixed(6), lat: +lat.toFixed(6) };
      const d = 0.0005; // ~50 m
      const { data: there } = await db.from("places").select("id").eq("kind", "rest").gte("lng", m.lng - d).lte("lng", m.lng + d).gte("lat", m.lat - d).lte("lat", m.lat + d).limit(1);
      if (there?.length) continue;
      const { error } = await db.from("places").insert(m);
      if (error) throw error;
      added++;
    }
    console.log(`box ${box}: ${elements.length} malls`);
  }
console.log(`${found} malls found in Nigeria; ${added} added as chill spots${missed ? `; ${missed} boxes missed (busy): run again` : ""}`);

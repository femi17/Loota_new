/**
 * Adds the world's airports with scheduled flights to the transport data, so
 * players can fly anywhere (design doc 12: players join from anywhere and fly
 * in). Data: OurAirports (public domain), https://ourairports.com/data/ :
 * airports.csv and countries.csv.
 *
 *   node scripts/add-world-airports.mts <airports.csv> <countries.csv> <transit.json>
 *
 * Nigerian airports already in <transit.json> (from OpenStreetMap, placed at
 * their terminals) are kept and given their city and country; every other
 * large or medium airport with scheduled flights and an IATA code is added at
 * OurAirports' position. <transit.json> is updated in place; run it before
 * transit:upload.
 */
import { readFileSync, writeFileSync } from "node:fs";

type Airport = { code: string; name: string; lng: number; lat: number; city?: string; country?: string };

const [airportsCsv, countriesCsv, file] = process.argv.slice(2);
if (!airportsCsv || !countriesCsv || !file) {
  console.error("Usage: node scripts/add-world-airports.mts <airports.csv> <countries.csv> <transit.json>");
  process.exit(1);
}

/** Rows of a CSV file with quoted fields (which may hold commas and doubled quotes). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const countries = new Map(parseCsv(readFileSync(countriesCsv, "utf8")).map((c) => [c.code, c.name]));
const data = JSON.parse(readFileSync(file, "utf8")) as { airports: Airport[] };
const ours = new Map(data.airports.map((a) => [a.code, a]));

let added = 0;
for (const a of parseCsv(readFileSync(airportsCsv, "utf8"))) {
  if (!["large_airport", "medium_airport"].includes(a.type) || a.scheduled_service !== "yes" || !/^[A-Z]{3}$/.test(a.iata_code)) continue;
  const city = a.municipality || undefined;
  const country = countries.get(a.iso_country) ?? a.iso_country;
  const known = ours.get(a.iata_code);
  if (known) {
    known.city ??= city;
    known.country ??= country;
    continue;
  }
  if (a.iso_country === "NG" && data.airports.some((o) => Math.abs(o.lat - Number(a.latitude_deg)) < 0.05 && Math.abs(o.lng - Number(a.longitude_deg)) < 0.05)) {
    continue; // already here under another code
  }
  const airport: Airport = { code: a.iata_code, name: a.name, lng: +Number(a.longitude_deg).toFixed(6), lat: +Number(a.latitude_deg).toFixed(6), city, country };
  data.airports.push(airport);
  ours.set(airport.code, airport);
  added++;
}
for (const a of data.airports) a.country ??= "Nigeria"; // the OpenStreetMap ones are all Nigerian
data.airports.sort((x, y) => x.code.localeCompare(y.code));
writeFileSync(file, JSON.stringify(data));
console.log(`${data.airports.length} airports (${added} added from OurAirports).`);

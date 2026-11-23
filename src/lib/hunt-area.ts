import { FLAG_FILES } from "@/game/puzzles/flag-files";

/**
 * Where a hunt's keys are (owner, 23 Nov 2026: "picking a state, a country or worldwide"): anywhere in the world, all
 * in one country, or all in one state or region of a country (a Lagos hunt). Stored on the hunt as region,
 * area_country (two-letter code) and area_state.
 */
export type HuntArea = { region: "world" } | { region: "country"; country: string } | { region: "state"; country: string; state: string };

/** Nigeria's 36 states and the FCT, for the state picker (other countries' states are typed). */
export const NIGERIA_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "Federal Capital Territory", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun",
  "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

const names = new Intl.DisplayNames(["en"], { type: "region" });
/** "NG" → "Nigeria". */
export const countryName = (code: string) => {
  try {
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

/** Every country with a flag in the game, by name (Nigeria first: most hunts are there). */
export const COUNTRIES = Object.keys(FLAG_FILES)
  .map((c) => c.toUpperCase())
  .filter((c) => /^[A-Z]{2}$/.test(c))
  .map((code) => ({ code, name: countryName(code) }))
  .sort((a, b) => (a.code === "NG" ? -1 : b.code === "NG" ? 1 : a.name.localeCompare(b.name)));

/** The area from a hunt row's columns. */
export function huntArea(h: { region: string; area_country?: string | null; area_state?: string | null }): HuntArea {
  if (h.region === "state" && h.area_country && h.area_state) return { region: "state", country: h.area_country, state: h.area_state };
  if (h.region === "country" && h.area_country) return { region: "country", country: h.area_country };
  return { region: "world" };
}

/** "worldwide", "in Nigeria", "in Lagos, Nigeria". */
export function areaLabel(a: HuntArea) {
  if (a.region === "state") return `in ${a.state}, ${countryName(a.country)}`;
  if (a.region === "country") return `in ${countryName(a.country)}`;
  return "worldwide";
}

/** The area as the story request's last words: "", " in Nigeria", " in Lagos, Nigeria". */
export const areaRequest = (a: HuntArea) => (a.region === "world" ? "" : ` ${areaLabel(a)}`);

/** "Lagos State" / "lagos" → "lagos": to compare a state the map names with the hunt's. */
export const sameState = (a: string, b: string) => {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\b(state|province|region|county|governorate|prefecture)\b/g, "")
      .replace(/[^a-z]/g, "");
  const x = norm(a);
  const y = norm(b);
  const fct = (s: string) => (s === "abuja" || s === "fct" || s === "federalcapitalterritory" ? "fct" : s);
  return fct(x) === fct(y);
};

/** Things found while roaming (design doc 7 and 9). Shared by the map, the server and the inventory. */

export type ItemKind = "coins" | "cache" | "intel" | "relic";

export type RelicId = "rain_charm" | "shield" | "radar" | "fast_pass" | "second_wind" | "jerry_can" | "lockdown_orb";

export const RELICS: Record<RelicId, { name: string; colour: string; effect: string; rarity: "Common" | "Rare" | "Legendary" }> = {
  shield: { name: "Shield", colour: "#3DD68C", effect: "Blocks one weather or traffic effect.", rarity: "Common" },
  second_wind: { name: "Second Wind", colour: "#FF8A3D", effect: "Restores 50 energy.", rarity: "Common" },
  jerry_can: { name: "Jerry Can", colour: "#E5484D", effect: "Restores 30% fuel.", rarity: "Common" },
  rain_charm: { name: "Rain Charm", colour: "#8FC7E8", effect: "Rain over 5 km for 10 minutes. Slows walkers and bikes.", rarity: "Common" },
  radar: { name: "Radar", colour: "#F4B41A", effect: "Points to the nearest relic for 5 minutes.", rarity: "Rare" },
  fast_pass: { name: "Fast Pass", colour: "#C3A6FF", effect: "Skip the wait for one bus or train, or a plane's check-in queue.", rarity: "Rare" },
  lockdown_orb: {
    name: "Lockdown Orb",
    colour: "#9B5DE5",
    effect: "One in the world. Raises a 1 km dome over your current key area for 20 minutes: hunters outside can't get in unless they break it together. Not on the final key.",
    rarity: "Legendary",
  },
};

/** Each relic's picture (the inventory, the strike when one is used on others). */
export const RELIC_ICON: Record<RelicId, string> = {
  shield: "🛡️",
  second_wind: "💨",
  jerry_can: "⛽",
  rain_charm: "🌧️",
  radar: "📡",
  fast_pass: "🎟️",
  lockdown_orb: "🔮",
};

/** How often each relic turns up (weights). */
export const RELIC_WEIGHTS: [RelicId, number][] = [
  ["shield", 30],
  ["second_wind", 25],
  ["jerry_can", 20],
  ["radar", 10],
  ["fast_pass", 10],
  ["rain_charm", 5],
];

/** A visible item as the server sends it. */
export type WorldItem = { id: string; kind: ItemKind; relic: RelicId | null; lng: number; lat: number };
export type Lead = { id: string; lng: number; lat: number };

/** Walk within this distance of an item to pick it up (the server allows 30 m). */
export const PICKUP_RADIUS_M = 12;

/** Squares of the world grid, 0.005° (about 550 m) on a side; must match cell_of() in the database. */
export const CELL_DEG = 0.005;

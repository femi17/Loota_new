/**
 * Which OpenStreetMap things are the game's places (design doc 5.3, 5.6): petrol stations, hospitals and clinics,
 * places to eat, places to rest (parks and gardens), tyre shops (vulcanizers) and mechanics; and which are bus stops.
 * Shared by the Nigeria import (scripts/build-places.mts) and the squares filled elsewhere (src/lib/fill-area.ts), so
 * a place counts the same everywhere.
 */
export type Tags = Record<string, string>;
export type PlaceKind = "fuel" | "hospital" | "eat" | "rest" | "tyres" | "mechanic";

export const DEFAULT_NAME: Record<PlaceKind, string> = {
  fuel: "Petrol station",
  hospital: "Hospital",
  eat: "Place to eat",
  rest: "Park",
  tyres: "Vulcanizer",
  mechanic: "Mechanic",
};

/** What kind of place this is, if it's one we want. */
export function kindOf(t: Tags): PlaceKind | null {
  // Not for the public: a firm's own fuel yard, a staff canteen, a private garden.
  if (t.access === "private" || t.access === "no") return null;
  if (t.amenity === "fuel") return "fuel";
  if (t.amenity === "hospital" || t.amenity === "clinic" || t.healthcare === "hospital" || t.healthcare === "clinic") return "hospital";
  if (t.shop === "tyres" || /vulcani[sz]/i.test(t.name ?? "")) return "tyres";
  if (t.shop === "car_repair" || t.shop === "motorcycle_repair" || t.craft === "mechanic") return "mechanic";
  if (["restaurant", "fast_food", "cafe", "food_court"].includes(t.amenity)) return "eat";
  if (t.leisure === "park" || t.leisure === "garden") return "rest";
  return null;
}

/** A bus stop ("stop"), a bus station or motor park ("park"), or neither (as scripts/build-transit.mts reads them). */
export function busStopOf(t: Tags): "stop" | "park" | null {
  if (t.amenity === "bus_station") return "park";
  if (t.highway === "bus_stop" || ((t.public_transport === "platform" || t.public_transport === "stop_position") && t.bus === "yes")) return "stop";
  return null;
}

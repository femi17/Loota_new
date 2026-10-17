/** Prices in coins. Must match vehicle_price(), rental_rate() and fuel_per_km() in the database. */

export type VehicleKind = "bicycle" | "motorbike" | "car";

export const VEHICLES: Record<VehicleKind, { name: string; price: number; ratePerMinute: number; fuelPerKm: number; note: string }> = {
  bicycle: { name: "Bicycle", price: 600, ratePerMinute: 4, fuelPerKm: 0, note: "16 km/h. Footpaths and roads. Uses your energy." },
  motorbike: { name: "Motorbike", price: 2500, ratePerMinute: 10, fuelPerKm: 0.8, note: "35 km/h. Roads only. Uses fuel." },
  car: { name: "Car", price: 8000, ratePerMinute: 20, fuelPerKm: 1.2, note: "45 km/h. Roads only. Uses fuel." },
};

export const VEHICLE_KINDS = Object.keys(VEHICLES) as VehicleKind[];

/** Coins per % of a tank. */
export const FUEL_PRICE = 2;
export const MEAL_PRICE = 30;
export const MEAL_ENERGY = 40;

/** Within this distance of a petrol station or a place to eat, its button appears. */
export const SERVICE_RADIUS_M = 40;
/** A mechanic called out to the player (they come to you; ready in 45 s). Must match call_out_price() in the database. */
export const CALL_OUT_PRICE: Record<VehicleKind, number> = { bicycle: 60, motorbike: 150, car: 150 };
/** Walking a broken-down vehicle into a repair shop: price and wait. Must match repair_price() and repair_wait_s(). */
export const REPAIR: Record<VehicleKind, { price: number; waitS: number }> = {
  bicycle: { price: 40, waitS: 120 },
  motorbike: { price: 120, waitS: 180 },
  car: { price: 200, waitS: 240 },
};

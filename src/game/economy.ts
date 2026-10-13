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
/** You can get on your own vehicle within this distance of where it's parked. */
export const BOARD_RADIUS_M = 30;

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
/** A jerry can (the keg) holds this much of a tank, and pouring one takes a tank to this at most. Must match keg_capacity(). */
export const KEG_CAPACITY = 65;
/** A jerry can, at a petrol station. Must match buy_keg(). */
export const KEG_PRICE = 25;
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

/**
 * A vehicle's gear and papers (owner, 19 Oct 2026). Bought once: the light, helmet, registration and insurance with
 * the vehicle, the licences with the player. Must match addon_price() in the database. Police checkpoints fine
 * whatever is missing (20 coins each); a bicycle without a light crawls after dark. Rentals and taxis have their own.
 */
export type AddonId = "light" | "helmet" | "rider_licence" | "driver_licence" | "registration" | "insurance";
export const ADDONS: Record<VehicleKind, { id: AddonId; name: string; price: number; why: string }[]> = {
  bicycle: [{ id: "light", name: "Bicycle light", price: 40, why: "Ride at full speed after dark (without one you crawl, and the police may stop you)." }],
  motorbike: [
    { id: "helmet", name: "Helmet", price: 80, why: "The law on a motorbike." },
    { id: "rider_licence", name: "Rider's licence", price: 150, why: "Yours, for any motorbike." },
    { id: "registration", name: "Registration (plate number)", price: 200, why: "Papers for this motorbike." },
  ],
  car: [
    { id: "driver_licence", name: "Driver's licence", price: 300, why: "Yours, for any car." },
    { id: "registration", name: "Registration (plate number)", price: 400, why: "Papers for this car." },
    { id: "insurance", name: "Insurance", price: 250, why: "The law for every car." },
  ],
};
/** How a checkpoint officer names what's missing. */
export const PAPER_NAME: Record<AddonId, string> = {
  light: "light",
  helmet: "helmet",
  rider_licence: "rider's licence",
  driver_licence: "driver's licence",
  registration: "registration papers",
  insurance: "insurance",
};
/** A fine at a checkpoint, per thing missing. */
export const PAPER_FINE = 20;

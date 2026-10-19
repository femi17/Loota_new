// Out of fuel (owner, 19 Oct 2026), through the real database functions: the motorbike runs dry and stays parked at
// the roadside where it stopped (not in the pocket); a petrol station won't fill it from there and it can't be taken
// out; a jerry can (25 coins) filled at the station holds 65% of a tank (130 coins); poured from far away: refused;
// poured beside it: the tank at 65%, and the rider back on it. The test player is deleted.
//   node scripts/tests/stranded-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

try {
  // A petrol station in Yaba, and a spot 400 m north of it on the road.
  const { data: st } = await admin.from("places").select("lng, lat").eq("kind", "fuel").gte("lng", 3.37).lte("lng", 3.39).gte("lat", 6.5).lte("lat", 6.52).limit(1).single();
  const dryAt = { lng: st.lng, lat: st.lat + 400 / 110574 };
  const email = `stranded-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: dryAt.lng, home_lat: dryAt.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 500, p_kind: "admin", p_reason: "Stranded test" });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 0.001, tyre: 100, engine: 100, lng: dryAt.lng, lat: dryAt.lat, in_use: true });
  await admin.from("player_positions").upsert({ user_id: id, lng: dryAt.lng, lat: dryAt.lat - 50 / 110574, mode: "motorbike", energy: 100, updated_at: ago(5) });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const bike = async () => (await admin.from("player_vehicles").select("fuel, in_use, stranded_at, lng, lat").eq("user_id", id).single()).data;
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const mode = async () => (await admin.from("player_positions").select("mode").eq("user_id", id).single()).data.mode;
  const goTo = async (p) => admin.from("player_positions").update({ lng: p.lng, lat: p.lat, updated_at: new Date().toISOString() }).eq("user_id", id);

  // ---- Running dry
  const r1 = (await c.rpc("save_position", { p_lng: dryAt.lng, p_lat: dryAt.lat, p_mode: "motorbike" })).data;
  let b = await bike();
  check("running dry: stopped, on foot", r1?.stopped === "fuel" && (await mode()) === "walk", JSON.stringify(r1).slice(0, 120));
  check("…the motorbike stays at the roadside where it stopped (not in the pocket)", !!b.stranded_at && !b.in_use && Math.abs(b.lat - dryAt.lat) < 1e-6, JSON.stringify(b));
  const out = (await c.rpc("start_vehicle", { p_kind: "motorbike", p_lng: dryAt.lng, p_lat: dryAt.lat, p_rent: false })).data;
  check("…it can't be taken out", out?.ok === false && out.reason === "stranded");

  // ---- At the petrol station
  await goTo(st);
  const fill = (await c.rpc("refuel")).data;
  check("the station can't fill it from there", fill?.ok === false && fill.reason === "stranded", JSON.stringify(fill));
  const c0 = await coins();
  const buy = (await c.rpc("buy_keg")).data;
  const can = (await c.rpc("fill_keg")).data;
  check("a jerry can (25) filled to 65% of a tank (130)", buy?.ok && can?.ok && can.fuel === 65 && can.cost === 130 && (await coins()) === c0 - 155, JSON.stringify(can));
  const far = (await c.rpc("pour_keg")).data;
  check("poured at the station, 400 m from it: refused", far?.ok === false && far.reason === "far", JSON.stringify(far).slice(0, 100));

  // ---- Back at the motorbike
  await goTo({ lng: dryAt.lng, lat: dryAt.lat + 10 / 110574 });
  const pour = (await c.rpc("pour_keg")).data;
  b = await bike();
  check("poured beside it: the tank at 65%", pour?.ok && Math.round(pour.fuel) === 65 && Math.round(b.fuel) === 65, JSON.stringify(pour));
  check("…and back on it", pour?.remounted === true && b.in_use && !b.stranded_at && (await mode()) === "motorbike");
  const { data: keg } = await admin.from("player_kegs").select("fuel, uses_left").eq("user_id", id).single();
  check("…the can empty again (49 uses left)", keg.fuel === 0 && keg.uses_left === 49, JSON.stringify(keg));
  await wait(1500);
  const ride = (await c.rpc("save_position", { p_lng: dryAt.lng, p_lat: dryAt.lat + 100 / 110574, p_mode: "motorbike" })).data;
  check("…and it rides", ride?.ok === true && !ride.stopped, JSON.stringify(ride).slice(0, 80));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (id) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

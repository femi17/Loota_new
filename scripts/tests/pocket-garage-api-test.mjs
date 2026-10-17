// The pocket garage: a player's own vehicles go everywhere with them. Taken out anywhere (even far from where they
// were last ridden), filled, pumped, serviced and rescued in the pocket, and pocketed by other transport.
// The test player is deleted.   node scripts/tests/pocket-garage-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ids = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const yaba = { lng: 3.3787, lat: 6.5186 };
const station = { lng: 3.385347, lat: 6.519143 }; // a petrol station near Yaba (places)
const ibadan = { lng: 3.8964, lat: 7.3775 }; // where the vehicles were last ridden: 110 km away
const abuja = { lng: 7.4951, lat: 9.0579 };

try {
  const email = `pocket-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 1000, p_kind: "admin", p_reason: "Pocket garage test" });
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 100, updated_at: ago(60) });
  await admin.from("player_vehicles").insert([
    { user_id: id, kind: "motorbike", fuel: 50, tyre: 100, engine: 100, lng: ibadan.lng, lat: ibadan.lat, in_use: false },
    { user_id: id, kind: "bicycle", fuel: 0, tyre: 30, engine: 100, lng: ibadan.lng, lat: ibadan.lat, in_use: false },
  ]);
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => {
    const { data: d, error } = await c.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return d;
  };
  const vehicle = async (kind) => (await admin.from("player_vehicles").select("*").eq("user_id", id).eq("kind", kind).single()).data;
  const mode = async () => (await admin.from("player_positions").select("mode").eq("user_id", id).single()).data.mode;
  const teleport = (at) => admin.from("player_positions").update({ lng: at.lng, lat: at.lat, updated_at: ago(60) }).eq("user_id", id);

  // ---- Out of the pocket, anywhere
  const out1 = await rpc("start_vehicle", { p_kind: "motorbike", p_lng: yaba.lng, p_lat: yaba.lat, p_rent: false });
  check("the motorbike comes out in Yaba, 110 km from where it was last ridden", out1?.ok && out1.source === "owned" && (await mode()) === "motorbike", JSON.stringify(out1));
  const m1 = await vehicle("motorbike");
  check("…and it's where the player is", Math.abs(m1.lng - yaba.lng) < 1e-6 && m1.in_use);
  await admin.from("player_positions").update({ updated_at: ago(60) }).eq("user_id", id);
  await rpc("stop_vehicle", { p_lng: yaba.lng, p_lat: yaba.lat });
  check("getting off: into the pocket, on foot", !(await vehicle("motorbike")).in_use && (await mode()) === "walk");
  await teleport(abuja);
  const out2 = await rpc("start_vehicle", { p_kind: "bicycle", p_lng: abuja.lng, p_lat: abuja.lat, p_rent: false });
  check("the bicycle comes out in Abuja", out2?.ok && (await mode()) === "bicycle", JSON.stringify(out2));
  await admin.from("player_positions").update({ updated_at: ago(60) }).eq("user_id", id);
  await rpc("stop_vehicle", { p_lng: abuja.lng, p_lat: abuja.lat });

  // ---- Fuel: an empty tank is filled in the pocket at any petrol station
  await admin.from("player_vehicles").update({ fuel: 0 }).eq("user_id", id).eq("kind", "motorbike");
  await teleport(station);
  check("an empty motorbike won't come out", (await rpc("start_vehicle", { p_kind: "motorbike", p_lng: station.lng, p_lat: station.lat, p_rent: false }))?.reason === "fuel");
  await admin.from("player_positions").update({ updated_at: ago(60) }).eq("user_id", id);
  await rpc("start_vehicle", { p_kind: "bicycle", p_lng: station.lng, p_lat: station.lat, p_rent: false });
  const fill = await rpc("refuel");
  check("at a petrol station on the bicycle: the pocketed motorbike is filled", fill?.ok && (await vehicle("motorbike")).fuel === 100 && (await mode()) === "bicycle", JSON.stringify(fill));

  // ---- Tyres: pumped while ridden or pocketed
  await admin.from("player_positions").update({ updated_at: ago(60) }).eq("user_id", id);
  await rpc("stop_vehicle", { p_lng: station.lng, p_lat: station.lat });
  const pump = await rpc("pump_tyres");
  check("the pocketed bicycle's tyres are pumped", pump?.ok && (await vehicle("bicycle")).tyre === 100, JSON.stringify(pump));

  // ---- A keg pours in anywhere
  await admin.from("player_vehicles").update({ fuel: 10 }).eq("user_id", id).eq("kind", "motorbike");
  await admin.from("player_kegs").upsert({ user_id: id, fuel: 30, uses_left: 50 });
  await teleport(abuja);
  const pour = await rpc("pour_keg");
  check("a keg pours into the pocketed motorbike, far from any station", pour?.ok && Math.round((await vehicle("motorbike")).fuel) === 40, JSON.stringify(pour));

  // ---- A breakdown: the mechanic comes to the player
  await admin.from("player_vehicles").update({ broken_at: new Date().toISOString(), engine: 10 }).eq("user_id", id).eq("kind", "motorbike");
  const mech = await rpc("call_mechanic");
  check("the mechanic comes to wherever the player is", mech?.ok && mech.kind === "motorbike", JSON.stringify(mech));
  await admin.from("player_vehicles").update({ repair_ready_at: ago(1) }).eq("user_id", id).eq("kind", "motorbike");
  await admin.from("player_positions").update({ updated_at: ago(60) }).eq("user_id", id);
  const fixed = await rpc("start_vehicle", { p_kind: "motorbike", p_lng: abuja.lng, p_lat: abuja.lat, p_rent: false });
  check("…and once fixed it comes out", fixed?.ok && (await mode()) === "motorbike", JSON.stringify(fixed));

  // ---- Other transport: asking for a rental (or a taxi) puts your own away
  const pick = await rpc("request_pickup", { p_kind: "bicycle", p_lng: abuja.lng, p_lat: abuja.lat, p_name: "Test stop" });
  check("asking for a rental while on your motorbike: it goes into your pocket", pick?.ok && (await mode()) === "walk" && !(await vehicle("motorbike")).in_use, JSON.stringify(pick));
  await rpc("cancel_pickup");
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}

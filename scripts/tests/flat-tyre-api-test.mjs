// Flat tyres on motorbikes (owner, 22 Oct 2026: "Yes, fix with a jack"), through the real database functions: a flat
// on the road stops the motorbike at the roadside and the player is on foot; it can't be ridden; a jerry can fills it
// but doesn't put you back on; the jack: needed (bought like a helmet, 120 coins), a 30 s wait, then back on it; a
// roadside mechanic: 40 coins, 25 s; from far away: refused. The test player is deleted.
//   node scripts/tests/flat-tyre-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const spot = { lng: 3.3787, lat: 6.5186 };
const north = (m) => ({ lng: spot.lng, lat: spot.lat + m / 110574 });

try {
  const email = `flat-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ coins: 1000, home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 80, tyre: 100, engine: 100, lng: spot.lng, lat: spot.lat, in_use: true });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => (await c.rpc(fn, args)).data;
  const bike = async () => (await admin.from("player_vehicles").select("tyre, fuel, in_use, stranded_at, jack, flat_fix_ready_at").eq("user_id", id).single()).data;
  const coins = async () => Number((await admin.from("profiles").select("coins").eq("id", id).single()).data.coins);
  const mode = async () => (await admin.from("player_positions").select("mode").eq("user_id", id).single()).data.mode;
  /** A puncture on the road (the dice roll it about once in 100 km; here, now). */
  const puncture = async () => {
    await admin.from("player_vehicles").update({ tyre: 0 }).eq("user_id", id);
    const p = north(60);
    await admin.from("player_positions").update({ updated_at: ago(20) }).eq("user_id", id);
    return rpc("save_position", { p_lng: p.lng, p_lat: p.lat, p_mode: "motorbike" });
  };
  const readyNow = () => admin.from("player_vehicles").update({ flat_fix_ready_at: ago(1) }).eq("user_id", id);

  // ---- A flat on the road
  let r = await puncture();
  let b = await bike();
  check("a flat on the road: the motorbike stops", r?.ok && r.stopped === "flat", JSON.stringify(r));
  check("…parked at the roadside, the player on foot", !!b.stranded_at && !b.in_use && (await mode()) === "walk");
  const at = north(60);
  r = await rpc("start_vehicle", { p_kind: "motorbike", p_lng: at.lng, p_lat: at.lat, p_rent: false });
  check("it can't be ridden with a flat", r?.ok === false && r.reason === "flat", JSON.stringify(r));

  // A jerry can fills it but doesn't put you back on it.
  await admin.from("player_vehicles").update({ fuel: 20 }).eq("user_id", id);
  await admin.from("player_kegs").upsert({ user_id: id, fuel: 30, uses_left: 10 });
  r = await rpc("pour_keg", {});
  b = await bike();
  check("a jerry can fills its tank, but you stay on foot", r?.ok && r.remounted === false && r.flat === true && Math.round(b.fuel) === 50 && !b.in_use, JSON.stringify(r));

  // ---- The jack
  r = await rpc("start_flat_fix", { p_how: "jack" });
  check("no jack yet: refused", r?.ok === false && r.reason === "no_jack", JSON.stringify(r));
  const before = await coins();
  r = await rpc("buy_addon", { p_addon: "jack", p_kind: "motorbike" });
  check("a jack bought: 120 coins", r?.ok && r.price === 120 && (await coins()) === before - 120 && (await bike()).jack === true, JSON.stringify(r));
  r = await rpc("start_flat_fix", { p_how: "jack" });
  check("changing it with the jack: 30 s", r?.ok && r.seconds === 30 && r.price === 0, JSON.stringify(r));
  r = await rpc("finish_flat_fix", {});
  check("…not done straight away", r?.ok === false && r.reason === "wait", JSON.stringify(r));
  await readyNow();
  const mid = await coins();
  r = await rpc("finish_flat_fix", {});
  b = await bike();
  check("…done: a full tyre, back on it, nothing paid", r?.ok && r.remounted && b.tyre === 100 && b.in_use && !b.stranded_at && (await mode()) === "motorbike" && (await coins()) === mid, JSON.stringify(r));

  // ---- A roadside mechanic
  r = await puncture();
  check("another flat", r?.stopped === "flat", JSON.stringify(r));
  r = await rpc("start_flat_fix", { p_how: "mechanic" });
  check("a roadside mechanic: 25 s, 40 coins", r?.ok && r.seconds === 25 && r.price === 40, JSON.stringify(r));
  await readyNow();
  const pre = await coins();
  r = await rpc("finish_flat_fix", {});
  b = await bike();
  check("…done: 40 coins paid, back on it", r?.ok && r.remounted && b.tyre === 100 && b.in_use && (await coins()) === pre - 40, JSON.stringify(r));

  // ---- From far away
  await puncture();
  const away = north(400);
  await admin.from("player_positions").update({ lng: away.lng, lat: away.lat }).eq("user_id", id);
  r = await rpc("start_flat_fix", { p_how: "jack" });
  check("340 m from the motorbike: walk back to it first", r?.ok === false && r.reason === "far", JSON.stringify(r));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

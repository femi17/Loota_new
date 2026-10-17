// Repair shops: a broken-down bicycle gets a shop 250 m–1.2 km away (the same one when asked again); agreeing
// works only inside it and costs 40 coins; it's ready after 2 minutes and is collected as good as new.
// The test player is deleted.   node scripts/tests/repair-shop-api-test.mjs
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
const metres = (a, b) => {
  const k = Math.PI / 180, dLat = (b.lat - a.lat) * k, dLng = (b.lng - a.lng) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const hospital = { lng: 3.3739, lat: 6.5157 }; // around Yaba

try {
  const email = `repair-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: hospital.lng, home_lat: hospital.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: hospital.lng, lat: hospital.lat, mode: "walk", energy: 70, updated_at: ago(60) });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 10, engine: 100, lng: hospital.lng, lat: hospital.lat, in_use: false, broken_at: ago(300) });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => {
    const { data: d, error } = await c.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return d;
  };
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const bike = async () => (await admin.from("player_vehicles").select("*").eq("user_id", id).eq("kind", "bicycle").single()).data;

  check("nothing to repair on a working motorbike", (await rpc("repair_shop", { p_kind: "motorbike" }))?.reason === "not_broken");
  const first = await rpc("repair_shop", { p_kind: "bicycle" });
  const job = first?.job;
  const away = job ? metres(hospital, job) : -1;
  check("a bicycle repair shop near the hospital", first?.ok && away >= 240 && away <= 1250 && job.price === 40 && job.waitS === 120, `${job?.shop}, run by ${job?.keeper}, ${Math.round(away)} m away`);
  check("asking again: the same shop", (await rpc("repair_shop", { p_kind: "bicycle" }))?.job?.id === job.id);
  check("it's on my list", (await rpc("my_repairs")).some((j) => j.id === job.id));

  check("agreeing from the hospital: refused (go to the shop)", (await rpc("repair_agree", { p_job: job.id }))?.reason === "far");
  await admin.from("player_positions").update({ lng: job.lng, lat: job.lat, updated_at: ago(60) }).eq("user_id", id);
  check("at the shop with no coins: refused", (await rpc("repair_agree", { p_job: job.id }))?.reason === "coins");
  await admin.rpc("apply_coin_change", { p_user: id, p_amount: 100, p_kind: "admin", p_reason: "Repair shop test" });
  const agreed = await rpc("repair_agree", { p_job: job.id });
  check("at the shop with coins: 40 paid, ready in 2 minutes", agreed?.ok && (await coins()) === 60 && Math.abs(Date.parse(agreed.job.readyAt) - Date.parse(agreed.job.agreedAt) - 120000) < 1000, JSON.stringify(agreed?.job));
  check("a mechanic can't be called out on top", (await rpc("call_mechanic"))?.reason === "no_vehicle");
  check("collecting too early: not yet", (await rpc("repair_collect", { p_job: job.id }))?.reason === "not_ready");

  await admin.from("repair_jobs").update({ ready_at: ago(1) }).eq("id", job.id);
  await admin.from("player_vehicles").update({ repair_ready_at: ago(1) }).eq("user_id", id).eq("kind", "bicycle");
  const got = await rpc("repair_collect", { p_job: job.id });
  const b = await bike();
  check("collected: as good as new", got?.ok && !b.broken_at && !b.repair_ready_at && b.tyre === 100, JSON.stringify({ broken: b.broken_at, tyre: b.tyre }));
  check("and off the list", (await rpc("my_repairs")).length === 0);
  const { data: price } = await admin.rpc("call_out_price", { p_kind: "bicycle" });
  check("calling a mechanic out now costs more than walking in: 60 for a bicycle", price === 60, String(price));
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

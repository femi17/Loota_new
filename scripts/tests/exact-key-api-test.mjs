// Exact story keys (owner, 31 Oct 2026: "We should not let player pick any of them. The key location has to be in one"):
// a key at the lighthouse inside Galle Fort with exact_m 120.
//   1. A hunter who answers "Galle Fort Hotel" (296 m away, where a search for the fort lands) and gets there is told
//      it's the wrong place, and gets a new 15 seconds to answer;
//   2. answering the lighthouse and getting there puts them in the key's area, with the heat;
//   3. an ordinary key (no exact_m) still counts anywhere within its area, as before.
// The hunts and test hunter are deleted.   node scripts/tests/exact-key-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const ahead = (s) => new Date(Date.now() + s * 1000).toISOString();
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const LIGHT = { lng: 80.2194, lat: 6.0245 };
const HOTEL = { lng: 80.2177, lat: 6.0266 };
let uid = null;
const hunts = [];

async function hunt(exact) {
  const { data, error } = await admin.from("hunts").insert({ title: `Exact key test ${exact ?? "none"} (automated)`, prize: "Test prize (automated)", winners: 1, starts_at: ago(3600), ends_at: ahead(3600), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  hunts.push(data.id);
  await admin.from("hunt_keys").insert({ hunt_id: data.id, n: 1, riddle: "Where was Flora Gelt's light?", category: "general", trial_kind: "sentries", area_lng: LIGHT.lng, area_lat: LIGHT.lat, area_radius_m: 1500, spot_lng: LIGHT.lng, spot_lat: LIGHT.lat, exact_m: exact });
  await admin.from("hunt_players").insert({ hunt_id: data.id, user_id: uid, riddle_n: 1, riddle_at: ago(2) }); // a little in the past: this computer's clock may run ahead of the database's
  return data.id;
}
async function at(spot) {
  await admin.from("player_positions").upsert({ user_id: uid, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 100, updated_at: ago(600) });
}

try {
  const email = `exact-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  uid = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", uid);
  const me = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await me.auth.signInWithPassword({ email, password });

  // 1–2. The exact key
  const exact = await hunt(120);
  const lock1 = await me.rpc("lock_guess", { p_hunt: exact, p_lng: HOTEL.lng, p_lat: HOTEL.lat, p_name: "Galle Fort Hotel" });
  check("the hunter answers the hotel", lock1.data?.ok === true, JSON.stringify(lock1.data ?? lock1.error));
  await at(HOTEL);
  const wrong = await me.rpc("key_pulse", { p_hunt: exact, p_lng: HOTEL.lng, p_lat: HOTEL.lat, p_mode: "walk" });
  check("at the hotel, 296 m from the lighthouse: the wrong place", wrong.data?.inArea === false && wrong.data?.wrongPlace === "Galle Fort Hotel", JSON.stringify(wrong.data ?? wrong.error));
  const { data: hp } = await admin.from("hunt_players").select("guess_n, riddle_n, riddle_at").eq("hunt_id", exact).eq("user_id", uid).single();
  check("…the answer is cleared and a new 15 seconds starts", hp.guess_n === null && hp.riddle_n === 1 && Date.now() - Date.parse(hp.riddle_at) < 30_000, JSON.stringify(hp));
  const lock2 = await me.rpc("lock_guess", { p_hunt: exact, p_lng: LIGHT.lng, p_lat: LIGHT.lat, p_name: "Galle Fort Lighthouse" });
  check("the hunter answers the lighthouse", lock2.data?.ok === true, JSON.stringify(lock2.data ?? lock2.error));
  await at(LIGHT);
  const right = await me.rpc("key_pulse", { p_hunt: exact, p_lng: LIGHT.lng, p_lat: LIGHT.lat, p_mode: "walk" });
  check("at the lighthouse: in the key's area, with the heat", right.data?.inArea === true && typeof right.data?.heat === "number", JSON.stringify(right.data ?? right.error).slice(0, 160));

  // 3. An ordinary key, as before
  const plain = await hunt(null);
  await me.rpc("lock_guess", { p_hunt: plain, p_lng: HOTEL.lng, p_lat: HOTEL.lat, p_name: "Galle Fort Hotel" });
  await at(HOTEL);
  const old = await me.rpc("key_pulse", { p_hunt: plain, p_lng: HOTEL.lng, p_lat: HOTEL.lat, p_mode: "walk" });
  check("an ordinary key: the hotel 296 m away still counts (its area is 1.5 km)", old.data?.inArea === true, JSON.stringify(old.data ?? old.error).slice(0, 160));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  for (const h of hunts) await admin.from("hunts").delete().eq("id", h);
  if (uid) await admin.auth.admin.deleteUser(uid);
  console.log(`test hunts and hunter deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

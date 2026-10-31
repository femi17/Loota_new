// Exact story keys (owner, 31 Oct 2026: "We should not let player pick any of them. The key location has to be in one"):
// a key at the lighthouse inside Galle Fort with exact_m 120.
//   1. A hunter who answers "Galle Fort Hotel" (296 m away, where a search for the fort lands) and gets there is told
//      it's the wrong place, and gets a new 15 seconds to answer;
//   2. answering the lighthouse and getting there puts them in the key's area, with the heat;
//   3. an ordinary key (no exact_m) still counts anywhere within its area, as before;
//   4. penalties (owner, 31 Oct 2026: random, from a table of 600): the wrong place deals a deep one; each kind takes its
//      cost (a wait with no answering, coins, energy, back to where the hunter set off); never the same one twice running.
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
  check("at the hotel, 296 m from the lighthouse: the wrong place", wrong.data?.inArea === false && wrong.data?.wrongPlace === "Galle Fort Hotel", JSON.stringify(wrong.data ?? wrong.error).slice(0, 160));
  check("…and a deep penalty springs", wrong.data?.penalty?.tier === "deep" && !!wrong.data.penalty.title && !!wrong.data.penalty.body, JSON.stringify(wrong.data?.penalty ?? null).slice(0, 200));
  // Whatever it was, clear a wait it may have set, and stand at the hotel again for the rest
  await admin.from("hunt_players").update({ riddle_at: ago(2), guess_n: null }).eq("hunt_id", exact).eq("user_id", uid);
  const { data: hp } = await admin.from("hunt_players").select("guess_n, riddle_n, riddle_at").eq("hunt_id", exact).eq("user_id", uid).single();
  check("…the answer is cleared and a new 15 seconds starts", hp.guess_n === null && hp.riddle_n === 1 && Math.abs(Date.now() - Date.parse(hp.riddle_at)) < 30_000, JSON.stringify(hp));
  const lock2 = await me.rpc("lock_guess", { p_hunt: exact, p_lng: LIGHT.lng, p_lat: LIGHT.lat, p_name: "Galle Fort Lighthouse" });
  check("the hunter answers the lighthouse", lock2.data?.ok === true, JSON.stringify(lock2.data ?? lock2.error));
  await at(LIGHT);
  const right = await me.rpc("key_pulse", { p_hunt: exact, p_lng: LIGHT.lng, p_lat: LIGHT.lat, p_mode: "walk" });
  check("at the lighthouse: this is the place, no hot and cold, the chest right there", right.data?.inArea === true && right.data?.exact === true && right.data?.heat === undefined && !!right.data?.spot, JSON.stringify(right.data ?? right.error).slice(0, 160));

  // 3. An ordinary key, as before
  const plain = await hunt(null);
  await me.rpc("lock_guess", { p_hunt: plain, p_lng: HOTEL.lng, p_lat: HOTEL.lat, p_name: "Galle Fort Hotel" });
  await at(HOTEL);
  const old = await me.rpc("key_pulse", { p_hunt: plain, p_lng: HOTEL.lng, p_lat: HOTEL.lat, p_mode: "walk" });
  check("an ordinary key: the hotel 296 m away still counts (its area is 1.5 km)", old.data?.inArea === true, JSON.stringify(old.data ?? old.error).slice(0, 160));
  // 4. Every kind of penalty takes its cost
  const pen = await hunt(120);
  await at(HOTEL);
  await admin.from("hunt_players").update({ leg_lng: 3.3787, leg_lat: 6.5186 }).eq("hunt_id", pen).eq("user_id", uid);
  const seen = {};
  let last = null, repeated = false, wrongCost = [];
  for (let i = 0; i < 80 && Object.keys(seen).length < 4; i++) {
    await admin.from("profiles").update({ coins: 1000 }).eq("id", uid);
    await admin.from("player_positions").update({ energy: 100, lng: HOTEL.lng, lat: HOTEL.lat }).eq("user_id", uid);
    await admin.from("hunt_players").update({ riddle_at: ago(2) }).eq("hunt_id", pen).eq("user_id", uid);
    const { data: d, error } = await admin.rpc("deal_penalty", { p_user: uid, p_hunt: pen, p_tier: "deep" });
    if (error) throw error;
    if (d.code === last) repeated = true;
    last = d.code;
    const [{ data: prof }, { data: pos }, { data: row }] = await Promise.all([
      admin.from("profiles").select("coins").eq("id", uid).single(),
      admin.from("player_positions").select("energy, lng, lat").eq("user_id", uid).single(),
      admin.from("hunt_players").select("riddle_at").eq("hunt_id", pen).eq("user_id", uid).single(),
    ]);
    const ok =
      d.effect === "wait" ? Math.abs(Date.parse(row.riddle_at) - Date.now() - d.amount * 1000) < 20_000
      : d.effect === "coins" ? prof.coins === 1000 - d.amount
      : d.effect === "energy" ? pos.energy === 100 - d.amount
      : Math.abs(pos.lng - 3.3787) < 1e-6 && Math.abs(pos.lat - 6.5186) < 1e-6;
    if (!ok) wrongCost.push(`${d.code}: ${JSON.stringify({ coins: prof.coins, energy: pos.energy, at: [pos.lat, pos.lng], riddleAt: row.riddle_at })}`);
    if (!seen[d.effect]) {
      seen[d.effect] = d.code;
      if (d.effect === "wait") {
        const early = await me.rpc("lock_guess", { p_hunt: pen, p_lng: LIGHT.lng, p_lat: LIGHT.lat, p_name: "Galle Fort Lighthouse" });
        check("a wait: no new answer until it's over", early.data?.ok === false && early.data?.phase === "wait", JSON.stringify(early.data).slice(0, 140));
      }
    }
  }
  check("every kind of deep penalty came up: a wait, coins, energy, back to the start", ["wait", "coins", "energy", "back"].every((e) => seen[e]), JSON.stringify(seen));
  check("…each took exactly its cost", wrongCost.length === 0, wrongCost.join(" / "));
  check("…and never the same penalty twice in a row", !repeated);
  const { count: deep } = await admin.from("penalties").select("code", { count: "exact", head: true }).eq("tier", "deep");
  const { count: soft } = await admin.from("penalties").select("code", { count: "exact", head: true }).eq("tier", "soft");
  check("the table: 600 penalties, deep and soft", deep + soft >= 600 && deep > 200 && soft > 300, `${deep} deep, ${soft} soft`);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  for (const h of hunts) await admin.from("hunts").delete().eq("id", h);
  if (uid) await admin.auth.admin.deleteUser(uid);
  console.log(`test hunts and hunter deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

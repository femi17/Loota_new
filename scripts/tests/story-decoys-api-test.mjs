// A story hunt without naming a place (owner, 1 Nov 2026: "do we need a modal asking where…? We do not need that. We
// have a search icon, user can use that"). A key at the lighthouse inside Galle Fort (exact 120 m) and a decoy 600 m away.
//   1. The riddle clock is open and never started: nothing to name, nothing to wait for.
//   2. The first pulse marks where the key's leg began (a "back" trap returns there).
//   3. Stopping at the decoy springs a deep trap, naming it; stopping there again springs nothing more.
//   4. At the lighthouse: "This is the place", and the search isn't held back for a named place.
// The hunt and test hunter are deleted.   node scripts/tests/story-decoys-api-test.mjs
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
const DECOY = { lng: 80.2194, lat: 6.03 }; // about 610 m north
const START = { lng: 80.2125, lat: 6.0335 }; // a kilometre or so away
const work = { keys: 1, writer: "test", designs: {}, decoys: {}, map: {}, spent: {}, done: true, log: [], skeleton: { title: "Decoy test", logline: "x", villain: { name: "x", motive: "x" }, heroes: [], worldRules: [], chapters: [], keys: [] }, chapters: {} };
let uid = null, huntId = null;
const at = (spot) => admin.from("player_positions").upsert({ user_id: uid, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 100, updated_at: ago(600) });
const row = async () => (await admin.from("hunt_players").select("riddle_n, riddle_at, leg_n, leg_lng, leg_lat, decoys_sprung").eq("hunt_id", huntId).eq("user_id", uid).single()).data;

try {
  const email = `decoy-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  uid = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 1000 }).eq("id", uid);
  const me = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await me.auth.signInWithPassword({ email, password });
  const { data: h, error } = await admin.from("hunts").insert({ title: "Decoy test (automated)", prize: "Test prize (automated)", winners: 1, starts_at: ago(3600), ends_at: ahead(3600), published: true, all_day: true, story: work, story_status: "ready" }).select("id").single();
  if (error) throw error;
  huntId = h.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where was the light?", category: "general", trial_kind: "sentries", area_lng: LIGHT.lng, area_lat: LIGHT.lat, area_radius_m: 1500, spot_lng: LIGHT.lng, spot_lat: LIGHT.lat, exact_m: 120 });
  await admin.from("hunt_decoys").insert({ hunt_id: huntId, key_n: 1, place: "Galle Clock Tower", lng: DECOY.lng, lat: DECOY.lat });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: uid });

  // 1. No clock
  const opened = await me.rpc("start_riddle", { p_hunt: huntId });
  const r0 = await row();
  check("the clock is open and never started", opened.data?.phase === "open" && opened.data?.story === true && r0.riddle_n === null, `${JSON.stringify(opened.data)}; riddle_n ${r0.riddle_n}`);

  // 2. Where the leg began
  await at(START);
  const p1 = await me.rpc("key_pulse", { p_hunt: huntId, p_lng: START.lng, p_lat: START.lat, p_mode: "walk" });
  const r1 = await row();
  check("away from everything: nothing happens", p1.data?.ok === true && p1.data.inArea === false && !p1.data.wrongPlace, JSON.stringify(p1.data ?? p1.error).slice(0, 160));
  check("…and the leg's start is marked there", r1.leg_n === 1 && Math.abs(r1.leg_lng - START.lng) < 1e-6 && Math.abs(r1.leg_lat - START.lat) < 1e-6, JSON.stringify(r1));

  // 3. The decoy
  await at(DECOY);
  const p2 = await me.rpc("key_pulse", { p_hunt: huntId, p_lng: DECOY.lng, p_lat: DECOY.lat, p_mode: "walk" });
  check("stopping at the decoy springs a deep trap", p2.data?.wrongPlace === "Galle Clock Tower" && p2.data?.penalty?.tier === "deep", JSON.stringify(p2.data ?? p2.error).slice(0, 220));
  await admin.from("hunt_players").update({ riddle_at: null }).eq("hunt_id", huntId).eq("user_id", uid); // whatever wait it set
  await at(DECOY);
  const p3 = await me.rpc("key_pulse", { p_hunt: huntId, p_lng: DECOY.lng, p_lat: DECOY.lat, p_mode: "walk" });
  check("…once: stopping there again springs nothing", p3.data?.ok === true && !p3.data.wrongPlace && !p3.data.penalty, JSON.stringify(p3.data ?? p3.error).slice(0, 160));

  // 4. The place itself
  await at(LIGHT);
  const p4 = await me.rpc("key_pulse", { p_hunt: huntId, p_lng: LIGHT.lng, p_lat: LIGHT.lat, p_mode: "walk" });
  check("at the lighthouse: this is the place", p4.data?.inArea === true && p4.data.exact === true && !p4.data.wrongPlace, JSON.stringify(p4.data ?? p4.error).slice(0, 160));
  await at(LIGHT);
  const s = await me.rpc("search_here", { p_hunt: huntId, p_lng: LIGHT.lng, p_lat: LIGHT.lat, p_mode: "walk" });
  check("…and the search isn't held back for a named place", s.data?.reason !== "answer_first", JSON.stringify(s.data ?? s.error).slice(0, 160));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (uid) await admin.auth.admin.deleteUser(uid);
  console.log(`test hunt and hunter deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

// The riddle clock (owner, 25 Oct 2026: 15 seconds to name the place, else a 60-second wait; no one is told whether
// the place is right), through the real database functions. A throwaway hunt (Key 1 at A); the hunter at home, 5 km
// away. Before the clock: ready. start_riddle: 15 s to answer; Search here refused until answered; an answer after the
// 15 s (+2 s grace): too late, wait; the next window opens after 60 s; locking a wrong place B; travelling to B: the
// answer is cleared and a new 15 s starts; locking A; at A: in the area, no clearing, search works. Deleted after.
//   node scripts/tests/riddle-clock-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, huntId = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const north = (p, m) => ({ lng: p.lng, lat: p.lat + m / 110574 });
const A = { lng: 3.378214, lat: 6.500147 };
const HOME = north(A, 5000);
const B = north(A, 3000); // a wrong answer, outside A's area

try {
  const email = `clock-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Clock test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Clock key.", category: "maths", trial_kind: "sentries", area_lng: A.lng, area_lat: A.lat, area_radius_m: 800, spot_lng: A.lng, spot_lat: A.lat });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => {
    const { data: d, error: e } = await c.rpc(fn, args);
    if (e) console.log("  rpc error", fn, e.message);
    return d;
  };
  const at = (p) => admin.from("player_positions").upsert({ user_id: id, lng: p.lng, lat: p.lat, mode: "walk", energy: 100, updated_at: ago(3600) });
  let skew = 0; // the database's clock minus this computer's
  const clockAgo = (s) => admin.from("hunt_players").update({ riddle_at: new Date(Date.now() + skew - s * 1000).toISOString() }).eq("hunt_id", huntId).eq("user_id", id);
  const lock = (p, name) => rpc("lock_guess", { p_hunt: huntId, p_lng: p.lng, p_lat: p.lat, p_name: name });
  const pulse = async (p) => { await at(p); return rpc("key_pulse", { p_hunt: huntId, p_lng: p.lng, p_lat: p.lat, p_mode: "walk" }); };
  const search = async (p) => {
    await at(p);
    await admin.from("hunt_players").update({ last_search_at: null }).eq("hunt_id", huntId).eq("user_id", id);
    return rpc("search_here", { p_hunt: huntId, p_lng: p.lng, p_lat: p.lat, p_mode: "walk" });
  };
  await at(HOME);

  let s = await rpc("riddle_state", { p_hunt: huntId });
  check("before seeing the riddle: ready", s?.ok && s.phase === "ready", JSON.stringify(s));
  let r = await lock(B, "Somewhere");
  check("…an answer before the clock starts: refused", r?.ok === false && r.reason === "not_started", JSON.stringify(r));
  s = await rpc("start_riddle", { p_hunt: huntId });
  skew = Date.parse(s?.now) - Date.now();
  const left = (Date.parse(s?.endsAt) - Date.parse(s?.now)) / 1000;
  check("start_riddle: 15 seconds to answer", s?.phase === "answer" && left > 13 && left <= 15, `${left} s`);
  const again = await rpc("start_riddle", { p_hunt: huntId });
  check("…starting again doesn't restart it", again?.endsAt === s.endsAt);
  r = await search(HOME);
  check("Search refused until the place is named", r?.ok === false && r.reason === "answer_first", JSON.stringify(r));

  await clockAgo(20);
  s = await rpc("riddle_state", { p_hunt: huntId });
  const wait = (Date.parse(s?.until) - Date.parse(s?.now)) / 1000;
  check("20 s later: waiting, about 55 s to go", s?.phase === "wait" && wait > 53 && wait <= 55, `${s?.phase} ${wait} s`);
  r = await lock(B, "Somewhere");
  check("…an answer now: too late", r?.ok === false && r.reason === "too_late", JSON.stringify(r));
  await clockAgo(16);
  r = await lock(B, "Grace");
  check("16 s in (the network's grace): accepted", r?.ok === true && r.phase === "locked", JSON.stringify(r));
  await admin.from("hunt_players").update({ guess_n: null }).eq("hunt_id", huntId).eq("user_id", id);
  await clockAgo(80);
  s = await rpc("riddle_state", { p_hunt: huntId });
  check("80 s in: the next 15 seconds are open", s?.phase === "answer", JSON.stringify(s));

  r = await lock(B, "Wrong Square");
  check("locked: Wrong Square", r?.ok === true && r.phase === "locked" && r.guess?.name === "Wrong Square", JSON.stringify(r));
  r = await lock(A, "Changed mind");
  check("…can't change it on the way", r?.ok === false && r.reason === "locked");
  const p = await pulse(north(B, 40));
  check("at Wrong Square, outside the key's area: told it's the wrong place", p?.ok && p.wrongPlace === "Wrong Square" && p.inArea === false, JSON.stringify(p));
  s = await rpc("riddle_state", { p_hunt: huntId });
  check("…and a new 15 seconds start", s?.phase === "answer", JSON.stringify(s));
  r = await lock(A, "The right place");
  check("locked the right place", r?.ok === true);
  const p2 = await pulse(north(A, 100));
  check("at it: in the key's area (the answer stays)", p2?.ok && p2.inArea === true && !p2.wrongPlace, JSON.stringify(p2));
  r = await search(north(A, 20));
  check("…and Search here works: the Key Trial", r?.ok === true && r.result === "trial", JSON.stringify(r).slice(0, 120));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

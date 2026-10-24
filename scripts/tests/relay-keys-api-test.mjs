// Relay keys (owner, 24 Oct 2026: "Yes, set per key"), through the real database functions: a hunt of three stops: a
// relay chest at A, Key 1 at B (1 km away), Key 2 back at A. The relay's trial passed gives no key and no bonus, only
// stop 2's riddle; the hunt counts 2 keys, 0 held, "on the trail"; the news says "relay"; at B the trial gives Key 1
// (first to it: +100); the leaderboard and lobby count real keys; nobody can ask which stops are relays. The hunt and
// test player are deleted.
//   node scripts/tests/relay-keys-api-test.mjs
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
const A = { lng: 3.378214, lat: 6.500147 };
const B = { lng: 3.378214, lat: 6.500147 + 1000 / 110574 };

try {
  const email = `relay-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: A.lng, home_lat: A.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: A.lng, lat: A.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Relay test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, questions_per_trial: 2 })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  const stop = (n, at, relay, riddle) => ({ hunt_id: huntId, n, riddle, category: "maths", trial_kind: "quiz", relay, area_lng: at.lng, area_lat: at.lat, area_radius_m: 400, spot_lng: at.lng, spot_lat: at.lat });
  await admin.from("hunt_keys").insert([stop(1, A, true, "Where the test begins."), stop(2, B, false, "North of the start, 1 km."), stop(3, A, false, "Back where you began.")]);
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => (await c.rpc(fn, args)).data;
  const at = async (p) => {
    await admin.from("player_positions").update({ lng: p.lng, lat: p.lat, updated_at: ago(30) }).eq("user_id", id);
    await admin.from("hunt_players").update({ last_search_at: null }).eq("hunt_id", huntId).eq("user_id", id);
  };
  /** Search at the spot and answer the quiz right, to the end. */
  const winTrial = async (p) => {
    await at(p);
    const s = await rpc("search_here", { p_hunt: huntId, p_lng: p.lng, p_lat: p.lat, p_mode: "walk" });
    let attempt = s?.trial?.attempt;
    let r = null;
    for (let i = 0; i < 5 && attempt; i++) {
      const { data: t } = await admin.from("trial_attempts").select("questions, current").eq("id", attempt).single();
      r = await rpc("answer_trial", { p_attempt: attempt, p_choice: Number(t.questions[t.current].answer) });
      if (r?.result !== "next") break;
    }
    return r;
  };

  let st = await rpc("hunt_state", { p_hunt: huntId });
  check("the hunt counts its keys, not its stops: 2", st?.keys === 2 && st.keysHeld === 0 && st.trail === false, `${st?.keysHeld}/${st?.keys}`);

  // ---- The relay chest at A
  let r = await winTrial(A);
  check("the relay chest's trial passed: no key, only a clue (stop 2's riddle)", r?.result === "relay" && r.key === 1 && r.riddle === "North of the start, 1 km." && r.keysHeld === 0, JSON.stringify(r));
  const { count: bonuses } = await admin.from("hunt_bonuses").select("*", { count: "exact", head: true }).eq("hunt_id", huntId);
  check("…no bonus for a relay", bonuses === 0, `${bonuses}`);
  st = await rpc("hunt_state", { p_hunt: huntId });
  check("…the hunt card: Key 1 of 2, on the trail, the new riddle", st.keysHeld === 0 && st.keys === 2 && st.trail === true && st.riddle === "North of the start, 1 km.", JSON.stringify({ k: st.keysHeld, t: st.trail, r: st.riddle }));
  const feed = await rpc("hunt_feed", { p_hunt: huntId, p_since: ago(120) });
  check("…the news: a relay chest toward Key 1", feed.events.some((e) => e.kind === "relay" && e.key === 1 && e.mine), JSON.stringify(feed.events.map((e) => e.kind)));
  const pulseA = await rpc("key_pulse", { p_hunt: huntId, p_lng: A.lng, p_lat: A.lat, p_mode: "walk" });
  check("…the detector now leads away from A (stop 2 is at B)", pulseA?.ok && !(pulseA.spot), JSON.stringify(pulseA).slice(0, 100));

  // ---- The key at B
  r = await winTrial(B);
  check("at B: Key 1 (first to it: +100)", r?.result === "key" && r.keysHeld === 1 && r.keys === 2 && (r.bonuses ?? []).some((b) => b.kind === "first"), JSON.stringify(r).slice(0, 160));
  st = await rpc("hunt_state", { p_hunt: huntId });
  check("…the card: Key 2 of 2, off the trail", st.keysHeld === 1 && st.trail === false && st.riddle === "Back where you began.");
  const board = await rpc("hunt_board", { p_hunt: huntId });
  check("the leaderboard: 1 key", board.find((b) => b.me)?.keysHeld === 1, JSON.stringify(board));
  const lobby = await rpc("list_hunts");
  check("the lobby: 2 keys", lobby.find((h) => h.id === huntId)?.keys === 2);

  // ---- Key 2: finished
  r = await winTrial(A);
  check("Key 2: the hunt finished", r?.result === "finished" && r.keysHeld === 2 && r.keys === 2, JSON.stringify(r).slice(0, 120));
  const recap = await rpc("hunt_recap", { p_hunt: huntId });
  check("the recap: 2 keys, each counted once", recap.keys === 2 && recap.keysHeld === 2 && recap.perKey.length === 2 && recap.perKey[0].key === 1 && recap.perKey[0].tries === 2,
    JSON.stringify(recap.perKey));

  const peek = await c.rpc("stop_key", { p_hunt: huntId, p_n: 2 });
  check("players can't ask which stops are relays", !!peek.error, peek.error?.message);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_bonuses").delete().eq("hunt_id", huntId);
    await admin.from("hunt_catchups").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

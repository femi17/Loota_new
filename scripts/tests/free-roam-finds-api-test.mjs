// The lamp's finds in free roam, with smaller rewards (owner, 22 Oct 2026), through the real database functions.
// Outside a hunt: the lamp holds something, a 40-coin find gives 20, a Detour pays half (a Radar one: 60 coins, no
// Radar), the Lockdown Orb isn't shown and can't be taken. In a live hunt: full rewards. The finds, Detours, hunt and
// test player made here are deleted.
//   node scripts/tests/free-roam-finds-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null, huntId = null;
const items = [], detours = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const later = (s) => new Date(Date.now() + s * 1000).toISOString();
const yaba = { lng: 3.3787, lat: 6.5186 };
const cell = `${Math.floor(yaba.lng / 0.005)}:${Math.floor(yaba.lat / 0.005)}`;

try {
  const email = `free-roam-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 100, updated_at: ago(60) });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => (await c.rpc(fn, args)).data;
  const plant = async (row) => {
    const { data: it, error } = await admin.from("world_items").insert({ cell, lng: yaba.lng, lat: yaba.lat, expires_at: later(3600), ...row }).select("id").single();
    if (error) throw error;
    items.push(it.id);
    return it.id;
  };
  const detour = async (row) => {
    const { data: d, error } = await admin.from("detours")
      .insert({ kind: "flash", area: "test", title: "A test pouch", story: "Test", place_name: "Here", lng: yaba.lng, lat: yaba.lat, ends_at: later(1800), ...row })
      .select("id").single();
    if (error) throw error;
    detours.push(d.id);
    return d.id;
  };
  /** Start a Detour and answer it right (the answer is read from the claim, as the test can). */
  const winDetour = async (d) => {
    const s = await rpc("start_detour", { p_detour: d });
    if (!s?.ok) return s;
    const { data: claim } = await admin.from("detour_claims").select("question").eq("detour_id", d).eq("user_id", id).single();
    return rpc("answer_detour", { p_detour: d, p_choice: Number(claim.question.answer) });
  };
  const relics = async (relic) => (await admin.from("player_relics").select("id", { count: "exact", head: true }).eq("user_id", id).eq("relic", relic)).count;

  // ---- Free roam
  const lamp = await rpc("lamp_state");
  check("free roam: the lamp holds something", !!lamp.current && lamp.hunt === false, lamp.current ? lamp.current.type : "empty");
  const coinsFind = await plant({ kind: "coins", coins: 40 });
  const orb = await plant({ kind: "relic", relic: "lockdown_orb" });
  const near = await rpc("world_nearby");
  const shown = near.items.map((i) => i.id);
  check("free roam: finds on the map", shown.includes(coinsFind));
  check("…but not the Lockdown Orb", !shown.includes(orb));
  let r = await rpc("pickup_item", { p_item: coinsFind, p_lng: yaba.lng, p_lat: yaba.lat, p_mode: "walk" });
  check("a 40-coin find: 20 coins in free roam", r?.ok && r.coins === 20 && r.freeRoam === true, JSON.stringify(r));
  r = await rpc("pickup_item", { p_item: orb, p_lng: yaba.lng, p_lat: yaba.lat, p_mode: "walk" });
  check("the Orb can't be taken in free roam", r?.ok === false && r.reason === "no_hunt", JSON.stringify(r));
  r = await winDetour(await detour({ reward_coins: 80 }));
  check("an 80-coin Detour: 40 coins in free roam", r?.outcome === "won" && r.coins === 40, JSON.stringify(r));
  r = await winDetour(await detour({ reward_relic: "radar" }));
  check("a Radar Detour: 60 coins instead, and no Radar", r?.outcome === "won" && r.coins === 60 && !r.relic && (await relics("radar")) === 0, JSON.stringify(r));
  r = await winDetour(await detour({ reward_relic: "shield" }));
  check("a Shield Detour: still the Shield", r?.outcome === "won" && r.relic === "shield" && (await relics("shield")) === 1, JSON.stringify(r));

  // ---- In a live hunt: full rewards
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Finds test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: later(3600), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "A test key far away.", category: "maths", area_lng: 3.45, area_lat: 6.6, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.6 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  r = await rpc("pickup_item", { p_item: await plant({ kind: "coins", coins: 40 }), p_lng: yaba.lng, p_lat: yaba.lat, p_mode: "walk" });
  check("in a hunt: the full 40 coins", r?.ok && r.coins === 40 && r.freeRoam === false, JSON.stringify(r));
  r = await winDetour(await detour({ reward_coins: 80 }));
  check("in a hunt: the full 80 from a Detour", r?.outcome === "won" && r.coins === 80, JSON.stringify(r));
  r = await winDetour(await detour({ reward_relic: "radar" }));
  check("in a hunt: the Radar itself", r?.outcome === "won" && r.relic === "radar" && (await relics("radar")) === 1, JSON.stringify(r));
  check("in a hunt: the Orb shows on the map", (await rpc("world_nearby")).items.some((i) => i.id === orb));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (items.length) await admin.from("world_items").delete().in("id", items);
  if (detours.length) {
    await admin.from("detour_claims").delete().in("detour_id", detours);
    await admin.from("detours").delete().in("id", detours);
  }
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`finds, Detours, hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

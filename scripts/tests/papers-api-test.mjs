// Gear, papers and road events in free roam, through the real database functions: buying a bicycle light, a helmet,
// a rider's licence and registration (once only; not without the coins or the vehicle); a checkpoint in free roam
// stopping a motorbike rider with no papers (a fine for each missing), and passing one with all of them; a traveller
// helped in free roam (15 coins, no hunt hint). The test players are deleted.   node scripts/tests/papers-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ids = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const spot = { lng: 3.378214, lat: 6.500147 };

async function player(tag, coins) {
  const email = `papers-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  if (coins) await admin.rpc("apply_coin_change", { p_user: data.user.id, p_amount: coins, p_kind: "admin", p_reason: "Papers test" });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  return { id: data.user.id, c };
}
const coins = async (id) => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;

try {
  // ---- Buying gear and papers
  const rider = await player("rider", 1000);
  await admin.from("player_vehicles").insert([
    { user_id: rider.id, kind: "bicycle", fuel: 0, tyre: 100, engine: 100, lng: spot.lng, lat: spot.lat, in_use: false },
    { user_id: rider.id, kind: "motorbike", fuel: 80, tyre: 100, engine: 100, lng: spot.lng, lat: spot.lat, in_use: true },
  ]);
  let r = (await rider.c.rpc("buy_addon", { p_addon: "light", p_kind: "bicycle" })).data;
  check("a bicycle light: 40 coins", r?.ok && r.price === 40 && (await coins(rider.id)) === 960, JSON.stringify(r));
  r = (await rider.c.rpc("buy_addon", { p_addon: "light", p_kind: "bicycle" })).data;
  check("…only once", r?.reason === "have" && (await coins(rider.id)) === 960);
  r = (await rider.c.rpc("buy_addon", { p_addon: "insurance", p_kind: "car" })).data;
  check("car insurance with no car: refused", r?.reason === "no_vehicle");
  r = (await rider.c.rpc("buy_addon", { p_addon: "helmet", p_kind: "bicycle" })).data;
  check("a helmet for a bicycle: not a thing", r?.reason === "unknown");
  const broke = await player("broke", 50);
  await admin.from("player_vehicles").insert({ user_id: broke.id, kind: "motorbike", fuel: 80, tyre: 100, engine: 100, lng: spot.lng, lat: spot.lat, in_use: true });
  r = (await broke.c.rpc("buy_addon", { p_addon: "helmet", p_kind: "motorbike" })).data;
  check("a helmet without the coins: refused", r?.reason === "coins" && r.price === 80 && (await coins(broke.id)) === 50);

  // ---- A free-roam checkpoint on a motorbike with no papers: a fine for each missing
  await admin.from("player_positions").upsert({ user_id: broke.id, lng: spot.lng, lat: spot.lat, mode: "motorbike", energy: 90, updated_at: new Date().toISOString() });
  let ev = null;
  for (let i = 0; i < 30 && !ev; i++) {
    const out = (await broke.c.rpc("road_event_roll", { p_hunt: null })).data;
    if (out?.event?.kind === "checkpoint") ev = out.event;
    else if (out?.event) await admin.from("road_events").delete().eq("id", out.event.id); // a traveller: roll again
  }
  check("free roam (no hunt): a road event rolls, and on a motorbike a checkpoint", !!ev, ev ? `${ev.npc}` : "none in 30 rolls");
  check("…the officer finds no helmet, licence or registration", JSON.stringify(ev?.missing) === JSON.stringify(["helmet", "rider_licence", "registration"]), JSON.stringify(ev?.missing));
  const row = (await admin.from("road_events").select("hunt_id").eq("id", ev.id).single()).data;
  check("…not tied to any hunt", row.hunt_id === null);
  r = (await broke.c.rpc("road_event_answer", { p_event: ev.id, p_choice: 0 })).data;
  check("…fined (50 coins was all they had; 60 due)", r?.outcome === "fined" && r.fine === 50 && (await coins(broke.id)) === 0, JSON.stringify(r).slice(0, 120));

  // ---- All papers in order: the usual question, and through
  for (const a of ["helmet", "rider_licence", "registration"]) await rider.c.rpc("buy_addon", { p_addon: a, p_kind: "motorbike" });
  check("helmet + rider's licence + registration bought (80 + 150 + 200)", (await coins(rider.id)) === 960 - 430, String(await coins(rider.id)));
  await admin.from("player_positions").upsert({ user_id: rider.id, lng: spot.lng, lat: spot.lat, mode: "motorbike", energy: 90, updated_at: new Date().toISOString() });
  const { data: ok } = await admin.from("road_events").insert({ user_id: rider.id, kind: "checkpoint", npc: "Officer Bello", question: { prompt: "What does a red traffic light mean?", choices: ["Go faster", "Stop", "Turn left only"], answer: 1 }, missing: [] }).select("id").single();
  r = (await rider.c.rpc("road_event_answer", { p_event: ok.id, p_choice: 1 })).data;
  check("papers in order, the right answer: passed, no fine", r?.outcome === "passed" && r.fine === 0);

  // ---- A traveller helped in free roam: a thank-you gift (15 coins, or since 19 Oct a relic, a jerry can or a tyre kit)
  const before = await coins(rider.id);
  const { data: tr } = await admin.from("road_events").insert({ user_id: rider.id, kind: "traveller", npc: "Blessing" }).select("id").single();
  r = (await rider.c.rpc("road_event_answer", { p_event: tr.id, p_choice: 1 })).data;
  const paid = r?.gift?.kind === "coins" ? 15 : 0;
  check("a traveller helped in free roam: a gift, no hunt hint", r?.outcome === "helped" && !!r.gift && r.reward === paid && !r.hint && (await coins(rider.id)) === before + paid, JSON.stringify(r).slice(0, 120));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  for (const id of ids) {
    await admin.from("road_events").delete().eq("user_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}

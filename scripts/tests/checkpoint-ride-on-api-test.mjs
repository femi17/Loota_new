// Riding past a police checkpoint (owner, 22 Oct 2026; 25 Oct 2026: "if you escape police, they should give you a
// chase"), through the real database functions. Ridden past: no die any more, the police give chase: a patrol car at
// 40 km/h after a motorbike, 24 after a bicycle, an officer on foot at 7 after a walker. Caught: a 50-coin fine (2.5
// times stopping's 20), really taken, a 60 s hold, stored as fined; with two papers missing, 100. Lost them: nothing
// taken, stored as declined. A chase is settled once. The test player is deleted.
//   node scripts/tests/checkpoint-ride-on-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const at = { lng: 3.3787, lat: 6.5186 };

try {
  const email = `rideon-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const coins = async () => Number((await admin.from("profiles").select("coins").eq("id", id).single()).data.coins);
  const question = { prompt: "What does a red traffic light mean?", choices: ["Go", "Stop", "Turn"], answer: 1 };
  await admin.from("profiles").update({ coins: 1000 }).eq("id", id);
  const checkpoint = async (missing = []) =>
    (await admin.from("road_events").insert({ user_id: id, kind: "checkpoint", npc: "Officer Bello", question, missing }).select("id").single()).data.id;
  const rideOn = async (mode) => {
    await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode, energy: 100, updated_at: new Date().toISOString() });
    const ev = await checkpoint();
    return { ev, r: (await c.rpc("road_event_answer", { p_event: ev, p_choice: -3 })).data };
  };

  // Who gives chase, by how you travel.
  let { ev, r } = await rideOn("motorbike");
  check("on a motorbike: a patrol car gives chase at 40 km/h, 60 m behind", r?.outcome === "chase" && r.chase?.chaser === "patrol" && r.chase.kmh === 40 && r.chase.gapM === 60 && r.fine === 0 && r.holdS === 0, JSON.stringify(r?.chase));
  const before = await coins();
  let end = (await c.rpc("police_chase_end", { p_event: ev, p_caught: true })).data;
  check("caught: a 50-coin fine (stopping costs 20), held 60 s", end?.ok && end.fine === 50 && end.holdS === 60 && Number(end.balance) === before - 50, JSON.stringify(end));
  check("…really taken", (await coins()) === before - 50);
  end = (await c.rpc("police_chase_end", { p_event: ev, p_caught: false })).data;
  check("…and settled once (no second ending)", end?.ok === false && end.reason === "gone");
  let stored = (await admin.from("road_events").select("outcome").eq("id", ev).single()).data.outcome;
  check("…stored as fined", stored === "fined", stored);

  ({ ev, r } = await rideOn("bicycle"));
  check("on a bicycle: a patrol car at 24 km/h", r?.chase?.chaser === "patrol" && r.chase.kmh === 24, JSON.stringify(r?.chase));
  const before2 = await coins();
  end = (await c.rpc("police_chase_end", { p_event: ev, p_caught: false })).data;
  check("lost them: nothing taken", end?.ok && end.fine === 0 && end.holdS === 0 && (await coins()) === before2, JSON.stringify(end));
  stored = (await admin.from("road_events").select("outcome").eq("id", ev).single()).data.outcome;
  check("…stored as declined", stored === "declined", stored);

  ({ ev, r } = await rideOn("walk"));
  check("on foot: an officer runs after you at 7 km/h", r?.chase?.chaser === "officer" && r.chase.kmh === 7, JSON.stringify(r?.chase));

  // Two papers missing: caught costs 100.
  const ev2 = await checkpoint(["rider_licence", "registration"]);
  await c.rpc("road_event_answer", { p_event: ev2, p_choice: -3 });
  end = (await c.rpc("police_chase_end", { p_event: ev2, p_caught: true })).data;
  check("two papers missing, caught: 100 coins", end?.fine === 100, JSON.stringify(end));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

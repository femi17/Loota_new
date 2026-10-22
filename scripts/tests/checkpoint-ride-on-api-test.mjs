// Riding past a police checkpoint (owner, 22 Oct 2026: "Chance of a fine"), through the real database function: 40
// checkpoints ridden past: mostly got away with it, sometimes caught: a 50-coin fine (2.5 times stopping's 20), each
// one really taken, and a 60 s hold; with two papers missing, caught costs 100. The test player is deleted.
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

try {
  const email = `rideon-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const coins = async () => Number((await admin.from("profiles").select("coins").eq("id", id).single()).data.coins);
  const question = { prompt: "What does a red traffic light mean?", choices: ["Go", "Stop", "Turn"], answer: 1 };
  await admin.from("profiles").update({ coins: 5000 }).eq("id", id); // enough to be fined 40 times

  let escaped = 0, caught = 0, rightFine = true, taken = true, held = true;
  for (let i = 0; i < 40; i++) {
    const before = await coins();
    const { data: ev } = await admin.from("road_events").insert({ user_id: id, kind: "checkpoint", npc: "Officer Bello", question }).select("id").single();
    const r = (await c.rpc("road_event_answer", { p_event: ev.id, p_choice: -3 })).data;
    const after = await coins();
    if (r?.outcome === "escaped") {
      escaped++;
      if (after !== before || r.holdS !== 0) taken = false;
    } else if (r?.outcome === "caught") {
      caught++;
      if (r.fine !== 50) rightFine = false;
      if (after !== before - 50) taken = false;
      if (r.holdS !== 60) held = false;
    }
  }
  check("40 checkpoints ridden past: every one got away with or caught", escaped + caught === 40, `${escaped} escaped, ${caught} caught`);
  check("…mostly got away with it (about 60%)", escaped >= 15 && escaped <= 35, `${escaped}/40`);
  check("…sometimes caught", caught >= 5, `${caught}/40`);
  check("caught: a 50-coin fine (stopping costs 20)", rightFine);
  check("…really taken (and nothing taken when you get away)", taken);
  check("…and held 60 s", held);

  // Two papers missing: stopping costs 40, caught riding past 100.
  let missingFine = null;
  for (let i = 0; i < 30 && missingFine === null; i++) {
    const { data: ev } = await admin.from("road_events").insert({ user_id: id, kind: "checkpoint", npc: "Officer Bello", missing: ["rider_licence", "registration"] }).select("id").single();
    const r = (await c.rpc("road_event_answer", { p_event: ev.id, p_choice: -3 })).data;
    if (r?.outcome === "caught") missingFine = r.fine;
  }
  check("two papers missing, caught: 100 coins", missingFine === 100, String(missingFine));
  const stored = (await admin.from("road_events").select("outcome").eq("user_id", id)).data.map((e) => e.outcome);
  check("stored as fined or declined", stored.every((o) => o === "fined" || o === "declined"), [...new Set(stored)].join(", "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

// Hunt hours and the Lamp's rest (owner, 26 Oct 2026), through the real database functions and the game's helpers.
// Hunts run 9 am to 9 pm Lagos time: the server's rule (hunt_phase: 'paused' outside those hours, unless a hunt runs
// all day, as the tests' do) agrees with the game's (huntResting, huntResumesAt) at every hour of a day, and a real
// hunt reads 'live' or 'paused' right now as the clock says. The Lamp: a Detour let go, the lamp rests 15 minutes
// (no next thing, "restUntil"), then the next comes. The test player and Detours are deleted.
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/hunt-hours-lamp-rest-api-test.mjs
import { createRequire } from "node:module";
import { huntResting, huntResumesAt } from "../../src/game/hunt.ts";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null, huntId = null;
const detourIds = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const at = { lng: 3.3787, lat: 6.5186 };

try {
  // ---- The hours, hour by hour (Lagos is UTC+1)
  const day = Date.UTC(2026, 9, 27, 0) - 3600e3; // midnight in Lagos
  const rest = [];
  for (let h = 0; h < 24; h++) if (huntResting(day + h * 3600e3 + 30 * 60e3)) rest.push(h);
  check("the game rests 9 pm – 9 am Lagos time", JSON.stringify(rest) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 21, 22, 23]), rest.join(","));
  const back = huntResumesAt(day + 22 * 3600e3); // 10 pm
  check("…and at 10 pm, back at 9 am the next day", back === day + 33 * 3600e3, new Date(back).toISOString());
  check("…at 8:30 am, back at 9 the same day", huntResumesAt(day + 8.5 * 3600e3) === day + 9 * 3600e3);

  // A real (not all-day) hunt, live by the clock: its phase now.
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Hours test (automated)", prize: "none", winners: 1, starts_at: new Date(Date.now() - 600e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  const { data: listed } = await admin.from("hunts").select("id").eq("id", huntId).single();
  const email = `hours-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const st = (await c.rpc("hunt_state", { p_hunt: listed.id })).data;
  const want = huntResting(Date.now()) ? "paused" : "live";
  check(`a real hunt right now: ${want} (as the clock says)`, st?.phase === want, st?.phase);

  // ---- The Lamp's rest
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  const area = `${Math.floor(at.lng / 0.1)}:${Math.floor(at.lat / 0.1)}`;
  const detour = async (title) => {
    const { data: d, error: e } = await admin.from("detours").insert({
      kind: "flash", area, title, story: "A test.", place_name: "Test place", lng: at.lng + 0.01, lat: at.lat, reward_coins: 10, ends_at: new Date(Date.now() + 1800e3).toISOString(),
    }).select("id").single();
    if (e) throw e;
    detourIds.push(d.id);
    return d.id;
  };
  await detour("First test detour");
  await detour("Second test detour");
  let s = (await c.rpc("lamp_state")).data;
  check("the lamp holds a Detour", s?.current?.type === "detour", s?.current?.title);
  await c.rpc("lamp_dismiss", { p_kind: "detour", p_id: s.current.id });
  s = (await c.rpc("lamp_state")).data;
  const restFor = s?.restUntil ? (Date.parse(s.restUntil) - Date.parse(s.now)) / 60000 : null;
  check("let go: the lamp rests (nothing next), about 15 minutes", s?.current === null && restFor !== null && restFor > 14.5 && restFor <= 15, `${restFor?.toFixed(1)} min`);
  await admin.from("player_lamp").update({ rest_until: new Date(Date.now() - 1000).toISOString() }).eq("user_id", id);
  s = (await c.rpc("lamp_state")).data;
  check("after the rest: the next one", s?.current?.type === "detour" && !s.restUntil, s?.current?.title);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (detourIds.length) {
    await admin.from("lamp_dismissed").delete().eq("user_id", id);
    await admin.from("detours").delete().in("id", detourIds);
  }
  if (huntId) await admin.from("hunts").delete().eq("id", huntId);
  if (id) {
    await admin.from("player_lamp").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player, hunt and Detours deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

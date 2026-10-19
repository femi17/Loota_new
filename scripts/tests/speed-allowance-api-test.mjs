// save_position's distance allowance (19 Oct 2026): honest riding at top speed passes even when saves reach the server
// unevenly (a late one followed by a quick one), while a teleport and riding at twice the top speed are still refused.
// The test players are deleted.   node scripts/tests/speed-allowance-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.0, lat: 7.0 };
const SPEED = 116.67; // a motorbike's top speed, m/s of map
const north = (m) => m / 110574; // degrees of latitude for m metres

async function rider(tag) {
  const email = `speed-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  await admin.from("profiles").update({ home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString() }).eq("id", data.user.id);
  await admin.from("player_vehicles").insert({ user_id: data.user.id, kind: "motorbike", fuel: 100, tyre: 100, engine: 100, lng: start.lng, lat: start.lat, in_use: true });
  await admin.from("player_positions").upsert({ user_id: data.user.id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: new Date().toISOString() });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  return c;
}
const save = async (c, m) => (await c.rpc("save_position", { p_lng: start.lng, p_lat: start.lat + north(m), p_mode: "motorbike" })).data;

try {
  // Honest, unevenly delivered: saves 3.5 s and 0.5 s apart on the server, each carrying 2 s of top-speed riding.
  const honest = await rider("honest");
  let at = 0, refused = 0;
  for (let i = 0; i < 8; i++) {
    await wait(i % 2 ? 500 : 3500);
    at += SPEED * 2;
    if (!(await save(honest, at))?.ok) refused++;
  }
  check("top speed, saves arriving unevenly (3.5 s, 0.5 s…): never refused", refused === 0, `${refused} refused of 8`);

  // A teleport: 3 km at once.
  const jumper = await rider("jump");
  await wait(2000);
  const r = await save(jumper, 3000);
  check("a 3 km jump after 2 s: refused", r?.ok === false && r.reason === "speed");

  // Twice the top speed, saved every 2 s: refused once the allowance runs out.
  const cheat = await rider("cheat");
  let pos = 0, firstRefusal = null;
  for (let i = 1; i <= 14 && firstRefusal === null; i++) {
    await wait(2000);
    pos += SPEED * 2 * 2;
    const out = await save(cheat, pos);
    if (!out?.ok) firstRefusal = i;
  }
  check("twice the top speed: refused within 30 s", firstRefusal !== null, firstRefusal ? `at save ${firstRefusal}` : "never");
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}

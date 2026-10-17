// Finds belong to hunts: outside a live hunt the lamp is empty, nothing is found and no Detour can be
// claimed; once in a live hunt, the lamp fills. Needs a live hunt to join. Test players are deleted.
//   node scripts/tests/hunt-only-finds-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ids = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
try {
  const yaba = { lng: 3.3787, lat: 6.5186 };
  const email = `hunt-only-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", updated_at: ago(60) });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => (await c.rpc(fn, args)).data;

  // ---- Not in a hunt
  const lamp0 = await rpc("lamp_state");
  check("outside a hunt: the lamp is empty and says so", lamp0.current === null && lamp0.hunt === false);
  const near0 = await rpc("world_nearby");
  check("outside a hunt: no finds, and nothing stocked", near0.items.length === 0 && near0.staleCells.length === 0);
  const { data: anyDetour } = await admin.from("detours").select("id").gt("ends_at", new Date().toISOString()).limit(1);
  if (anyDetour?.length) check("outside a hunt: a Detour can't be claimed", (await rpc("start_detour", { p_detour: anyDetour[0].id }))?.reason === "no_hunt");

  // ---- In a live hunt
  const { data: hunts } = await c.rpc("list_hunts");
  const live = (hunts ?? []).find((h) => h.phase === "live");
  if (!live) console.log("no live hunt to join: the in-hunt checks are skipped");
  else {
    await rpc("join_hunt", { p_hunt: live.id });
    const lamp1 = await rpc("lamp_state");
    check("in a live hunt: the lamp holds something", !!lamp1.current && lamp1.hunt !== false, lamp1.current ? `${lamp1.current.type}: ${lamp1.current.title ?? ""}` : "");
  }
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

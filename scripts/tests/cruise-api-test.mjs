// Cruise tokens (owner, 25 Oct 2026: 15 s each, up to 8; from the streets, travellers, buying, and 2 free a day),
// through the real database functions. The day's 2 free once (not twice); a token spent; none left: refused; buying 4
// for 40 coins, then only what fits (up to 8), then "full"; a token in the street: listed within 600 m, picked up within
// 40 m (+1), "far" from 100 m, "gone" once taken, "full" at 8. The test player and drops are deleted.
//   node scripts/tests/cruise-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null;
const dropIds = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const at = { lng: 3.3787, lat: 6.5186 };
const north = (p, m) => ({ lng: p.lng, lat: p.lat + m / 110574 });

try {
  const email = `cruise-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ coins: 100 }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => (await c.rpc(fn, args)).data;
  const tokens = async () => (await admin.from("profiles").select("cruise_tokens").eq("id", id).single()).data.cruise_tokens;

  let s = await rpc("cruise_state");
  check("the day's 2 free tokens", s?.tokens === 2 && s.daily === true && s.max === 8, JSON.stringify(s));
  s = await rpc("cruise_state");
  check("…only once a day", s?.tokens === 2 && s.daily === false, JSON.stringify(s));
  let r = await rpc("use_cruise_token");
  check("a token spent: 1 left", r?.ok && r.tokens === 1);
  await rpc("use_cruise_token");
  r = await rpc("use_cruise_token");
  check("none left: refused", r?.ok === false && r.reason === "none");

  r = await rpc("buy_cruise_tokens");
  check("bought 4 for 40 coins", r?.ok && r.bought === 4 && r.tokens === 4 && Number(r.balance) === 60, JSON.stringify(r));
  await admin.from("profiles").update({ cruise_tokens: 6 }).eq("id", id);
  r = await rpc("buy_cruise_tokens");
  check("…then only what fits: 2 for 20 (8 at most)", r?.ok && r.bought === 2 && r.tokens === 8 && Number(r.balance) === 40, JSON.stringify(r));
  r = await rpc("buy_cruise_tokens");
  check("…then full", r?.ok === false && r.reason === "full");

  // A token in the street.
  await admin.from("profiles").update({ cruise_tokens: 3 }).eq("id", id);
  const plant = async (p) => {
    const { data: d } = await admin.from("cruise_drops").insert({ cell: "test", lng: p.lng, lat: p.lat, expires_at: new Date(Date.now() + 3600e3).toISOString() }).select("id").single();
    dropIds.push(d.id);
    return d.id;
  };
  const nearDrop = await plant(north(at, 20));
  const farDrop = await plant(north(at, 100));
  const listed = await rpc("cruise_drops_near");
  check("tokens within 600 m are listed", listed.some((d) => d.id === nearDrop) && listed.some((d) => d.id === farDrop), `${listed.length}`);
  r = await rpc("take_cruise_drop", { p_drop: nearDrop });
  check("20 m away: picked up, +1", r?.ok && r.tokens === 4 && (await tokens()) === 4, JSON.stringify(r));
  r = await rpc("take_cruise_drop", { p_drop: farDrop });
  check("100 m away: too far", r?.ok === false && r.reason === "far");
  r = await rpc("take_cruise_drop", { p_drop: nearDrop });
  check("taken already: gone", r?.ok === false && r.reason === "gone");
  check("…and no longer listed", !(await rpc("cruise_drops_near")).some((d) => d.id === nearDrop));
  await admin.from("profiles").update({ cruise_tokens: 8 }).eq("id", id);
  const fullDrop = await plant(north(at, 10));
  r = await rpc("take_cruise_drop", { p_drop: fullDrop });
  check("at 8: full (it stays in the street)", r?.ok === false && r.reason === "full");
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (dropIds.length) await admin.from("cruise_drops").delete().in("id", dropIds);
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test player and drops deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

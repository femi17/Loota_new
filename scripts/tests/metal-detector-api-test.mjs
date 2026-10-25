// The metal detector (owner, 25 Oct 2026: bought once for 300 coins, kept; it beeps near a key and reaches 1.5 times
// farther), through the real database functions. With 250 coins: refused; with 400: bought, 100 left, a ledger line;
// again: already yours. key_pulse 1.15 km from the key (its area 800 m): out of reach without one, in the area with
// one, and it says so ("detector"). The hunt and test player are deleted.
//   node scripts/tests/metal-detector-api-test.mjs
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
const KEY = { lng: 3.378214, lat: 6.500147 };
const FAR = north(KEY, 1150);

try {
  const email = `detector-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ coins: 250, home_lng: FAR.lng, home_lat: FAR.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Detector test (automated)", prize: "none", winners: 1, starts_at: ago(3 * 3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Detector key.", category: "maths", trial_kind: "sentries", area_lng: KEY.lng, area_lat: KEY.lat, area_radius_m: 800, spot_lng: KEY.lng, spot_lat: KEY.lat });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => (await c.rpc(fn, args)).data;
  const pulse = async () => {
    await admin.from("player_positions").upsert({ user_id: id, lng: FAR.lng, lat: FAR.lat, mode: "walk", energy: 100, updated_at: ago(600) });
    await admin.from("hunt_players").update({ approach_key: null }).eq("hunt_id", huntId).eq("user_id", id);
    return rpc("key_pulse", { p_hunt: huntId, p_lng: FAR.lng, p_lat: FAR.lat, p_mode: "walk" });
  };

  let p = await pulse();
  check("1.15 km off without a detector: out of reach", p?.ok && p.inArea === false && p.detector === false, JSON.stringify(p));
  let r = await rpc("buy_detector");
  check("with 250 coins: refused (300)", r?.ok === false && r.reason === "coins" && r.price === 300, JSON.stringify(r));
  await admin.from("profiles").update({ coins: 400 }).eq("id", id);
  r = await rpc("buy_detector");
  check("with 400: bought, 100 left", r?.ok === true && Number(r.balance) === 100, JSON.stringify(r));
  const { data: tx } = await admin.from("coin_transactions").select("amount, reason").eq("user_id", id).order("created_at", { ascending: false }).limit(1);
  check("…a ledger line for it", tx?.[0]?.amount === -300 && /metal detector/i.test(tx[0].reason), JSON.stringify(tx?.[0]));
  r = await rpc("buy_detector");
  check("again: already yours", r?.ok === false && r.reason === "owned");
  p = await pulse();
  check("1.15 km off with one: in the area (1.5× the reach), and it says so", p?.ok && p.inArea === true && p.detector === true && p.heat > 0, JSON.stringify(p));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

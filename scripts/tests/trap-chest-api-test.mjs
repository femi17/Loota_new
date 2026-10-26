// The Masquerade's trap chests (owner, 25 Oct 2026), through the real database functions: Key 1 with a decoy 220 m
// north of its spot. Far from both: no trap. Within 60 m of the decoy: key_pulse sends it (and the heat isn't Burning);
// too far to open (60 m): "far"; at it: 25 coins gone; a second try: no trap; key_pulse no longer sends it; with only
// 10 coins (the trap reset for the test) only 10 are lost. The hunt and test player are deleted.
//   node scripts/tests/trap-chest-api-test.mjs
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
const SPOT = { lng: 3.378214, lat: 6.500147 };
const TRAP = north(SPOT, 220);

try {
  const email = `trap-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ coins: 100, home_lng: SPOT.lng, home_lat: SPOT.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Trap test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Trap key.", category: "maths", trial_kind: "sentries", area_lng: SPOT.lng, area_lat: SPOT.lat, area_radius_m: 800, spot_lng: SPOT.lng, spot_lat: SPOT.lat, trap_lng: TRAP.lng, trap_lat: TRAP.lat });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => {
    const { data: d, error: e } = await c.rpc(fn, args);
    if (e) console.log("  rpc error", fn, e.message);
    return d;
  };
  /** Stand at p (the last saved spot there, a while ago, so the walk is never too fast). */
  const at = async (p) => admin.from("player_positions").upsert({ user_id: id, lng: p.lng, lat: p.lat, mode: "walk", energy: 100, updated_at: ago(600) });
  const pulse = async (p) => {
    await at(p);
    return rpc("key_pulse", { p_hunt: huntId, p_lng: p.lng, p_lat: p.lat, p_mode: "walk" });
  };
  const spring = async (p) => {
    await at(p);
    return rpc("spring_trap", { p_hunt: huntId, p_lng: p.lng, p_lat: p.lat, p_mode: "walk" });
  };
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;

  let p = await pulse(north(SPOT, 500));
  check("in the area, far from both chests: no chest, no trap", p?.ok && p.inArea && !p.spot && !p.trap, JSON.stringify(p));
  p = await pulse(north(TRAP, 30));
  check("within 60 m of the decoy: it rises (the trap's spot)", p?.trap && Math.abs(p.trap.lat - TRAP.lat) < 1e-7 && !p.spot, JSON.stringify(p?.trap));
  check("…and the heat there isn't Burning (the tell)", p.heat < 0.85, `heat ${p.heat}`);
  p = await pulse(north(SPOT, 30));
  check("at the key's own chest: Burning, no trap", p?.spot && !p.trap && p.heat >= 0.85, `heat ${p?.heat}`);

  let r = await spring(north(TRAP, 60));
  check("60 m from the decoy: too far to open", r?.ok === false && r.reason === "far", JSON.stringify(r));
  r = await spring(north(TRAP, 10));
  check("at the decoy: sprung, 25 coins lost, dizzy 15 s", r?.ok === true && r.lost === 25 && r.dizzyS === 15 && Number(r.balance) === 75, JSON.stringify(r));
  check("…the wallet: 75", (await coins()) === 75);
  const { data: tx } = await admin.from("coin_transactions").select("amount, reason").eq("user_id", id).order("created_at", { ascending: false }).limit(1);
  check("…a ledger line for it", tx?.[0]?.amount === -25 && /trap/i.test(tx[0].reason ?? ""), JSON.stringify(tx?.[0]));
  r = await spring(north(TRAP, 10));
  check("a second time: no trap (once per hunter)", r?.ok === false && r.reason === "no_trap", JSON.stringify(r));
  p = await pulse(north(TRAP, 10));
  check("…and it no longer rises for them", p?.ok && !p.trap, JSON.stringify(p?.trap));

  // Short of coins: only what's left.
  await admin.from("hunt_players").update({ traps_sprung: [] }).eq("hunt_id", huntId).eq("user_id", id);
  await admin.from("profiles").update({ coins: 10 }).eq("id", id);
  r = await spring(north(TRAP, 10));
  check("with 10 coins: only 10 lost", r?.ok === true && r.lost === 10 && Number(r.balance) === 0, JSON.stringify(r));
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

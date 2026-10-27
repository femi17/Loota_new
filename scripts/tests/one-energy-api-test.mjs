// One energy (owner, 27 Oct 2026: "it is one health life… on 5% … I get on the plane … the health should start from 5%
// but can begin to increase because they are in a rest mode … on a motorbike … it will continue from 5%, and still get
// tired"), through the real database functions: a ride gives back the rest of the time sat down (and only once); being
// put on a road keeps the rest stood about; a collapse the device saw is taken when the server's count is low, and not
// when it's well short of 0. The trips and test player are deleted.
//   node scripts/tests/one-energy-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const yaba = { lng: 3.3787, lat: 6.5186 };
const to = { lng: 3.3887, lat: 6.5286 };
const near = (a, b, within) => Math.abs(a - b) <= within;

try {
  const email = `energy-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const energy = async () => (await admin.from("player_positions").select("energy, fainted_at").eq("user_id", id).single()).data;

  // ---- A 2-minute bus ride from 5%
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 5, updated_at: ago(120) });
  const { error } = await admin.from("transit_trips").insert({
    user_id: id, mode: "bus", from_name: "Here", to_name: "There", to_lng: to.lng, to_lat: to.lat,
    path: [[yaba.lng, yaba.lat], [to.lng, to.lat]], path_m: 1500, fare: 0, departs_at: ago(100), arrives_at: ago(2), ride_s: 98,
  });
  if (error) throw error;
  const done = (await c.rpc("finish_trip")).data;
  const off = (await energy()).energy;
  check("off the bus: from 5%, plus the rest of the 2 minutes sat down (about +30)", done?.ok && near(off, 35, 2), `${off}`);
  // Walk a few metres on: counted once, not the ride's rest again.
  const step = (await c.rpc("save_position", { p_lng: to.lng + 0.0001, p_lat: to.lat, p_mode: "walk" })).data;
  check("…walking on carries on from there (nothing counted twice)", step?.ok && step.energy <= off + 1 && step.energy >= off - 2, JSON.stringify(step));

  // ---- Put on a road after standing about 40 s
  await admin.from("player_positions").update({ energy: 20, updated_at: ago(40) }).eq("user_id", id);
  const placed = (await c.rpc("place_on_road", { p_lng: to.lng + 0.0003, p_lat: to.lat })).data;
  const afterPlace = (await energy()).energy;
  check("put on a road: the 40 s stood about still count (about +10)", placed?.ok && near(afterPlace, 30, 1.5), `${afterPlace}`);

  // ---- A collapse the device saw
  await admin.from("player_positions").update({ energy: 40, updated_at: new Date().toISOString() }).eq("user_id", id);
  const notYet = (await c.rpc("collapse")).data;
  check("collapse with 40 left by the server's count: not taken", notYet?.ok === false && notYet.reason === "not_tired", JSON.stringify(notYet));
  await admin.from("player_positions").update({ energy: 6, updated_at: new Date().toISOString() }).eq("user_id", id);
  const down = (await c.rpc("collapse")).data;
  const after = await energy();
  check("collapse with 6 left by the server's count: taken (fainted, 0 energy)", down?.ok && !!after.fainted_at && after.energy === 0, JSON.stringify(after));
  const moving = (await c.rpc("save_position", { p_lng: to.lng + 0.0004, p_lat: to.lat, p_mode: "walk" })).data;
  check("…and no walking on after it", moving?.ok === false && moving.reason === "fainted", JSON.stringify(moving));
  const anon = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).rpc("collapse");
  check("signed-in players only", !!anon.error);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (id) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`trips and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

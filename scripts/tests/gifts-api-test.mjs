// Thank-you gifts and the Jerry Can relic (owner, 19 Oct 2026), through the real database functions: the Jerry Can
// relic beside a vehicle that ran dry: the tank to 65%, back on it (from far away: refused; on a tank above 65%:
// refused); 40 travellers helped in free roam: gifts of every kind (relics, a jerry can, a tyre kit, coins), each
// really given; the tyre kit fixes a bicycle's flat anywhere. The test player is deleted.
//   node scripts/tests/gifts-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let id = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const spot = { lng: 3.3787, lat: 6.5186 };
const soon = (d) => new Date(Date.now() + d * 86400e3).toISOString();

try {
  const email = `gifts-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat + 600 / 110574, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  await admin.from("player_vehicles").insert({ user_id: id, kind: "motorbike", fuel: 0, tyre: 100, engine: 100, lng: spot.lng, lat: spot.lat, in_use: false, stranded_at: new Date().toISOString() });
  const { data: rel } = await admin.from("player_relics").insert({ user_id: id, relic: "jerry_can", charges: 1, expires_at: soon(5) }).select("id").single();
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const bike = async () => (await admin.from("player_vehicles").select("fuel, in_use, stranded_at").eq("user_id", id).eq("kind", "motorbike").single()).data;

  // ---- The Jerry Can relic
  let r = (await c.rpc("use_relic", { p_relic: rel.id })).data;
  check("the Jerry Can relic 600 m from the dry motorbike: walk to it first", r?.ok === false && r.reason === "far", JSON.stringify(r));
  await admin.from("player_positions").update({ lat: spot.lat + 10 / 110574 }).eq("user_id", id);
  r = (await c.rpc("use_relic", { p_relic: rel.id })).data;
  let b = await bike();
  check("beside it: the tank to 65%, back on it", r?.ok && r.remounted === true && Math.round(b.fuel) === 65 && b.in_use && !b.stranded_at, JSON.stringify(r));
  const left = (await admin.from("player_relics").select("charges").eq("id", rel.id).single()).data.charges;
  check("…the relic used up", left === 0);
  await admin.from("player_vehicles").update({ fuel: 80 }).eq("user_id", id).eq("kind", "motorbike");
  const { data: rel2 } = await admin.from("player_relics").insert({ user_id: id, relic: "jerry_can", charges: 1, expires_at: soon(5) }).select("id").single();
  r = (await c.rpc("use_relic", { p_relic: rel2.id })).data;
  check("on a tank at 80%: a jerry can won't fill it further", r?.ok === false && r.reason === "full");
  await admin.from("player_relics").delete().eq("user_id", id);

  // ---- 40 travellers helped in free roam
  const tally = {};
  let given = true;
  for (let i = 0; i < 40; i++) {
    const before = {
      relics: (await admin.from("player_relics").select("id", { count: "exact", head: true }).eq("user_id", id)).count,
      kits: (await admin.from("player_items").select("qty").eq("user_id", id).maybeSingle()).data?.qty ?? 0,
      coins: (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins,
    };
    // An empty jerry can now and then, so a full one can be given.
    if (i % 4 === 0) await admin.from("player_kegs").upsert({ user_id: id, fuel: 0, uses_left: 50 });
    const { data: ev } = await admin.from("road_events").insert({ user_id: id, kind: "traveller", npc: "Blessing" }).select("id").single();
    const a = (await c.rpc("road_event_answer", { p_event: ev.id, p_choice: 1 })).data;
    const g = a?.gift;
    tally[g?.kind ?? "none"] = (tally[g?.kind ?? "none"] ?? 0) + 1;
    if (!g) given = false;
    else if (g.kind === "relic") given &&= (await admin.from("player_relics").select("id", { count: "exact", head: true }).eq("user_id", id)).count === before.relics + 1;
    else if (g.kind === "item") given &&= ((await admin.from("player_items").select("qty").eq("user_id", id).single()).data.qty === before.kits + 1);
    else if (g.kind === "coins") given &&= (a.reward === 15 && (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins === before.coins + 15);
    else if (g.kind === "keg") given &&= ((await admin.from("player_kegs").select("fuel").eq("user_id", id).single()).data.fuel === 65);
  }
  check("40 travellers helped: a gift every time, and each really given", given, JSON.stringify(tally));
  check("…not only coins: relics, items and jerry cans too", (tally.relic ?? 0) > 0 && (tally.item ?? 0) > 0 && (tally.coins ?? 0) > 0 && (tally.coins ?? 0) < 30, JSON.stringify(tally));

  // ---- The tyre kit
  await admin.from("player_vehicles").insert({ user_id: id, kind: "bicycle", fuel: 0, tyre: 0, engine: 100, lng: spot.lng, lat: spot.lat, in_use: false });
  await admin.from("player_items").upsert({ user_id: id, item: "tyre_kit", qty: 1 });
  r = (await c.rpc("use_item", { p_item: "tyre_kit" })).data;
  const tyre = (await admin.from("player_vehicles").select("tyre").eq("user_id", id).eq("kind", "bicycle").single()).data.tyre;
  check("the tyre kit, anywhere: the flat fixed", r?.ok && r.flat === true && tyre === 100 && r.left === 0, JSON.stringify(r));
  await admin.from("player_vehicles").update({ tyre: 0 }).eq("user_id", id).eq("kind", "bicycle");
  check("…none left: refused", (await c.rpc("use_item", { p_item: "tyre_kit" })).data?.reason === "none");
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (id) {
    await admin.from("road_events").delete().eq("user_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

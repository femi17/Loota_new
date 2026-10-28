// The lamp rests while you ride and lets go of what you've left behind (owner, 28 Oct 2026: "when inside a plane or
// train, one cannot go to find a relic even when the lamps turn on"). In Yaba the lamp holds something; on a plane
// (a trip not ended) it offers nothing ("riding") and spawns no Detour around the stop; landed 60 km away, the old find
// is let go with no rest, the lamp looks around the new place, and the old Detour isn't offered again back home.
// Detours made in the test areas are shared and left to expire; the test player and trip are deleted.
//   node scripts/tests/lamp-riding-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const yaba = { lng: 3.3787, lat: 6.5186 };
const away = { lng: 3.9, lat: 6.85 }; // ~70 km off (Ijebu-Ode way)
let id = null;

try {
  const email = `lampride-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 90, updated_at: new Date().toISOString() });
  const user = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await user.auth.signInWithPassword({ email, password });
  const lamp = async () => (await user.rpc("lamp_state")).data;

  const first = await lamp();
  check("in Yaba the lamp holds something", !!first?.current, JSON.stringify(first?.current && { type: first.current.type, metres: first.current.metres }));
  const held = first?.current;

  // On a plane: nothing, and no Detour spawned around the stop
  const { error } = await admin.from("transit_trips").insert({
    user_id: id, mode: "plane", from_name: "Lagos", to_name: "Away", to_lng: away.lng, to_lat: away.lat,
    path: [[yaba.lng, yaba.lat], [away.lng, away.lat]], path_m: 70000, fare: 0, departs_at: soon(-60), arrives_at: soon(600), ride_s: 660,
  });
  if (error) throw error;
  await admin.from("player_positions").update({ lng: away.lng, lat: away.lat }).eq("user_id", id); // (positions as the flight lands)
  const area = (await admin.rpc("detour_area", { lng: away.lng, lat: away.lat })).data;
  const before = (await admin.from("detours").select("id", { count: "exact", head: true }).eq("area", area)).count;
  const riding = await lamp();
  const after = (await admin.from("detours").select("id", { count: "exact", head: true }).eq("area", area)).count;
  check("on a plane the lamp rests: nothing offered", riding?.riding === true && riding.current === null, JSON.stringify(riding));
  check("…and no Detour is made around you while you ride", after === before, `${before} → ${after}`);

  // Landed, 70 km from what the lamp held
  await admin.from("transit_trips").update({ ended_at: new Date().toISOString(), outcome: "arrived" }).eq("user_id", id);
  const landed = await lamp();
  check("landed: the old find is let go", !landed?.current || landed.current.id !== held?.id, JSON.stringify(landed?.current && { type: landed.current.type, metres: landed.current.metres }));
  check("…with no rest before the next", !landed?.restUntil, landed?.restUntil ?? "");
  check("…and anything offered now is near the new place", !landed?.current || landed.current.metres < 5000, landed?.current?.metres);
  if (held?.type === "detour") {
    const { data: set } = await admin.from("lamp_dismissed").select("item").eq("user_id", id).eq("item", `detour:${held.id}`);
    check("…the old Detour is set aside, not offered again", (set ?? []).length === 1);
  } else if (held?.type === "whisper") {
    const { data: lead } = await admin.from("player_leads").select("resolved_at").eq("id", held.id).single();
    check("…the old whisper has faded", !!lead?.resolved_at);
  }
  // Back home on foot (no trip): a find nearby is still offered as before
  await admin.from("player_positions").update({ lng: yaba.lng, lat: yaba.lat }).eq("user_id", id);
  const home = await lamp();
  check("back in Yaba: the lamp works as before (not riding)", home && !home.riding, JSON.stringify(home && { riding: home.riding, current: home.current?.type ?? null, rest: home.restUntil ?? null }));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (id) {
    await admin.from("transit_trips").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

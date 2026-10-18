// The server insists on the ticket office and the check-in desk (owner, 19 Oct 2026), through the real database
// functions: at Yaba station a player 100 m from the ticket office (inside the old 150 m reach) is refused, at the
// office they're sold the ticket; at Lagos airport a player on the airport's own point is refused, at the check-in
// desk the flight is booked; at Iwo, whose roads were all beyond the old reach, the desk counts as being there.
// Trips are cancelled and the test players deleted.   node scripts/tests/ticket-desk-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ids = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const metres = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);
/** A point `m` metres from `p` in the direction away from `q` (so further from q). */
const awayFrom = (p, q, m) => {
  const d = metres(p, q) || 1;
  return { lng: p.lng + ((p.lng - q.lng) / d) * m, lat: p.lat + ((p.lat - q.lat) / d) * m };
};

async function player(tag) {
  const email = `desk-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  await admin.rpc("apply_coin_change", { p_user: data.user.id, p_amount: 3000, p_kind: "admin", p_reason: "Ticket desk test" });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  return { id: data.user.id, c };
}
const stand = (id, p) => admin.from("player_positions").upsert({ user_id: id, lng: p.lng, lat: p.lat, mode: "walk", energy: 90, updated_at: new Date().toISOString() });
const stop = async (filter) => (await filter(admin.from("transit_stops").select("id, kind, name, lng, lat, line_id, desk_lng, desk_lat"))).data[0];

try {
  // ---- Yaba station: the ticket office
  const yaba = await stop((q) => q.eq("kind", "train").eq("name", "Yaba"));
  const mushin = await stop((q) => q.eq("kind", "train").eq("name", "Mushin").eq("line_id", yaba.line_id));
  const desk = { lng: yaba.desk_lng, lat: yaba.desk_lat };
  check("Yaba has a ticket office", yaba.desk_lng != null, `${Math.round(metres(yaba, desk))} m from the station's point`);
  const rider = await player("train");
  // 100 m from the office, still inside the old 150 m reach of the station.
  let spot = awayFrom(desk, yaba, 100);
  if (metres(spot, yaba) > 140) spot = awayFrom(yaba, desk, Math.max(0, 140 - metres(yaba, desk)) * 0.5 + 70);
  await stand(rider.id, spot);
  const path = [[yaba.lng, yaba.lat], [mushin.lng, mushin.lat]];
  let r = (await rider.c.rpc("start_trip", { p_from: yaba.id, p_to: mushin.id, p_path: path })).data;
  check("100 m from the office (within the old reach): refused", r?.reason === "desk", `${Math.round(metres(spot, desk))} m from the desk, ${Math.round(metres(spot, yaba))} m from the station · ${JSON.stringify(r)}`);
  await stand(rider.id, desk);
  r = (await rider.c.rpc("start_trip", { p_from: yaba.id, p_to: mushin.id, p_path: path })).data;
  check("at the ticket office: the ticket sold", r?.ok === true && r.trip?.mode === "train", JSON.stringify(r).slice(0, 120));

  // ---- Lagos airport: the check-in desk
  const los = await stop((q) => q.eq("kind", "plane").eq("code", "LOS"));
  const abv = await stop((q) => q.eq("kind", "plane").eq("code", "ABV"));
  const flyer = await player("plane");
  const losDesk = { lng: los.desk_lng, lat: los.desk_lat };
  await stand(flyer.id, los);
  const fly = [[los.lng, los.lat], [abv.lng, abv.lat]];
  r = (await flyer.c.rpc("start_trip", { p_from: los.id, p_to: abv.id, p_path: fly })).data;
  check("on the airport's own point (within its 2 km): refused", r?.reason === "desk", `${Math.round(metres(los, losDesk))} m from the desk · ${JSON.stringify(r)}`);
  await stand(flyer.id, losDesk);
  r = (await flyer.c.rpc("start_trip", { p_from: los.id, p_to: abv.id, p_path: fly })).data;
  check("at the check-in desk: the flight booked", r?.ok === true && r.trip?.mode === "plane", JSON.stringify(r).slice(0, 120));

  // ---- Iwo: a station beyond the old reach of any road, usable at its desk
  const iwo = await stop((q) => q.eq("kind", "train").eq("name", "Iwo"));
  const near = (await rider.c.rpc("transit_near", { p_lng: iwo.desk_lng, p_lat: iwo.desk_lat })).data;
  check("Iwo: at its desk, you're at the station", (near?.here ?? []).some((s) => s.id === iwo.id), `${Math.round(metres(iwo, { lng: iwo.desk_lng, lat: iwo.desk_lat }))} m from its point`);

  // ---- Buses unchanged: any stop within reach
  const { data: bus } = await admin.rpc("stops_near", { p_kind: "bus", p_lng: 3.3786, p_lat: 6.5, p_limit: 1 });
  check("bus stops: no desk", bus?.[0] && bus[0].desk_lng == null);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  for (const id of ids) {
    await admin.from("transit_trips").update({ ended_at: new Date().toISOString(), outcome: "cancelled" }).eq("user_id", id).is("ended_at", null);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}

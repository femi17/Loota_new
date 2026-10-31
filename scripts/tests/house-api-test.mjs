// The house at a story key (owner, 31 Oct 2026: "an open house, like sims"; rooms that are traps; "collect something and
// then use in another room"). A test house: a study (safe; an old man's portrait hides a brass key), a cellar (a trap),
// a kitchen (a trap) and a bedroom (the chest; locked until the brass key).
//   1. Away from the place there's no house; at it, the house shows its rooms and objects, never which is right;
//   2. the chest won't open from outside the right room;
//   3. the locked bedroom says so; the cellar is a trap: a soft penalty, thrown out, the door shut for a while;
//   4. in the study, the portrait gives the brass key; the bedroom then opens with it and holds the chest;
//   5. from the bedroom, the chest opens (a Key Trial starts).
// The hunt and test hunter are deleted.   node scripts/tests/house-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const PLACE = { lng: 80.2194, lat: 6.0245 };
export const TEST_HOUSE = {
  title: "The keeper's house",
  items: { "brass-key": { name: "A small brass key", icon: "🗝️" } },
  rooms: [
    { id: "study", name: "Study", kind: "study", role: "safe", objects: [
      { id: "portrait", kind: "picture", label: "An old man's portrait", look: "A stern old man in a sailor's cap.", gives: "brass-key", found: "You lift the frame. Taped to the back: a small brass key." },
      { id: "desk", kind: "desk", label: "A writing desk", look: "Bills, a pencil, a dried-up inkwell." },
    ] },
    { id: "cellar", name: "Cellar", kind: "cellar", role: "trap" },
    { id: "kitchen", name: "Kitchen", kind: "kitchen", role: "trap" },
    { id: "bedroom", name: "Bedroom", kind: "bedroom", role: "right", needs: "brass-key", lockedText: "Locked. A small brass keyhole." },
  ],
};
let uid = null, hunt = null;

try {
  const email = `house-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  uid = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 500 }).eq("id", uid);
  await admin.from("player_positions").upsert({ user_id: uid, lng: 3.3787, lat: 6.5186, mode: "walk", energy: 100, updated_at: ago(600) });
  const { data: h, error } = await admin.from("hunts").insert({ title: "House test (automated)", prize: "Test prize (automated)", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  hunt = h.id;
  await admin.from("hunt_keys").insert({ hunt_id: hunt, n: 1, riddle: "Where was the light?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng, area_lat: PLACE.lat, area_radius_m: 1500, spot_lng: PLACE.lng, spot_lat: PLACE.lat, exact_m: 120, house: TEST_HOUSE });
  await admin.from("hunt_players").insert({ hunt_id: hunt, user_id: uid, guess_n: 1, guess_name: "The light", guess_lng: PLACE.lng, guess_lat: PLACE.lat });
  const me = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await me.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => { const r = await me.rpc(fn, { p_hunt: hunt, ...args }); if (r.error) throw r.error; return r.data; };

  // 1. The house
  const away = await rpc("house_view", {});
  check("away from the place: no house", away.ok === false && away.reason === "away", JSON.stringify(away));
  await admin.from("player_positions").update({ lng: PLACE.lng + 0.0005, lat: PLACE.lat, updated_at: ago(600) }).eq("user_id", uid);
  const view = await rpc("house_view", {});
  const text = JSON.stringify(view);
  check("at the place: the house, its rooms and objects", view.ok && view.title === "The keeper's house" && view.rooms.length === 4 && view.objects.length === 2, text.slice(0, 160));
  check("…never which room is right or a trap, or what anything hides", !/right|trap|safe|brass|taped/i.test(text.replace(/"bedroom"|"Bedroom"/g, "")), text.match(/right|trap|safe|brass|taped/i)?.[0] ?? "clean");
  check("…the bedroom shows as locked", view.rooms.find((r) => r.id === "bedroom")?.locked === true);

  // 2. The chest, from outside
  await new Promise((r) => setTimeout(r, 4500));
  const early = await rpc("search_here", { p_lng: PLACE.lng, p_lat: PLACE.lat, p_mode: "walk" });
  check("the chest won't open from outside the right room", early.ok === false && early.reason === "house", JSON.stringify(early));

  // 3. Locked; a trap
  const locked = await rpc("house_enter", { p_room: "bedroom" });
  check("the bedroom: locked, with a hint", locked.locked === true && /brass keyhole/.test(locked.text), JSON.stringify(locked));
  const trap = await rpc("house_enter", { p_room: "cellar" });
  check("the cellar: a trap, a soft penalty", trap.trap === true && trap.penalty?.tier === "soft" && !!trap.penalty?.body, JSON.stringify(trap.penalty ?? null).slice(0, 160));
  const shut = await rpc("house_enter", { p_room: "study" });
  check("…thrown out: no door opens for a while", shut.ok === false && shut.reason === "out" && Date.parse(shut.until) > Date.now(), JSON.stringify(shut));
  await admin.from("hunt_players").update({ house_out_until: null }).eq("hunt_id", hunt).eq("user_id", uid);

  // 4. The study, the portrait, the key
  const study = await rpc("house_enter", { p_room: "study" });
  check("the study: in", study.ok && study.room === "study", JSON.stringify(study).slice(0, 120));
  const wrongRoom = await rpc("house_touch", { p_object: "nope" });
  check("…an object that isn't there: nothing", wrongRoom.ok === false);
  const desk = await rpc("house_touch", { p_object: "desk" });
  check("…the desk: just a look", desk.ok && /inkwell/.test(desk.text) && !desk.gained, desk.text);
  const portrait = await rpc("house_touch", { p_object: "portrait" });
  check("…the portrait: the brass key, into the bag", portrait.ok && portrait.gained?.id === "brass-key" && portrait.items.some((i) => i.id === "brass-key"), `${portrait.text} | ${JSON.stringify(portrait.gained)}`);
  const again = await rpc("house_touch", { p_object: "portrait" });
  check("…touched again: no second key", again.ok && !again.gained);
  const bedroom = await rpc("house_enter", { p_room: "bedroom" });
  check("the bedroom opens with the brass key, and holds the chest", bedroom.ok && bedroom.used?.id === "brass-key" && bedroom.room === "bedroom" && bedroom.rooms.find((r) => r.id === "bedroom")?.chest === true, JSON.stringify(bedroom).slice(0, 160));

  // 5. The chest
  await new Promise((r) => setTimeout(r, 4500));
  const { data: pos } = await admin.from("player_positions").select("lng, lat").eq("user_id", uid).single();
  const open = await rpc("search_here", { p_lng: pos.lng, p_lat: pos.lat, p_mode: "walk" });
  check("from the bedroom, the chest opens: a Key Trial", open.ok && open.result === "trial", JSON.stringify(open).slice(0, 120));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (hunt) await admin.from("hunts").delete().eq("id", hunt);
  if (uid) await admin.auth.admin.deleteUser(uid);
  console.log(`test hunt and hunter deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

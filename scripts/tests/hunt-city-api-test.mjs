// The hunt city's treasure building, through the game's server (owner, 3 Nov 2026: "go in, we open the roof of the
// building, and they complete the puzzle… room 1, coins, room 2, the next chapter, room 3, the key, room 4, decoy
// trap, another room trap. But all these will be shuffled"). A story key whose city has a right building, a trap and
// an empty one; the hunter at the place:
//   - the detector: none, no reading; with one, the right building hot, its neighbour warm, the far one cold;
//   - the rooms: none before the right building is searched; searched, five shut rooms;
//   - a room's puzzle from /api/house/room (no answer sent); a wrong answer: shut still; the right one: it opens,
//     and what it held happens (coins, the next chapter on the scroll, the key, a decoy's or a trap's penalty);
//   - every room opened once, each content once (shuffled per hunter); the key awarded as a Key Trial won.
// The hunt and the hunter are deleted.   node scripts/tests/hunt-city-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let id = null, huntId = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const PLACE = { lng: 3.3958, lat: 6.4541 };
const HOUSE = { title: "The test city", style: "lagos", layout: "gallery", items: {}, rooms: [
  { id: "noodles", name: "The noodle shop", kind: "kitchen", role: "right" },
  { id: "fountain", name: "The fountain house", kind: "bathroom", role: "trap" },
  { id: "books", name: "The bookshop", kind: "library", role: "safe" },
] };

try {
  const email = `city-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 500 }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "City test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  for (const n of [1, 2]) {
    await admin.from("hunt_keys").insert({ hunt_id: huntId, n, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng + (n - 1) * 0.05, area_lat: PLACE.lat, area_radius_m: 1500,
      spot_lng: PLACE.lng + (n - 1) * 0.05, spot_lat: PLACE.lat, exact_m: 120, house: HOUSE });
  }
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id, guess_n: 1, guess_name: "The place", guess_lng: PLACE.lng, guess_lat: PLACE.lat, leg_lng: 3.3787, leg_lat: 6.47 });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const api = async (path, body) => {
    const res = await fetch(`http://localhost:3000${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
    return res.json();
  };
  const rpc = async (fn, args) => (await c.rpc(fn, args)).data;
  const coins = async () => Number((await admin.from("profiles").select("coins").eq("id", id).single()).data.coins);

  // ---- The detector
  let r = await rpc("house_detect", { p_hunt: huntId, p_room: "noodles" });
  check("no detector: no reading", r?.ok === false && r.reason === "no_detector", JSON.stringify(r));
  await admin.from("profiles").update({ detector: true }).eq("id", id);
  const heats = {};
  for (const room of ["noodles", "fountain", "books"]) heats[room] = (await rpc("house_detect", { p_hunt: huntId, p_room: room }))?.heat;
  check("with a detector: the right building hot, the next warm, the far one cold", heats.noodles === "hot" && heats.fountain === "warm" && heats.books === "cold", JSON.stringify(heats));

  // ---- No rooms until the right building is searched
  let v = await rpc("house_view", { p_hunt: huntId });
  check("the city opens; no rooms yet", v?.ok && !v.inner, JSON.stringify({ ok: v?.ok, inner: v?.inner }));
  r = await api("/api/house/room", { hunt: huntId, room: 1 });
  check("…a room's puzzle before finding the building: refused", r?.ok === false && r.reason === "not_inside", JSON.stringify(r));
  r = await rpc("house_enter", { p_hunt: huntId, p_room: "books" });
  check("searching the empty building: nothing, no rooms", r?.ok && !r.trap && !r.inner, JSON.stringify({ ok: r?.ok, trap: r?.trap, inner: r?.inner }));
  r = await rpc("house_enter", { p_hunt: huntId, p_room: "noodles" });
  check("searching the right building: five shut rooms", r?.ok && Array.isArray(r.inner) && r.inner.length === 5 && r.inner.every((x) => !x.open), JSON.stringify(r?.inner));

  // ---- The rooms
  const outcomes = [];
  let awarded = null;
  for (const room of [1, 2, 3, 4, 5]) {
    const p = await api("/api/house/room", { hunt: huntId, room });
    if (!p?.ok || !p.puzzle) {
      check(`room ${room}: a puzzle`, false, JSON.stringify(p));
      continue;
    }
    if (room === 1) check("a room's puzzle comes without its answer", !("solution" in p) && !!p.kind, p.kind);
    const stored = (await admin.from("house_room_puzzles").select("kind, solution").eq("user_id", id).eq("hunt_id", huntId).eq("room", room).single()).data;
    if (room === 1) {
      const wrong = await api("/api/house/room/solve", { hunt: huntId, room, answer: stored.kind === "vowels" ? ["XXXX"] : [] });
      check("a wrong answer: the room stays shut", wrong?.ok && wrong.right === false, JSON.stringify(wrong));
    }
    const answer = stored.kind === "sentries" ? stored.solution.map((col, row) => [row, col]) : stored.solution;
    const before = await coins();
    const opened = await api("/api/house/room/solve", { hunt: huntId, room, answer });
    outcomes.push(opened?.outcome);
    const said = `${opened?.outcome}: ${JSON.stringify(opened).slice(0, 160)}`;
    if (opened?.outcome === "coins") check(`room ${room} (${stored.kind}) solved: coins, 25`, opened.right && (await coins()) === before + 25, said);
    else if (opened?.outcome === "chapter") {
      const sc = (await admin.from("hunt_players").select("story_chapters, keys_held").eq("hunt_id", huntId).eq("user_id", id).single()).data;
      check(`room ${room} (${stored.kind}) solved: the next chapter opens on the scroll`, opened.right && sc.story_chapters >= sc.keys_held + 3, `${said} · ${JSON.stringify(sc)}`);
    } else if (opened?.outcome === "key") {
      awarded = opened.award;
      check(`room ${room} (${stored.kind}) solved: the key, as a Key Trial won`, opened.right && awarded?.result === "key" && awarded.keysHeld === 1, said);
    } else if (opened?.outcome === "decoy" || opened?.outcome === "trap") {
      check(`room ${room} (${stored.kind}) solved: ${opened.outcome === "decoy" ? "a decoy (a deep trap)" : "a trap (a soft one)"}`, opened.right && !!opened.penalty?.code && opened.penalty.tier === (opened.outcome === "decoy" ? "deep" : "soft"), said);
    } else check(`room ${room} solved`, false, said);
    if (opened?.outcome === "key") break; // the key won: on to Key 2 (the rest of this building is behind them)
    // Back at the place after a trap that sent them away (a test shortcut: they'd travel back).
    await admin.from("player_positions").update({ lng: PLACE.lng, lat: PLACE.lat, updated_at: ago(30) }).eq("user_id", id);
  }
  check("each content once, the key among them", new Set(outcomes).size === outcomes.length && outcomes.includes("key"), outcomes.join(", "));
  const held = (await admin.from("hunt_players").select("keys_held").eq("hunt_id", huntId).eq("user_id", id).single()).data.keys_held;
  check("…the hunter holds Key 1 now", held === 1, `keys_held ${held}`);

  // ---- Shuffled per hunter: another hunter's order differs (most of the time: checked over the order function)
  const orders = new Set();
  for (let i = 0; i < 6; i++) {
    const { data: o } = await admin.rpc("house_inner_order", { p_user: crypto.randomUUID(), p_hunt: huntId, p_key: 1 }).then((x) => x, () => ({ data: null }));
    if (o) orders.add(o.join(","));
  }
  check("the rooms' contents are shuffled per hunter", orders.size >= 3, `${orders.size} different orders of 6`);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (huntId) {
    await admin.from("house_room_puzzles").delete().eq("hunt_id", huntId);
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and hunter deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

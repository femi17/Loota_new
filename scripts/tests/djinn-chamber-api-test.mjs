// The Djinn's chamber through the real database functions (design doc 7.6 steps 5–6): traps on the
// approach, rivals, the chamber, the whirlwind, an empty vault, and (only when no real Wager is on)
// winning the Wonder. Test players are deleted; a Wager opened for the test is ended afterwards.
//   node scripts/tests/djinn-chamber-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ids = [];
let ownWager = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const k = (lat) => Math.cos((lat * Math.PI) / 180);
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const isPrime = (n) => n > 1 && [...Array(Math.max(0, Math.floor(Math.sqrt(n)) - 1)).keys()].every((i) => n % (i + 2) !== 0);
const holds = (rule, n) => (rule === "prime" ? isPrime(n) : rule === "three" ? n % 3 === 0 : rule === "four" ? n % 4 === 0 : n % 7 === 0);
/** A point `m` metres from a place in direction arc (0–7, 45° each, 0 = north). */
const around = (p, arc, m) => {
  const a = (arc * 45 * Math.PI) / 180;
  return { lng: p.lng + (Math.sin(a) * m) / (111320 * k(p.lat)), lat: p.lat + (Math.cos(a) * m) / 110574 };
};
/** Solve a set of rooms the way a player would (with the answers only the database knows). */
function solve(rooms) {
  const grid = rooms.floor.grid;
  // Any safe way up: a depth-first search over the stones obeying the rule.
  const rows = grid.length;
  const at = (r, c) => grid[rows - 1 - r][c];
  const walk = (r, prev, path) => {
    if (r === rows) return path;
    for (const c of [0, 1, 2, 3, 4]) {
      if (prev !== null && Math.abs(c - prev) > 1) continue;
      if (!holds(rooms.floor.rule, at(r, c))) continue;
      const done = walk(r + 1, c, [...path, c]);
      if (done) return done;
    }
    return null;
  };
  const wts = rooms.scales.weights;
  let stones = [];
  for (let m = 1; m < 1 << wts.length && !stones.length; m++) {
    const pick = wts.map((_, i) => i).filter((i) => m & (1 << i));
    if (pick.reduce((s, i) => s + wts[i], 0) === rooms.scales.target) stones = pick;
  }
  return { cipher: rooms.cipher.answer, path: walk(0, null, []), weights: stones };
}
try {
  async function player(name) {
    const email = `chamber-${name}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const id = data.user.id; ids.push(id);
    const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email, password });
    const rpc = async (fn, args) => {
      const { data: d, error } = await c.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return d;
    };
    const moveTo = (p) => admin.from("player_positions").upsert({ user_id: id, lng: p.lng, lat: p.lat, mode: "walk", energy: 80, updated_at: ago(30) });
    const pos = async () => (await admin.from("player_positions").select("*").eq("user_id", id).single()).data;
    return { id, c, rpc, moveTo, pos };
  }

  // ---- A Wager: the one that's on (not claimed by the test), or one opened for the test.
  let { data: live } = await admin.from("djinn_wagers").select("*").gt("ends_at", new Date().toISOString()).is("winner", null).limit(1);
  let w = live?.[0];
  if (!w) {
    const { data: opened } = await admin.rpc("djinn_open_wager");
    ownWager = opened;
    w = (await admin.from("djinn_wagers").select("*").eq("id", opened).single()).data;
  } else console.log("      (a real Wager is on: testing traps, rivals, the whirlwind and an empty vault; not winning it)");
  const { data: sites } = await admin.from("djinn_sites").select("*").in("id", w.site_ids);
  const real = sites.find((s) => s.id === w.real_site);
  const decoy = sites.find((s) => s.id !== w.real_site);

  /** Through the gate (all three rooms) and onto a seal. */
  async function toSeal(p, site) {
    await p.rpc("djinn_start_gate");
    const a = solve(w.gate);
    await p.rpc("djinn_answer_gate", { p_cipher: a.cipher, p_path: a.path, p_weights: a.weights });
    const burned = (await p.rpc("djinn_state")).seals.filter((x) => x.burned).map((x) => x.id);
    if (burned.includes(site.id)) return false;
    return (await p.rpc("djinn_choose", { p_site: site.id }))?.ok === true;
  }

  // ---- The approach: traps on the rings
  const ada = await player("ada");
  const target = ownWager ? real : decoy;
  if (!(await toSeal(ada, target))) throw new Error("the Djinn burned the test's seal: run again");
  await ada.moveTo(around(target, 0, 1100));
  const far = await ada.rpc("djinn_approach");
  check("on the way: the place and how far", far.quest && far.place === target.name && far.metres > 1000 && !far.trap, `${far.metres} m from ${far.place}`);
  const { data: traps } = await admin.from("djinn_traps").select("*").eq("wager_id", w.id).eq("site_id", target.id);
  check("traps laid: three directions on each of two rings", traps.length === 6 && traps.filter((t) => t.ring === 600).length === 3 && traps.filter((t) => t.ring === 300).length === 3,
    traps.map((t) => `${t.ring} m ${t.arc * 45}°: ${t.kind}`).join(", "));
  // Cross the outer ring where a trap lies (that isn't the bridge, which would throw us back).
  const outer = traps.find((t) => t.ring === 600 && t.kind !== "collapsing_bridge") ?? traps.find((t) => t.ring === 600);
  await ada.moveTo(around(target, outer.arc, 650));
  check("outside the ring: nothing", !(await ada.rpc("djinn_approach")).trap);
  await ada.moveTo(around(target, outer.arc, 550));
  const sprung = await ada.rpc("djinn_approach");
  const p1 = await ada.pos();
  const effect = { quicksand: sprung.trap?.stuck === 25, dart_wall: sprung.trap?.stuck === 15 && p1.energy <= 70.5, snake_pit: p1.energy <= 55.5,
    collapsing_bridge: (sprung.trap?.lng ?? 0) !== 0 && Math.hypot((p1.lng - target.lng) * 111320 * k(target.lat), (p1.lat - target.lat) * 110574) > 800 }[outer.kind];
  check(`crossing a trapped ring springs it: ${outer.kind.replace("_", " ")}`, sprung.trap?.kind === outer.kind && effect, `energy now ${p1.energy}`);
  if (outer.kind === "collapsing_bridge") await ada.moveTo(around(target, outer.arc, 550));
  check("a ring springs once per approach", !(await ada.rpc("djinn_approach")).trap || outer.kind === "collapsing_bridge");
  const safeArc = [0, 1, 2, 3, 4, 5, 6, 7].find((a) => !traps.some((t) => t.ring === 300 && t.arc === a));
  await ada.moveTo(around(target, safeArc, 250));
  check("crossing the inner ring where no trap lies: nothing", !(await ada.rpc("djinn_approach")).trap);

  // ---- Rivals
  const bayo = await player("bayo");
  if (await toSeal(bayo, target)) {
    await bayo.moveTo(around(target, 2, 1500));
    const r = await ada.rpc("djinn_rivals");
    check("a rival who broke the same seal: counted, with their distance", r?.count === 1 && Math.abs(r.nearest - 1500) < 30, JSON.stringify(r));
  }

  // ---- The chamber: too far, then the rooms
  check("the chamber from 250 m: refused", (await ada.rpc("djinn_enter_chamber"))?.reason === "far");
  await ada.moveTo(around(target, safeArc, 20));
  const ch = await ada.rpc("djinn_enter_chamber");
  check("at the place: the chamber's three rooms, 3 minutes, no answers", ch?.ok && ch.floor.grid.length === 7 && ch.scales.weights.length === 7 && !("answer" in ch) && !("rule" in ch.floor) && ch.seconds === 180, ch?.cipher);
  check("asking again gives the same rooms", (await ada.rpc("djinn_enter_chamber"))?.chamber === ch.chamber);

  // ---- Failing: the whirlwind
  const blown = await ada.rpc("djinn_answer_chamber", { p_chamber: ch.chamber, p_cipher: "WRONG", p_path: [0], p_weights: [0] });
  const p2 = await ada.pos();
  const flown = Math.hypot((p2.lng - target.lng) * 111320 * k(target.lat), (p2.lat - target.lat) * 110574);
  check("wrong: the whirlwind drops the player at an airport far away", blown?.outcome === "whirlwind" && !!blown.dropAt && Math.abs(p2.lng - blown.dropAt.lng) < 1e-6 && flown > 9000,
    `${blown?.dropAt?.name}, ${Math.round(flown / 1000)} km away`);
  const near = { lng: p2.lng + 0.008, lat: p2.lat }; // the airfield's nearest road, ~900 m off
  const hop = await ada.rpc("save_position", { p_lng: near.lng, p_lat: near.lat, p_mode: "walk" });
  check("landing from the whirlwind: the hop onto a road is allowed", hop?.ok === true, hop?.reason);
  const e = (await admin.from("djinn_entries").select("rings_done").eq("wager_id", w.id).eq("user_id", ada.id).single()).data;
  check("the traps wait again on the way back", e.rings_done.length === 0);

  // ---- Back again, mastering the chamber
  await ada.moveTo(around(target, safeArc, 15));
  const ch2 = await ada.rpc("djinn_enter_chamber");
  const { data: rooms } = await admin.from("djinn_chambers").select("rooms").eq("id", ch2.chamber).single();
  const a = solve(rooms.rooms);
  const end = await ada.rpc("djinn_answer_chamber", { p_chamber: ch2.chamber, p_cipher: a.cipher.toLowerCase(), p_path: a.path, p_weights: a.weights });
  if (ownWager) {
    const { data: held } = await admin.from("player_wonders").select("wonder").eq("user_id", ada.id);
    check("mastered at the real place: the Wonder is theirs", end?.outcome === "won" && held.length >= 1 && held[0].wonder === w.wonder, w.wonder);
    check("the Wager is won for everyone", (await ada.rpc("djinn_state")).stage === "won" && (await bayo.rpc("djinn_state")).stage === "over");
    const others = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } }).from("player_wonders").select("id");
    check("nobody else can see who holds it", (others.data ?? []).length === 0);
  } else {
    check("mastered at a decoy: the vault is empty", end?.outcome === "empty");
    check("and the Djinn has nothing more for them this Wager", (await ada.rpc("djinn_state")).stage === "fooled" && (await ada.rpc("djinn_enter_chamber"))?.reason === "none");
  }
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (ownWager) await admin.from("djinn_wagers").update({ ends_at: new Date(Date.now() - 1000).toISOString() }).eq("id", ownWager);
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${ownWager ? "test Wager ended; " : ""}${fails ? `${fails} FAILED` : "all passed"}`);
}

// The Djinn's Wager through the real database functions (design doc 7.6). Summons a Wager for the test and
// ends it afterwards (so players don't see it); test players are deleted.
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ids = [];
let wagerId = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const isPrime = (n) => n > 1 && [...Array(Math.max(0, Math.floor(Math.sqrt(n)) - 1)).keys()].every((i) => n % (i + 2) !== 0);
const holds = (rule, n) => (rule === "prime" ? isPrime(n) : rule === "three" ? n % 3 === 0 : rule === "four" ? n % 4 === 0 : n % 7 === 0);
try {
  async function player(name) {
    const email = `djinn-${name}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    ids.push(data.user.id);
    const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email, password });
    const rpc = async (fn, args) => (await c.rpc(fn, args)).data;
    return { id: data.user.id, c, rpc, state: () => rpc("djinn_state") };
  }

  // ---- A Wager
  const { data: live } = await admin.from("djinn_wagers").select("id").gt("ends_at", new Date().toISOString()).is("winner", null);
  let ownWager = false;
  if (live?.length) {
    wagerId = live[0].id; // a real Wager is on: play it with test players, and leave it be
    console.log("      (a Wager is already on: testing on it, not ending it)");
    check("a second Wager can't open while one is on", (await admin.rpc("djinn_open_wager")).data === null);
  } else {
    const { data: opened, error: openErr } = await admin.rpc("djinn_open_wager");
    if (openErr) throw new Error(openErr.message);
    wagerId = opened;
    ownWager = true;
  }
  globalThis.ownWager = ownWager;
  const { data: w } = await admin.from("djinn_wagers").select("*").eq("id", wagerId).single();
  const { data: sites } = await admin.from("djinn_sites").select("*").in("id", w.site_ids);
  const real = sites.find((s) => s.id === w.real_site);
  const shared = (s) => (s.continent === real.continent) + (s.setting === real.setting) + (s.kind === real.kind);
  check("a Wager: 8 different seals, one of them the real place", new Set(w.site_ids).size === 8 && w.site_ids.includes(w.real_site), `${real.name}, ${real.country}`);
  check("every decoy shares some traits with the real place, never all three", sites.filter((s) => s.id !== real.id).every((s) => shared(s) < 3),
    `decoys sharing 2: ${sites.filter((s) => s.id !== real.id && shared(s) === 2).length}, 1: ${sites.filter((s) => s.id !== real.id && shared(s) === 1).length}`);
  console.log(`      riddle: "${w.riddle}" · at stake: ${w.wonder} · ends in ${Math.round((Date.parse(w.ends_at) - Date.now()) / 3600000)} h`);

  // ---- Summoned
  const ada = await player("ada");
  const s0 = await ada.state();
  check("every player is summoned, with the Wonder at stake", s0.stage === "summoned" && s0.wager?.id === wagerId && s0.wager.wonder === w.wonder);
  check("nothing secret is sent: no seals, riddle or answers before the gate", !s0.seals && !s0.riddle && !s0.chosen && !s0.gate && !JSON.stringify(s0).includes(w.gate.cipher.answer));

  // ---- The gate, solved
  check("facing the gate starts the clock", (await ada.rpc("djinn_start_gate"))?.ok === true);
  const s1 = await ada.state();
  const left = (Date.parse(s1.gate?.deadline) - Date.parse(s1.now)) / 1000;
  check("at the gate: the cipher, the floor and the scales, 4 minutes", s1.stage === "gate" && !!s1.gate.cipher && s1.gate.floor.grid.length === 6 && s1.gate.scales.weights.length === 6 && Math.abs(left - 240) < 5);
  check("the gate sent no answers (not the phrase, not the floor's rule)", !JSON.stringify(s1.gate).includes(w.gate.cipher.answer) && !("rule" in s1.gate.floor));
  // Solve it the way a player would (with the answers only the database knows).
  const grid = w.gate.floor.grid;
  const path = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[grid.length - 1 - r];
    const col = row.findIndex((n, c) => holds(w.gate.floor.rule, n) && (r === 0 || Math.abs(c - path[r - 1]) <= 1));
    path.push(col);
  }
  const wts = w.gate.scales.weights;
  let stones = [];
  for (let m = 1; m < 64 && !stones.length; m++) {
    const pick = [0, 1, 2, 3, 4, 5].filter((i) => m & (1 << i));
    if (pick.reduce((s, i) => s + wts[i], 0) === w.gate.scales.target) stones = pick;
  }
  const v = await ada.rpc("djinn_answer_gate", { p_cipher: w.gate.cipher.answer.toLowerCase(), p_path: path, p_weights: stones });
  check("all three rooms solved: favour 2", v?.score === 3 && v.favour === 2, JSON.stringify(v?.rooms));
  const s2 = await ada.state();
  const burned = s2.seals?.filter((x) => x.burned) ?? [];
  check("the map: 8 seals with verses, 2 burned, never the real one", s2.stage === "seals" && s2.seals.length === 8 && burned.length === 2 && !burned.some((x) => x.id === real.id));
  check("the riddle is on the map", s2.riddle === w.riddle);
  check("a burned seal won't break", (await ada.rpc("djinn_choose", { p_site: burned[0].id }))?.reason === "seal");
  const chose = await ada.rpc("djinn_choose", { p_site: real.id });
  check("breaking a seal reveals the place", chose?.ok && chose.site.name === real.name);
  const s3 = await ada.state();
  check("the choice is kept: the way is theirs", s3.stage === "chosen" && s3.chosen?.name === real.name);
  check("only one seal per Wager", (await ada.rpc("djinn_choose", { p_site: w.site_ids.find((x) => x !== real.id && !burned.some((b) => b.id === x)) }))?.reason === "chosen");

  // ---- Two rooms: favour 1
  const bayo = await player("bayo");
  await bayo.rpc("djinn_start_gate");
  const v2 = await bayo.rpc("djinn_answer_gate", { p_cipher: w.gate.cipher.answer, p_path: [0, 0, 0, 0, 0, 0].map((_, i) => (path[i] + 2) % 5), p_weights: stones });
  const sb = await bayo.state();
  check("two rooms solved: favour 1, one lie burned", v2?.score === 2 && v2.favour === 1 && sb.seals?.filter((x) => x.burned).length === 1, JSON.stringify(v2?.rooms));

  // ---- All wrong: turned away
  const chika = await player("chika");
  await chika.rpc("djinn_start_gate");
  const v3 = await chika.rpc("djinn_answer_gate", { p_cipher: "WRONG WORDS", p_path: [9], p_weights: [0, 1, 2, 3, 4, 5] });
  const sc = await chika.state();
  const back = (Date.parse(sc.retryAt) - Date.parse(sc.now)) / 60000;
  check("no room solved: turned away for two hours", v3?.score === 0 && sc.stage === "turned_away" && Math.abs(back - 120) < 2 && !sc.seals);
  check("and can't try again yet", (await chika.rpc("djinn_start_gate"))?.reason === "turned_away");

  // ---- Running out of time
  const dayo = await player("dayo");
  await dayo.rpc("djinn_start_gate");
  await admin.from("djinn_entries").update({ gate_deadline: ago(60) }).eq("user_id", dayo.id);
  const sd = await dayo.state();
  check("letting the time run out counts as failing: turned away", sd.stage === "turned_away" && (await dayo.rpc("djinn_start_gate"))?.reason === "turned_away");
  const emeka = await player("emeka");
  await emeka.rpc("djinn_start_gate");
  await admin.from("djinn_entries").update({ gate_deadline: ago(30) }).eq("user_id", emeka.id);
  const v5 = await emeka.rpc("djinn_answer_gate", { p_cipher: w.gate.cipher.answer, p_path: path, p_weights: stones });
  check("right answers after the gate closed: nothing", v5?.score === 0);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  // End the test Wager so no player sees it (no deletes: it just ends).
  if (wagerId && globalThis.ownWager) await admin.from("djinn_wagers").update({ ends_at: new Date(Date.now() - 1000).toISOString() }).eq("id", wagerId);
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; Wager ended: ${!!(wagerId && globalThis.ownWager)}; ${fails ? `${fails} FAILED` : "all passed"}`);
}

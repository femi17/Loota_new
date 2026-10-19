// Games on the road (owner, 19 Oct 2026), through the real database functions: what the player is sent has no answer;
// the three cups, mate in one and pairs are judged by the server (right: 25 coins from a passer-by, wrong: nothing);
// a traveller's game only once you've helped them (20 coins), and only once; the games dealt are sound (the cups'
// answer is where the shuffle leaves the coin; six pairs of twelve cards). The test player is deleted.
//   node scripts/tests/road-games-api-test.mjs
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

try {
  const email = `games-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 100, updated_at: new Date().toISOString() });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const coins = async () => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
  const plant = async (kind, game, npc = "Test") => (await admin.from("road_events").insert({ user_id: id, kind, npc, game }).select("id").single()).data.id;
  // Play tapped (the clock starts), then the move.
  const play = async (ev, move, tap = true) => {
    if (tap) await c.rpc("road_event_game_start", { p_event: ev });
    return (await c.rpc("road_event_play", { p_event: ev, p_move: move })).data;
  };

  // ---- The game the player is sent has no answer
  const cups = { type: "cups", start: 0, swaps: [[0, 1], [1, 2]], ms: 520, answer: "2" };
  let ev = await plant("seller", cups, "Tunde Wayo");
  const roll = (await c.rpc("road_event_roll", { p_hunt: null })).data;
  check("the passer-by's game reaches the player without its answer", roll?.event?.game?.type === "cups" && !("answer" in roll.event.game) && roll.event.game.swaps.length === 2, JSON.stringify(roll?.event?.game));

  // ---- The three cups
  let c0 = await coins();
  let r = await play(ev, "1");
  check("cups, the wrong cup: lost, nothing", r?.ok && r.won === false && r.answer === "2" && (await coins()) === c0, JSON.stringify(r));
  check("…and played once only", (await play(ev, "2"))?.reason === "gone");
  ev = await plant("seller", cups);
  r = await play(ev, "2");
  check("cups, the right cup: 25 coins", r?.won === true && r.reward === 25 && (await coins()) === c0 + 25, JSON.stringify(r));
  const row = (await admin.from("road_events").select("outcome, resolved_at, game_won").eq("id", ev).single()).data;
  check("…the passer-by's event closed as won", row.outcome === "won" && !!row.resolved_at && row.game_won === true, JSON.stringify(row));

  // ---- Mate in one
  const chess = { type: "chess", fen: "4k3/4pp2/8/6P1/6Q1/8/5PPP/6K1 w - - 0 1", answer: "g4c8", san: "Qc8#" };
  ev = await plant("seller", chess, "Baba Sola");
  c0 = await coins();
  r = await play(ev, "g4d7");
  check("chess, not mate: lost, and told the mate", r?.won === false && r.san === "Qc8#" && (await coins()) === c0, JSON.stringify(r));
  ev = await plant("seller", chess, "Baba Sola");
  r = await play(ev, "G4C8");
  check("chess, the mate: 25 coins", r?.won === true && (await coins()) === c0 + 25, JSON.stringify(r));

  // ---- Pairs
  const cards = ["🥭", "🐐", "🥭", "⚽", "🐐", "🍌", "⚽", "🥁", "🍌", "🛺", "🥁", "🛺"];
  const perfect = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 11];
  ev = await plant("seller", { type: "pairs", cards, misses: 6 }, "Tobi");
  c0 = await coins();
  r = await play(ev, JSON.stringify(perfect));
  check("pairs, all six found: 25 coins", r?.won === true && (await coins()) === c0 + 25, JSON.stringify(r));
  const sloppy = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, ...perfect]; // seven misses first
  ev = await plant("seller", { type: "pairs", cards, misses: 6 });
  check("pairs, seven misses: lost", (await play(ev, JSON.stringify(sloppy)))?.won === false);
  ev = await plant("seller", { type: "pairs", cards, misses: 6 });
  check("pairs, a card turned twice as its own pair (cheating): lost", (await play(ev, JSON.stringify([0, 0, ...perfect])))?.won === false);
  ev = await plant("seller", { type: "pairs", cards, misses: 6 });
  check("pairs, not every pair found: lost", (await play(ev, JSON.stringify(perfect.slice(0, 10))))?.won === false);
  ev = await plant("seller", { type: "pairs", cards, misses: 6 });
  check("pairs, nonsense sent: refused", (await play(ev, "not json"))?.ok === false);

  // ---- A traveller's game: only once helped
  ev = await plant("traveller", cups, "Blessing");
  check("a traveller's game before helping: refused", (await play(ev, "2"))?.reason === "gone");
  await c.rpc("road_event_answer", { p_event: ev, p_choice: 1 });
  c0 = await coins();
  r = await play(ev, "2");
  check("…once helped: 20 coins for winning it", r?.won === true && r.reward === 20 && (await coins()) === c0 + 20, JSON.stringify(r));
  check("…and only once", (await play(ev, "2"))?.reason === "gone");
  const tr = (await admin.from("road_events").select("outcome").eq("id", ev).single()).data;
  check("…the traveller still counted as helped", tr.outcome === "helped");

  // ---- Against the clock
  ev = await plant("seller", chess, "Baba Sola");
  const st = (await c.rpc("road_event_game_start", { p_event: ev })).data;
  check("Play starts the clock: 30 seconds for mate in one", st?.ok && Math.round(st.seconds) === 30, JSON.stringify(st));
  await admin.from("road_events").update({ game_started_at: new Date(Date.now() - 40_000).toISOString() }).eq("id", ev);
  c0 = await coins();
  r = await play(ev, "g4c8", false);
  check("the mate, but 40 s after Play: too late, lost", r?.won === false && r.late === true && (await coins()) === c0, JSON.stringify(r));
  ev = await plant("seller", chess, "Baba Sola");
  r = await play(ev, "g4c8", false);
  check("a move without tapping Play: lost", r?.won === false && r.late === true);
  ev = await plant("seller", { ...cups, seconds: 6 });
  const cs = (await c.rpc("road_event_game_start", { p_event: ev })).data;
  check("the cups: 6 s to pick, after the coin shown and the shuffle", Math.abs(cs.seconds - (6 + 1.5 + 2 * 0.52)) < 0.01, String(cs.seconds));
  ev = await plant("seller", { type: "pairs", cards, misses: 6, seconds: 50 });
  check("pairs: 50 s", Math.round((await c.rpc("road_event_game_start", { p_event: ev })).data.seconds) === 50);

  // ---- The games dealt are sound
  let cupsOk = true;
  for (let i = 0; i < 25; i++) {
    const g = (await admin.rpc("road_game", { p_type: "cups" })).data;
    let at = g.start;
    for (const [a, b] of g.swaps) at = at === a ? b : at === b ? a : at;
    if (String(at) !== g.answer || g.swaps.length < 5 || g.swaps.length > 8 || g.swaps.some(([a, b]) => a === b)) cupsOk = false;
  }
  check("25 cup games dealt: the answer is where the shuffle leaves the coin (5–8 swaps)", cupsOk);
  let pairsOk = true;
  for (let i = 0; i < 10; i++) {
    const g = (await admin.rpc("road_game", { p_type: "pairs" })).data;
    const counts = {};
    for (const x of g.cards) counts[x] = (counts[x] ?? 0) + 1;
    if (g.cards.length !== 12 || Object.keys(counts).length !== 6 || Object.values(counts).some((n) => n !== 2)) pairsOk = false;
  }
  check("10 pairs games dealt: twelve cards, six pictures twice each", pairsOk);
  const g = (await admin.rpc("road_game", { p_type: "chess" })).data;
  check("a chess game dealt: a puzzle from the bank (or the cups while it's empty)", (g.type === "chess" && /^[\w/]+ w /.test(g.fen) && /^[a-h][1-8][a-h][1-8]$/.test(g.answer)) || g.type === "cups", JSON.stringify(g).slice(0, 120));
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

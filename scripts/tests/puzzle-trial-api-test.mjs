// Key Trials as puzzles (owner, 24 Oct 2026), through the real database and the game's server (the dev server must be
// running): a throwaway hunt with three keys at one spot (Sentries, Route, Adire). At each chest: a puzzle trial; the
// puzzle comes without its answer and the clock starts; asking again (a reload) gets the same puzzle; a wrong answer
// costs a life, the right one wins the key. Then a fourth key: two wrong answers fail it; and a late answer fails.
// The hunt and test player are deleted.
//   node scripts/tests/puzzle-trial-api-test.mjs
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
const spot = { lng: 3.378214, lat: 6.500147 }; // on a road in Yaba

try {
  const email = `puzzle-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;
  await admin.from("profiles").update({ home_lng: spot.lng, home_lat: spot.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: spot.lng, lat: spot.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Puzzle test (automated)", prize: "none", winners: 1, starts_at: ago(600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  const key = (n, trial_kind) => ({ hunt_id: huntId, n, riddle: `Test key ${n}.`, category: "maths", trial_kind, area_lng: spot.lng, area_lat: spot.lat, area_radius_m: 800, spot_lng: spot.lng, spot_lat: spot.lat });
  await admin.from("hunt_keys").insert([key(1, "sentries"), key(2, "route"), key(3, "adire"), key(4, "puzzle"), key(5, "puzzle")]);
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: id });

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const post = async (path, body) => {
    const res = await fetch(`http://localhost:3000${path}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return res.json();
  };
  const search = async () => {
    await admin.from("hunt_players").update({ last_search_at: null }).eq("hunt_id", huntId).eq("user_id", id);
    await admin.from("player_positions").update({ updated_at: ago(30) }).eq("user_id", id);
    return (await c.rpc("search_here", { p_hunt: huntId, p_lng: spot.lng, p_lat: spot.lat, p_mode: "walk" })).data;
  };
  /** The stored answer, in the shape the phone sends. */
  const answerOf = async (attempt) => {
    const { data: t } = await admin.from("trial_attempts").select("kind, solution").eq("id", attempt).single();
    return t.kind === "sentries" ? t.solution.map((col, row) => [row, col]) : t.solution;
  };
  const wrongOf = (kind, a) => kind === "sentries" ? a.map(([r, cc], i) => (i === 0 ? [r, (cc + 1) % a.length] : [r, cc]))
    : kind === "route" ? [...a.slice(0, -2), a.at(-1), a.at(-2)] : a.map((v, i) => (i === 0 ? 1 - v : v));

  for (const n of [1, 2, 3]) {
    const r = await search();
    check(`key ${n}: the chest opens a puzzle trial`, r?.result === "trial" && r.trial.kind === "puzzle" && r.trial.puzzle === null, JSON.stringify(r?.trial ?? r).slice(0, 140));
    const kind = r.trial.puzzleKind;
    const p = await post("/api/trial/puzzle");
    check(`…a ${kind} puzzle (level ${p.level}), its clock running, no answer sent`, !!p.puzzle && p.secondsLeft > 60 && !("solution" in p) && !JSON.stringify(p).includes("answer"), `${p.seconds} s`);
    const again = await post("/api/trial/puzzle");
    check("…asked again (a reload): the same puzzle", JSON.stringify(again.puzzle) === JSON.stringify(p.puzzle));
    const right = await answerOf(p.attempt);
    const w = await post("/api/trial/solve", { attempt: p.attempt, answer: wrongOf(kind, right) });
    check("…a wrong answer: a life gone", w?.result === "wrong" && w.lives === 1, JSON.stringify(w));
    const s = await post("/api/trial/solve", { attempt: p.attempt, answer: right });
    check(`…the right answer: Key ${n}`, s?.result === "key" && s.keysHeld === n, JSON.stringify(s).slice(0, 120));
  }

  // Key 4: two wrong answers fail it (thrown 2 km away).
  let r = await search();
  let p = await post("/api/trial/puzzle");
  const right4 = await answerOf(p.attempt);
  await post("/api/trial/solve", { attempt: p.attempt, answer: wrongOf(p.puzzleKind, right4) });
  const f = await post("/api/trial/solve", { attempt: p.attempt, answer: wrongOf(p.puzzleKind, right4) });
  check(`key 4 (${p.puzzleKind}, chosen at random): two wrong answers fail the trial, thrown away`, f?.result === "failed" && f.reason === "wrong" && typeof f.lng === "number", JSON.stringify(f).slice(0, 120));
  const { data: pos } = await admin.from("player_positions").select("lng, lat").eq("user_id", id).single();
  const away = Math.hypot((pos.lng - spot.lng) * 110400, (pos.lat - spot.lat) * 110574);
  check("…2 km from the key", Math.abs(away - 2000) < 60, `${Math.round(away)} m`);

  // Back at the chest: a new puzzle; answered after the clock: failed.
  await admin.from("player_positions").update({ lng: spot.lng, lat: spot.lat, updated_at: ago(30) }).eq("user_id", id);
  r = await search();
  p = await post("/api/trial/puzzle");
  check("back at the chest: a new puzzle", r?.result === "trial" && JSON.stringify(p.puzzle) !== "null");
  await admin.from("trial_attempts").update({ deadline: ago(10) }).eq("id", p.attempt);
  const late = await post("/api/trial/solve", { attempt: p.attempt, answer: await answerOf(p.attempt) });
  check("…right, but after the clock: failed (timeout)", late?.result === "failed" && late.reason === "timeout", JSON.stringify(late).slice(0, 100));

  // A quiz answer can't be used on a puzzle trial.
  await admin.from("player_positions").update({ lng: spot.lng, lat: spot.lat, updated_at: ago(30) }).eq("user_id", id);
  r = await search();
  const quiz = (await c.rpc("answer_trial", { p_attempt: r.trial.attempt, p_choice: 0 })).data;
  check("a quiz answer on a puzzle trial: refused", quiz?.ok === false, JSON.stringify(quiz));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (huntId) {
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_bonuses").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test player deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

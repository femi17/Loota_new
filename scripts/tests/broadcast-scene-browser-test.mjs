// Scenes on the broadcast (owner, 9 Nov 2026: "how do we handle the road side event, like the police, or random user
// stopping users… do we display the scene"; step 2). A hunter in a live test hunt rides their motorbike somewhere by
// themselves (a phone, its own browser); a police checkpoint stops them; they answer wrong (a 20-coin fine) and go on.
// The owner's broadcast follows them (a laptop, its own browser): a few seconds later the same checkpoint is built at
// the kerb, the camera looks in, and the words come up as captions as they were said (the officer's question, the
// hunter's answer, the fine); a card shows the answers on offer, then the one they chose (owner, 9 Nov 2026: "lets see
// the puzzle, or question asked by the police or strangers and see how the user plays it"); when they go on, the scene
// closes and the caption goes. Then a cups man stops them: on the broadcast, the same three cups while they play, then
// that they won. The scenes are saved (no Realtime): model, place, lines. The hunt and the accounts are deleted.
//   SHOTS=<folder> node scripts/tests/broadcast-scene-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const NL = String.fromCharCode(10);
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const ids = [];
let huntId = null, browser, browser2;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const start = { lng: 3.3787, lat: 6.5186 };
const target = { lng: 3.3560, lat: 6.5800 }; // 7 km on: they ride while the checkpoint comes
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `bscene-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};
const signedIn = async (u) => {
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: u.email, password: u.password });
  return jar;
};

try {
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const hunter = await user("hunter");
  const name = `Rider${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: start.lng, home_lat: start.lat, home_set_at: new Date().toISOString(), rider_licence: true }).eq("id", hunter.id);
  await admin.rpc("apply_coin_change", { p_user: hunter.id, p_amount: 100, p_kind: "admin", p_reason: "Broadcast scene test" });
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: start.lng, lat: start.lat, mode: "motorbike", energy: 100, updated_at: ago(20) });
  await admin.from("player_vehicles").insert({ user_id: hunter.id, kind: "motorbike", lng: start.lng, lat: start.lat, in_use: true, fuel: 100, tyre: 100, engine: 100, light: true, helmet: true, registered: true, insured: true });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast scene test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "The test key, far away.", category: "maths", area_lng: 3.45, area_lat: 6.58, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.58 });
  // The first riddle's answer already locked in (the riddle clock lets them move)
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60), guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 });

  browser = await launch();
  browser2 = await launch();
  const problems = [];
  const open = async (b, jar, path, viewport, uid) => {
    const page = await (await b.createBrowserContext()).newPage();
    await page.setViewport(viewport);
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    if (uid) await page.evaluateOnNewDocument((id, h) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); localStorage.setItem(`loota:riddle-seen:${h}`, "1"); } catch {} }, uid, huntId);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    return page;
  };
  const game = await open(browser, await signedIn(hunter), `/play?hunt=${huntId}`, { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, hunter.id);
  const show = await open(browser2, await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: 720 });
  await wait(20000);
  await show.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), name);
  // Riding by themselves
  await game.evaluate((t) => {
    const m = window.__lootaMap;
    m.fire("click", { lngLat: t, point: m.project([t.lng, t.lat]), originalEvent: { target: m.getCanvas() } });
  }, target);
  await wait(4000);
  // The checkpoint, planted: met on the way
  await admin.from("road_events").insert({ user_id: hunter.id, hunt_id: huntId, kind: "checkpoint", npc: "Officer Bello", question: { prompt: "What does a red traffic light mean?", choices: ["Go faster", "Stop", "Turn left only"], answer: 1 } });
  const sceneText = () => game.evaluate((nl) => document.querySelector('[role="dialog"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  let met = null;
  for (let i = 0; i < 90 && !/red traffic light/.test(met ?? ""); i++) { await wait(1000); met = await sceneText(); }
  check("riding by themselves: stopped at a police checkpoint (their screen)", /red traffic light/.test(met ?? ""), met?.slice(0, 120));
  await wait(2500);
  const clickText = (t) => game.evaluate((x) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((y) => y.textContent?.includes(x) && !y.disabled); b?.click(); return !!b; }, t);
  await clickText("Go faster");

  // The broadcast, a few seconds behind: the same checkpoint, looked into
  const shown = () => show.evaluate((id) => { const all = window.__broadcastShown?.(); return { scene: all?.scene ?? null, followed: !!all?.[id] }; }, hunter.id);
  const caption = () => show.evaluate((nl) => document.querySelector('[aria-label="Scene caption"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  let built = null, first = null;
  // (it grows in, and the first line comes up at its moment)
  for (let i = 0; i < 40 && !(built?.scene?.scale > 1 && /red traffic light/.test(first ?? "")); i++) {
    await wait(500);
    built = await shown();
    first = await caption();
  }
  check("on the broadcast: the checkpoint built at the kerb, the camera looking in", !!built?.scene && built.scene.scale > 1, JSON.stringify(built?.scene));

  const card = () => show.evaluate((nl) => document.querySelector('[aria-label="Scene card"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  // One after the other, as on their own screen (owner, 13 Nov 2026: "Must this 2 show together on the screen, can it be
  // one after the other, like the user's page"): the officer's question alone first; then the answers on offer in its
  // place; the one picked; then the caption again with the answer
  const alone = await card();
  check("…first the caption alone: a police checkpoint, the officer's question", /police checkpoint/i.test(first ?? "") && /red traffic light/.test(first ?? "") && !alone, `${first} · card: ${alone}`);
  await show.screenshot({ path: `${OUT}/broadcast-scene-1-question.png` });
  let offered = null;
  for (let i = 0; i < 30 && !/Go faster/.test(offered ?? ""); i++) { await wait(300); offered = await card(); }
  const capThen = await caption();
  check("…then the answers on offer, in its place (the caption gone meanwhile)", /Go faster/.test(offered ?? "") && /Stop/.test(offered ?? "") && /Turn left only/.test(offered ?? "") && !capThen, `${offered} · caption: ${capThen}`);
  await show.screenshot({ path: `${OUT}/broadcast-scene-1b-choosing.png` });
  let chose = null;
  for (let i = 0; i < 30 && !/chose/i.test(chose ?? ""); i++) { await wait(300); chose = await card(); }
  check("…the answer they chose, picked out", /chose/i.test(chose ?? "") && /👉 Go faster/.test(chose ?? ""), chose);
  let answered = null;
  for (let i = 0; i < 30 && !/Go faster/.test(answered ?? ""); i++) {
    await wait(500);
    answered = await caption();
  }
  const cardThen = await card();
  check("…then the caption again: the hunter's answer, as they said it (the card gone)", /Go faster/.test(answered ?? "") && !cardThen, `${answered} · card: ${cardThen}`);
  const boxes = () => show.evaluate(() => {
    const at = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
    return { card: at('[aria-label="Scene card"] > div, [aria-label="Scene card"]'), caption: at('[aria-label="Scene caption"]'), side: !!document.querySelector("[data-card-side]"), w: innerWidth };
  });
  let fined = null;
  for (let i = 0; i < 30 && !/20-coin fine/.test(fined ?? ""); i++) { await wait(500); fined = await caption(); }
  check("…and the officer's fine", /20-coin fine/.test(fined ?? ""), fined);
  await show.screenshot({ path: `${OUT}/broadcast-scene-2-fine.png` });

  // They go on: the scene closes there too
  for (let i = 0; i < 20 && !(await clickText("Go on")); i++) await wait(500);
  let gone = null;
  for (let i = 0; i < 40; i++) {
    await wait(500);
    gone = await shown();
    if (!gone.scene && !(await caption())) break;
  }
  check("they go on: on the broadcast the scene closes and the caption goes", !gone?.scene && !(await caption()), JSON.stringify(gone));
  // A cups man further on: the game, played
  const swaps = [[0, 1], [1, 2], [0, 2], [0, 1], [1, 2]];
  let at = 2;
  for (const [a, b] of swaps) at = at === a ? b : at === b ? a : at;
  await admin.from("road_events").insert({ user_id: hunter.id, hunt_id: huntId, kind: "seller", npc: "Tunde Wayo", game: { type: "cups", start: 2, swaps, ms: 520, answer: String(at) } });
  let cups = null;
  for (let i = 0; i < 90 && !/coin goes under one cup/.test(cups ?? ""); i++) { await wait(1000); cups = await sceneText(); }
  check("riding on: a cups man stops them (their screen)", /coin goes under one cup/.test(cups ?? ""), cups?.slice(0, 100));
  for (let i = 0; i < 20 && !(await clickText("Play · win 25")); i++) await wait(500);
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    await wait(300);
    ready = await game.evaluate(() => { const c = [...document.querySelectorAll("[data-cup-slot]")]; return c.length === 3 && c.every((b) => !b.disabled); });
  }
  await game.evaluate((slot) => document.querySelector(`[data-cup-slot="${slot}"]`)?.click(), at);
  let board = null;
  for (let i = 0; i < 30 && !board?.cups; i++) {
    await wait(500);
    board = await show.evaluate(() => ({ cups: document.querySelectorAll('[aria-label="Scene card"] [data-cup-slot]').length, text: document.querySelector('[aria-label="Scene card"]')?.textContent ?? "" }));
  }
  check("on the broadcast: the same three cups while they play", board?.cups === 3 && /is playing/i.test(board.text), JSON.stringify(board));
  const laidGame = await boxes();
  check("…the game on one side, as the 3D world's puzzles, clear of the caption", laidGame.side && laidGame.card && laidGame.card.left > laidGame.w / 2 - 40 && (!laidGame.caption || laidGame.card.bottom <= laidGame.caption.top), JSON.stringify(laidGame));
  await show.screenshot({ path: `${OUT}/broadcast-scene-3-cups.png` });
  let won = null;
  for (let i = 0; i < 30 && !/wins it/i.test(won ?? ""); i++) { await wait(500); won = await card(); }
  check("…then that they won it", /wins it/i.test(won ?? ""), won?.slice(0, 80));
  await show.screenshot({ path: `${OUT}/broadcast-scene-4-won.png` });

  const { data: saved } = await admin.from("hunter_scenes").select("data, lines, ended_ms").eq("user_id", hunter.id).order("started_ms", { ascending: true }).limit(1).single();
  check("saved: its model, where it stands, every line, and its end", saved?.data?.model?.make === "makeCheckpointScene" && !!saved.data.origin && saved.lines.filter((l) => l[1] === "them" || l[1] === "you").length >= 3 && saved.lines.some((l) => l[1] === "ask") && saved.lines.some((l) => l[1] === "pick") && !!saved.ended_ms,
    `${saved?.data?.model?.make}, ${saved?.lines?.length} lines, ended ${!!saved?.ended_ms}`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  await browser2?.close();
  if (huntId) {
    await admin.from("road_events").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("player_vehicles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

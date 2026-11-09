// The key's place on the broadcast (owner, 9 Nov 2026: step 3, "the key location… we can broadcast that too for viewers").
// A hunter at Key 1 of a test hunt (a phone, its own browser) explores the place; the owner's broadcast follows them (a
// laptop, its own browser). A few seconds later the broadcast shows the same place, as the hunter's own arrangement of
// it (the same seat), the hunter in it; they walk (the arrow keys) and the broadcast's hunter walks the same way. They
// walk up to a locked box: its puzzle opens, and on the broadcast a card shows the same board, the time left, and, once
// they solve it, that they opened it. Saved (no Realtime): the place, where they walked, the puzzle and its end.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-keyworld-browser-test.mjs
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
const PLACE = { lng: 139.7005, lat: 35.6591 };
const HOUSE = { title: "Kumiko's corner by the station", style: "manor", items: {}, scene: { ground: "city", pieces: ["station", "dog-statue", "scramble", "screens"] }, rooms: [
  { id: "noodles", name: "The noodle stall", kind: "kitchen", role: "right" },
  { id: "fountain", name: "The wishing fountain", kind: "bathroom", role: "trap" },
  { id: "bikes", name: "The bicycle yard", kind: "storeroom", role: "trap", outdoor: true },
  { id: "manga", name: "The comic book stall", kind: "library", role: "safe" },
  { id: "garden", name: "The little garden", kind: "study", role: "safe", outdoor: true },
] };
const launch = () => puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const user = async (tag) => {
  const email = `bworld-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
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
  const name = `Seeker${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: 139.69, home_lat: 35.66, home_set_at: new Date().toISOString(), coins: 500 }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: PLACE.lng, lat: PLACE.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const { data: hunt, error } = await admin.from("hunts")
    .insert({ title: "Broadcast key world test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true })
    .select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  for (const n of [1, 2]) {
    await admin.from("hunt_keys").insert({ hunt_id: huntId, n, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: PLACE.lng + (n - 1) * 0.05, area_lat: PLACE.lat, area_radius_m: 1500,
      spot_lng: PLACE.lng + (n - 1) * 0.05, spot_lat: PLACE.lat, exact_m: 120, house: HOUSE });
  }
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, guess_n: 1, guess_name: "The place", guess_lng: PLACE.lng, guess_lat: PLACE.lat, leg_lng: PLACE.lng, leg_lat: PLACE.lat });

  browser = await launch();
  browser2 = await launch();
  const problems = [];
  const open = async (b, jar, path, viewport, uid) => {
    const page = await (await b.createBrowserContext()).newPage();
    await page.setViewport(viewport);
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
    if (uid) await page.evaluateOnNewDocument((id, h) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); localStorage.setItem(`loota:riddle-seen:${h}`, "1"); localStorage.setItem(`loota:story:${h}:start`, "1"); } catch {} }, uid, huntId);
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    return page;
  };
  const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 400) { const v = await fn(); if (v) return v; await wait(400); } return null; };
  const game = await open(browser, await signedIn(hunter), `/play?hunt=${huntId}`, { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, hunter.id);
  const show = await open(browser2, await signedIn(owner), `/broadcast?hunt=${huntId}`, { width: 1280, height: 720 });
  const SCENE = '[aria-label="The key\'s place"]';
  const attr = (n) => game.evaluate((sel, k) => document.querySelector(sel)?.getAttribute(k), SCENE, n);
  const where = async () => (await attr("data-at") ?? "0,0").split(",").map(Number);
  // The hunter: into the key's place
  const go = await until(() => game.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Explore the place/.test(x.textContent ?? "")); b?.click(); return !!b; }), 90000);
  const opened = go && (await until(() => game.evaluate((sel) => !!document.querySelector(sel), SCENE), 15000));
  check("the hunter: into the key's place (their screen)", !!opened);
  await until(async () => (await attr("data-at")) != null && (await attr("data-busy")) === "false", 20000);
  // The broadcast follows them
  await until(() => show.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n)); b?.click(); return !!b; }, name), 30000);
  const world = await until(() => show.evaluate(() => (document.querySelector("[data-key-world]") ? { key: document.querySelector("[data-key-world]").getAttribute("data-key-world"), shown: window.__broadcastShown?.()?.keyWorld ?? null } : null)), 40000);
  check("on the broadcast: the key's place shown (Key 1)", world?.key === "1" && !!world.shown, JSON.stringify(world));
  const caption = () => show.evaluate((nl) => document.querySelector('[aria-label="Scene caption"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  const titled = await until(async () => { const c = await caption(); return /key's place/i.test(c ?? "") && c; }, 10000);
  check("…titled: they're searching the key's place, its name", /key's place/i.test(titled ?? "") && /Kumiko/i.test(titled ?? ""), titled);
  await wait(2500);
  await show.screenshot({ path: `${OUT}/broadcast-world-1-arrive.png` });

  // They walk: on the broadcast, the same steps a few seconds later
  const bAt = async () => (await show.evaluate(() => document.querySelector("[data-key-world]")?.getAttribute("data-at") ?? "0,0")).split(",").map(Number);
  const [x0, z0] = await where();
  const [bx0, bz0] = await bAt();
  check("…the broadcast's hunter stands where they stand", Math.hypot(bx0 - x0, bz0 - z0) < 1, `${bx0},${bz0} vs ${x0.toFixed(1)},${z0.toFixed(1)}`);
  const watching = show.evaluate(() => new Promise((done) => {
    const out = [];
    const t0 = performance.now();
    const step = (t) => {
      const a = document.querySelector("[data-key-world]")?.getAttribute("data-at");
      if (a && a !== out.at(-1)?.join(",")) out.push(a.split(",").map(Number));
      if (t - t0 < 20000) requestAnimationFrame(step);
      else done(out);
    };
    requestAnimationFrame(step);
  }));
  await game.keyboard.down("ArrowUp");
  await wait(1500);
  await game.keyboard.up("ArrowUp");
  const [x1, z1] = await where();
  check("the hunter walks (their screen)", z1 < z0 - 3, `${z0.toFixed(1)} → ${z1.toFixed(1)}`);
  const seen = await watching;
  const end = seen.at(-1) ?? [bx0, bz0];
  const [xr, zr] = await where(); // where they came to rest (they glide a little after the key is let go)
  const steps = seen.filter((p, i) => i && Math.hypot(p[0] - seen[i - 1][0], p[1] - seen[i - 1][1]) > 0.05).length;
  check("…on the broadcast, the same walk: ends where they stopped", Math.hypot(end[0] - xr, end[1] - zr) < 0.6, `${end} vs ${xr.toFixed(1)},${zr.toFixed(1)}`);
  check("…walked, not jumped (several steps on the way)", steps >= 3, `${steps} steps seen`);
  const back = seen.some((p, i) => i && p[1] > seen[i - 1][1] + 0.3);
  check("…never stepping back", !back);
  await show.screenshot({ path: `${OUT}/broadcast-world-2-walked.png` });

  // A locked box: its puzzle, on the broadcast as a card. Each box's kind is dealt at random; the first that answers
  // can be put into by a script (a choice of answers, typed answers, a sudoku) is the one played
  const card = () => show.evaluate((nl) => document.querySelector('[aria-label="Scene card"]')?.innerText.split(nl).join(" | ") ?? null, NL);
  let BOX = 0;
  for (const n of [2, 3, 4, 5]) {
    await until(async () => (await attr("data-busy")) === "false", 20000);
    await game.evaluate((k) => window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: { tap: "inner", id: String(k) } })), n);
    const open = await until(() => game.evaluate((k) => !!document.querySelector(`[data-room-puzzle="${k}"]`), n), 40000);
    if (!open) continue;
    await wait(800);
    const playable = await game.evaluate((k) => {
      const root = document.querySelector(`[data-room-puzzle="${k}"]`);
      return !!root?.querySelector("[data-question], input, [data-cell]");
    }, n);
    if (playable) {
      BOX = n;
      break;
    }
    console.log(`  (Box ${n}'s puzzle has no answers a script can put in: on to the next)`);
    await game.evaluate(() => document.querySelector('[aria-label="Close the puzzle"]')?.click());
    await wait(500);
  }
  check("they walk up to a box: its puzzle opens (their screen)", BOX > 0, `Box ${BOX}`);
  const shownCard = await until(async () => { const c = await card(); return new RegExp(`Box ${BOX}`, "i").test(c ?? "") && c; }, 20000);
  const boardCells = await show.evaluate(() => document.querySelectorAll('[aria-label="Scene card"] button, [aria-label="Scene card"] input').length);
  check("on the broadcast: a card, the box's puzzle, its board and the time left", new RegExp(`Box ${BOX}`, "i").test(shownCard ?? "") && /⏱ \d+s/.test(shownCard ?? "") && boardCells > 3, `${shownCard?.slice(0, 120)} · ${boardCells} cells`);
  // The hunter puts answers in (owner, 9 Nov 2026: "the users answers in the 3d world is not displayed"): on the
  // broadcast's card, the same answers a few seconds later. What's been put in: each square's or answer's label (a
  // sudoku square says its number) and whether it's picked (a lighter highlight is only the square selected), and
  // what's typed in each box.
  const picked = (pg, sel) => pg.evaluate((s) => {
    const root = document.querySelector(s);
    if (!root) return null;
    const cells = [...root.querySelectorAll("[data-cell], [data-question] button")];
    const typed = [...root.querySelectorAll("input")].map((i) => `[${i.value}]`);
    return [...cells.map((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "") + (/\bbg-gold(\s|$)/.test(b.className) ? "*" : "")), ...typed].join("|");
  }, sel);
  const GAME_BOARD = `[data-room-puzzle="${BOX}"]`, CARD = '[aria-label="Scene card"]';
  const before = await picked(game, GAME_BOARD);
  await game.evaluate((s) => {
    const qs = [...document.querySelectorAll(`${s} [data-question]`)];
    qs[0]?.querySelectorAll("button")[0]?.click();
    qs[1]?.querySelectorAll("button")[1]?.click();
  }, GAME_BOARD);
  // Typed answers (countries, words, equations): the first two boxes
  for (const [k, word] of [[0, "Testland"], [1, "Other"]]) {
    const input = (await game.$$(`${GAME_BOARD} input`))[k];
    if (input) await input.type((await input.evaluate((i) => i.inputMode === "numeric" || i.type === "number")) ? String(7 + k) : word);
  }
  // A sudoku: a number into an empty square, then another
  for (const d of [5, 3]) {
    const tapped = await game.evaluate((s) => {
      const empty = [...document.querySelectorAll(`${s} [data-cell]`)].find((b) => /empty$/.test(b.getAttribute("aria-label") ?? ""));
      empty?.click();
      return !!empty;
    }, GAME_BOARD);
    if (!tapped) break;
    await wait(150);
    await game.evaluate((s, n) => document.querySelector(`${s} [aria-label="Number ${n}"]`)?.click(), GAME_BOARD, d);
    await wait(150);
  }
  await wait(300);
  const mine = await picked(game, GAME_BOARD);
  const theirs = await until(async () => { const p = await picked(show, CARD); return p === mine && p; }, 20000);
  const differs = (a, b) => (a ?? "").split("|").filter((x, i) => x !== (b ?? "").split("|")[i]).join(" | ");
  check("the hunter puts answers in: the broadcast's card shows the same ones", !!mine && mine !== before && theirs === mine, `put in: ${differs(mine, before).slice(0, 120)}${theirs === mine ? "" : `; the broadcast differs: ${differs(await picked(show, CARD), mine).slice(0, 120)}`}`);
  await show.screenshot({ path: `${OUT}/broadcast-world-3-puzzle.png` });
  const stored = (await admin.from("house_room_puzzles").select("kind, solution").eq("user_id", hunter.id).eq("hunt_id", huntId).eq("room", BOX).single()).data;
  const answer = stored.kind === "sentries" ? stored.solution.map((col, row) => [row, col]) : stored.solution;
  await wait(1500);
  await game.evaluate((a) => window.__lootaRoomSolve?.(a), answer);
  const done = await until(async () => { const c = await card(); return new RegExp(`opened Box ${BOX}`, "i").test(c ?? "") && c; }, 20000);
  check("…solved: on the broadcast, they opened it", new RegExp(`opened Box ${BOX}`, "i").test(done ?? ""), done?.slice(0, 120));
  await show.screenshot({ path: `${OUT}/broadcast-world-4-opened.png` });
  const gone = await until(async () => !(await card()), 15000);
  check("…and the card goes a few seconds later", !!gone);

  // Leaving: the broadcast goes back to the map
  await game.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Leave/.test(b.textContent?.trim() ?? ""))?.click());
  const left = await until(() => show.evaluate(() => !document.querySelector("[data-key-world]")), 30000);
  check("they leave: the broadcast is back on the map", !!left);

  const { data: saved } = await admin.from("hunter_scenes").select("data, lines, track, ended_ms").eq("user_id", hunter.id).order("started_ms", { ascending: true }).limit(1).single();
  check("saved: the place (their seat), where they walked, the puzzle and how it ended",
    saved?.data?.kind === "keyworld" && saved.data.seat === `${hunter.id}:1` && saved.track.length >= 5 && saved.lines.some((l) => l[1] === "puzzle") && saved.lines.some((l) => l[1] === "result" && /"right":true/.test(l[2])) && !!saved.ended_ms,
    `${saved?.data?.kind}, ${saved?.track?.length} points, ${saved?.lines?.length} lines, ended ${!!saved?.ended_ms}`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  await browser2?.close();
  if (huntId) {
    await admin.from("house_room_puzzles").delete().eq("hunt_id", huntId);
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

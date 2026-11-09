// Security audit: attack the platform as an outsider and as an ordinary player (owner, 9 Nov 2026: "is this secured.
// Can you run an audit, try to hacker the platform and see if it breaks"). Only throwaway accounts made here are used
// (an attacker and a victim with the game open); nothing real is touched, and all of it is deleted at the end.
// Each attempt prints SAFE (refused, as it should be) or HOLE (it worked). Website routes are tried on LIVE (default:
// the live site) without signing in, and as the attacker; the victim's game runs on the local server.
//   [LIVE=https://…] node scripts/tests/security-attack-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const LIVE = process.env.LIVE ?? "https://loota-plum.vercel.app";
const LOCAL = "http://localhost:3000"; // (the newest fixes, before they're pushed)
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const ids = [];
const hunts = [];
let browser;
const holes = [];
const result = (label, safe, extra = "") => {
  if (!safe) holes.push(label);
  console.log(`${safe ? "SAFE" : "HOLE"}  ${label}${extra ? `  (${extra})` : ""}`);
};
const user = async (tag) => {
  const email = `sec-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};
const short = (x) => JSON.stringify(x)?.slice(0, 140);
const HOME = { lng: 3.3787, lat: 6.5186 };
const AREA = `${Math.floor(HOME.lng / 0.02)}_${Math.floor(HOME.lat / 0.02)}`;

try {
  const victim = await user("victim");
  await admin.from("profiles").update({ username: `Victim${Date.now() % 10000}`, home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString(), coins: 100 }).eq("id", victim.id);
  await admin.from("player_positions").upsert({ user_id: victim.id, lng: HOME.lng, lat: HOME.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  const attacker = await user("attacker");
  await admin.from("profiles").update({ username: `Attacker${Date.now() % 10000}`, home_lng: HOME.lng, home_lat: HOME.lat, home_set_at: new Date().toISOString(), coins: 100 }).eq("id", attacker.id);
  await admin.from("player_positions").upsert({ user_id: attacker.id, lng: HOME.lng, lat: HOME.lat, mode: "walk", energy: 100, updated_at: ago(20) });
  // A hidden (unpublished) hunt, its key's answer, and a victim's broadcast scene
  const { data: secret } = await admin.from("hunts").insert({ title: "Security test: hidden hunt (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: false, all_day: true }).select("id").single();
  hunts.push(secret.id);
  await admin.from("hunt_keys").insert({ hunt_id: secret.id, n: 1, riddle: "SECRET RIDDLE", category: "general", trial_kind: "sentries", area_lng: 3.31, area_lat: 6.61, area_radius_m: 500, spot_lng: 3.3123, spot_lat: 6.6123 });
  const { data: scene } = await admin.from("hunter_scenes").insert({ user_id: victim.id, started_ms: Date.now(), data: { title: "victim's" }, lines: [] }).select("id").single();

  // ---------------------------------------------------------------- 1. Signed out (only the public app key)
  console.log("\n— Signed out —");
  const anon = createClient(url, PUBLIC_KEY, { auth: { persistSession: false } });
  for (const t of ["profiles", "player_positions", "coin_transactions", "coin_purchases", "hunt_keys", "hunt_players", "trial_questions", "trial_attempts", "house_room_puzzles", "hunts", "player_items", "hunter_scenes", "hunter_motion", "hospital_visits", "player_sessions"]) {
    const { data, error } = await anon.from(t).select("*").limit(3);
    result(`read ${t}`, !!error || !data?.length, error ? error.message.slice(0, 60) : `${data?.length ?? 0} rows`);
  }
  {
    const { error } = await anon.from("profiles").update({ coins: 999999 }).eq("id", victim.id);
    const { data: v } = await admin.from("profiles").select("coins").eq("id", victim.id).single();
    result("give a player coins (update profiles)", v.coins === 100, error?.message.slice(0, 60));
  }
  for (const [fn, args] of [["broadcast_state", { p_hunt: secret.id }], ["save_position", { p_lng: 3.3, p_lat: 6.5, p_mode: "walk" }], ["apply_coin_change", { p_user: victim.id, p_amount: 5000, p_kind: "admin", p_reason: "x", p_ref: null }], ["join_hunt", { p_hunt: secret.id }]]) {
    const { data, error } = await anon.rpc(fn, args);
    result(`call ${fn}`, !!error || data?.ok === false, error ? error.message.slice(0, 70) : short(data));
  }
  {
    const { data } = await anon.rpc("racing_now", { p_user: victim.id });
    result("racing_now (is a given player in a live hunt): only a yes/no, and only with their private id", true, `answered ${data}`);
  }
  // The website's routes, not signed in
  const routes = [
    ["POST", "/api/trial/puzzle", { hunt: secret.id }], ["POST", "/api/trial/solve", { attempt: "x", answer: [] }], ["POST", "/api/house/room", { hunt: secret.id, room: 1 }],
    ["POST", "/api/house/room/solve", { hunt: secret.id, room: 1, answer: [] }], ["POST", "/api/world/fill", { lng: 3.3, lat: 6.5 }], ["POST", "/api/world/nearby", { lng: 3.3, lat: 6.5 }],
    ["GET", "/api/geocode?q=lagos", null], ["POST", "/api/coins/checkout", { pack: "small" }], ["POST", "/api/coins/verify", { reference: "loota_00000000-0000-0000-0000-000000000000" }],
    ["GET", `/api/admin/story-step?hunt=${secret.id}`, null], ["GET", "/api/admin/map-check?q=lagos", null], ["GET", `/api/hunt/story?hunt=${secret.id}`, null], ["GET", "/api/radio", null],
    ["GET", "/api/world/country?lng=3.3&lat=6.5", null],
  ];
  const hit = async (method, path, body, cookie) => {
    const r = await fetch(LIVE + path, { method, redirect: "manual", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, text: (await r.text()).slice(0, 80) };
  };
  for (const [m, p, b] of routes) {
    const r = await hit(m, p, b);
    result(`${m} ${p.split("?")[0]} signed out`, r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400), `${r.status} ${r.text}`);
  }
  for (const p of ["/admin", "/broadcast"]) {
    const r = await hit("GET", p);
    result(`open ${p} signed out`, r.status >= 300 && r.status < 400, `${r.status}`);
  }
  {
    const r = await hit("POST", "/api/paystack/webhook", { event: "charge.success", data: { reference: "loota_x", amount: 1, currency: "NGN" } });
    result("fake a Paystack payment (unsigned webhook)", r.status === 401, `${r.status}`);
  }

  // ---------------------------------------------------------------- 2. Signed in as an ordinary player
  console.log("\n— Signed in as an ordinary player —");
  const me = createClient(url, PUBLIC_KEY, { auth: { persistSession: false } });
  await me.auth.signInWithPassword({ email: attacker.email, password: attacker.password });
  {
    const { data } = await me.from("profiles").select("*").eq("id", victim.id);
    result("read another player's profile", !data?.length, `${data?.length ?? 0} rows`);
    const { data: pos } = await me.from("player_positions").select("*").eq("user_id", victim.id);
    result("read another player's position", !pos?.length, `${pos?.length ?? 0} rows`);
  }
  for (const [what, patch] of [["coins", { coins: 999999 }], ["admin", { is_admin: true }], ["detector", { detector: true }], ["home", { home_lng: 0, home_lat: 0 }]]) {
    const { error } = await me.from("profiles").update(patch).eq("id", attacker.id);
    const { data: a } = await admin.from("profiles").select("coins, is_admin, detector, home_lng").eq("id", attacker.id).single();
    result(`give myself ${what} (update my profile)`, a.coins === 100 && !a.is_admin && !a.detector && a.home_lng === HOME.lng, error?.message.slice(0, 60));
  }
  {
    const evil = `<img src=x onerror=alert(1)>`;
    const { error } = await me.from("profiles").update({ username: evil }).eq("id", attacker.id);
    const { data: a } = await admin.from("profiles").select("username").eq("id", attacker.id).single();
    result("a username with HTML/script in it (shown to others)", a.username !== evil, error ? error.message.slice(0, 70) : `stored: ${a.username}`);
    for (const fake of ["Loota", "LOOTA_Team", "Admin", "Admin_Joe", "Support", "Official_Loota", "Moderator1"]) {
      await me.from("profiles").update({ username: fake }).eq("id", attacker.id);
      const { data: a2 } = await admin.from("profiles").select("username").eq("id", attacker.id).single();
      result(`call myself "${fake}" (to pass as the game)`, a2.username !== fake, `name is ${a2.username}`);
    }
    const { data: free } = await me.rpc("username_available", { name: "Loota" });
    result("…and the sign-up name check says it isn't free", free === false, String(free));
    const plain = `Joe_${Date.now() % 100000}`;
    await me.from("profiles").update({ username: plain }).eq("id", attacker.id);
    const { data: a3 } = await admin.from("profiles").select("username").eq("id", attacker.id).single();
    console.log(`  (check) an ordinary name still works: ${a3.username === plain}`);
    if (a3.username !== plain) holes.push("ordinary names refused");
  }
  {
    const big = { skin: "x".repeat(500_000) };
    const { error } = await me.from("profiles").update({ avatar: big }).eq("id", attacker.id);
    const { data: a } = await admin.from("profiles").select("avatar").eq("id", attacker.id).single();
    const size = JSON.stringify(a.avatar ?? {}).length;
    result("a huge avatar (half a megabyte, shown to everyone near)", size < 10_000, error ? error.message.slice(0, 70) : `stored ${size} bytes`);
    await admin.from("profiles").update({ avatar: null }).eq("id", attacker.id);
  }
  for (const [t, row] of [["player_items", { user_id: attacker.id, item: "jerry_can", qty: 99 }], ["coin_transactions", { user_id: attacker.id, amount: 5000, kind: "earn", reason: "x" }], ["player_relics", { user_id: attacker.id, relic: "rain_charm", charges: 9 }], ["hunt_players", { hunt_id: secret.id, user_id: attacker.id }], ["player_vehicles", { user_id: attacker.id, kind: "car", lng: 3.3, lat: 6.5 }]]) {
    const { error } = await me.from(t).insert(row);
    result(`insert into ${t}`, !!error, error?.message.slice(0, 60));
  }
  for (const [fn, args, ok] of [
    ["apply_coin_change", { p_user: attacker.id, p_amount: 5000, p_kind: "admin", p_reason: "x", p_ref: null }],
    ["credit_coin_purchase", { p_reference: "loota_x", p_amount_kobo: 1 }],
    ["clan_give_coins", { p_to: victim.id, p_amount: -500 }],
    ["clan_give_coins", { p_to: attacker.id, p_amount: 500 }],
    ["broadcast_state", { p_hunt: secret.id }],
    ["broadcast_motion", { p_hunt: secret.id }],
    ["broadcast_way", { p_hunt: secret.id, p_user: victim.id }],
    ["scene_update", { p_id: scene.id, p_lines: [[Date.now(), "them", "HACKED"]], p_meta: null, p_end: null }],
    ["scene_track", { p_id: scene.id, p_track: [[Date.now(), 1, 1, 0, 0]] }],
    ["use_relic", { p_relic: "00000000-0000-0000-0000-000000000000" }],
    ["join_hunt", { p_hunt: secret.id }],
    ["hunt_state", { p_hunt: secret.id }],
    ["house_view", { p_hunt: secret.id }],
    ["riddle_state", { p_hunt: secret.id }],
  ]) {
    const { data, error } = await me.rpc(fn, args);
    const leaked = /3\.3123|6\.6123|SECRET RIDDLE/.test(JSON.stringify(data ?? ""));
    result(`call ${fn}${fn === "clan_give_coins" ? (args.p_amount < 0 ? " (negative, to steal)" : " (to myself)") : ""}`, !leaked && (!!error || data?.ok === false || data === null || (typeof data === "object" && !Object.keys(data).length)), error ? error.message.slice(0, 70) : short(data));
  }
  {
    const { data: sc } = await admin.from("hunter_scenes").select("lines, track").eq("id", scene.id).single();
    result("…the victim's broadcast scene untouched", !JSON.stringify(sc).includes("HACKED") && !sc.track?.length);
    const { data: a } = await admin.from("profiles").select("coins").eq("id", attacker.id).single();
    const { data: v } = await admin.from("profiles").select("coins").eq("id", victim.id).single();
    result("…coins unchanged (attacker 100, victim 100)", a.coins === 100 && v.coins === 100, `attacker ${a.coins}, victim ${v.coins}`);
  }
  {
    await me.rpc("save_position", { p_lng: HOME.lng, p_lat: HOME.lat, p_mode: "walk" });
    const { data } = await me.rpc("save_position", { p_lng: HOME.lng + 1, p_lat: HOME.lat, p_mode: "walk" });
    result("teleport 110 km in one step", data?.ok === false && data?.reason === "speed", short(data));
    const { data: d2 } = await me.rpc("save_position", { p_lng: HOME.lng, p_lat: HOME.lat, p_mode: "car" });
    result("drive a car I don't have", d2?.ok === false, short(d2));
  }
  // The website as the attacker
  const jar = new Map();
  const c = createServerClient(url, PUBLIC_KEY, { cookies: { getAll: () => [...jar].map(([n, value]) => ({ name: n, value })), setAll: (l) => l.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: attacker.email, password: attacker.password });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  for (const [m, p, b] of [["GET", `/api/admin/story-step?hunt=${secret.id}`, null], ["POST", "/api/admin/story-step", { hunt: secret.id }], ["GET", `/api/hunt/story?hunt=${secret.id}`, null], ["POST", "/api/house/room", { hunt: secret.id, room: 1 }], ["POST", "/api/trial/puzzle", { hunt: secret.id }]]) {
    const r = await hit(m, p, b, cookie);
    const leaked = /3\.3123|6\.6123|SECRET RIDDLE/.test(r.text);
    result(`${m} ${p.split("?")[0]} as a player`, !leaked && (r.status >= 400 || /"ok":false/.test(r.text)), `${r.status} ${r.text}`);
  }
  {
    // Hammering what costs the server: the area filling (15 a minute), what's around (60)
    let fills = 0;
    for (let i = 0; i < 20; i++) if ((await me.rpc("take_quota", { p_kind: "fill" })).data) fills++;
    result("hammer the area filling (20 at once)", fills === 15, `${fills} let through`);
    for (let i = 0; i < 61; i++) await me.rpc("take_quota", { p_kind: "nearby" });
    const r = await fetch(LOCAL + "/api/world/nearby", { method: "POST", headers: { cookie } });
    result("…what's around, past its limit: the route says wait", r.status === 429, `${r.status} ${(await r.text()).slice(0, 60)}`);
    let near = 0;
    for (let i = 0; i < 35; i++) if ((await me.rpc("hunters_near")).data?.ok) near++;
    result("hammer who's near (35 at once)", near === 30, `${near} answered`);
    await admin.from("api_quota").delete().eq("user_id", attacker.id); // (fresh for the rest)
  }
  {
    const r = await fetch(LIVE + "/admin", { redirect: "manual", headers: { cookie } });
    const body = await r.text();
    const sentAway = (r.status >= 300 && r.status < 400) || /NEXT_REDIRECT[^"]*\/lobby/.test(body);
    // (the page's header, "Owner tools" and a link, comes before the redirect; no hunt, riddle or form of it)
    const shown = /Publish|New hunt|story-step|deleteHunt|name="riddle"|spot_lng/i.test(body.replace(/NEXT_REDIRECT[\s\S]*/, ""));
    result("open /admin as a player", sentAway && !shown, `${r.status}, sent to the lobby: ${sentAway}, admin content in the page: ${shown}`);
  }

  // ---------------------------------------------------------------- 3. Realtime (the live channels)
  console.log("\n— Realtime —");
  // The victim plays (local server)
  const vjar = new Map();
  const vc = createServerClient(url, PUBLIC_KEY, { cookies: { getAll: () => [...vjar].map(([n, value]) => ({ name: n, value })), setAll: (l) => l.forEach(({ name: n, value }) => (value ? vjar.set(n, value) : vjar.delete(n))) } });
  await vc.auth.signInWithPassword({ email: victim.email, password: victim.password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...[...vjar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((id) => { try { localStorage.setItem(`loota:welcome:${id}`, "1"); } catch {} }, victim.id);
  await page.goto("http://localhost:3000/play", { waitUntil: "networkidle2", timeout: 120000 }).catch(() => {});
  await wait(15000);
  console.log(`  (the victim is on ${page.url().replace(/^https?:\/\/[^/]+/, "")})`);
  const locked = async () => { for (let k = 0; k < 5; k++) { try { return await page.evaluate(() => !!document.querySelector('[aria-label="Open on more than one device"]')); } catch { await wait(1000); } } return false; };
  console.log(`  (the victim's game is running: ${!(await locked())})`);

  // Realtime clients: signed out, the attacker signed in, and the victim's own second device (signed in as them)
  const client = async (who) => {
    const c = createClient(url, PUBLIC_KEY, { auth: { persistSession: false } });
    if (who) {
      await c.auth.signInWithPassword({ email: who.email, password: who.password });
      await c.realtime.setAuth();
    }
    return c;
  };
  /** Joined within 8 s, or refused/timed out. */
  const join = (ch) => new Promise((r) => { const t = setTimeout(() => r("TIMED_OUT"), 8000); ch.subscribe((st) => { if (st !== "CLOSED") { clearTimeout(t); r(st); } }); });
  const outsider = await client(null);
  const player = await client(attacker);

  // a) Listening in on the hunters near: signed out (an open join and a private one), and as a signed-in player
  for (const [label, c, priv] of [["signed out, open channel", outsider, false], ["signed out, private channel", outsider, true], ["signed in as another player (by design: they see hunters near them)", player, true]]) {
    const heard = [];
    const ch = c.channel(`hunters:${AREA}`, { config: { private: priv, broadcast: { self: false } } });
    ch.on("broadcast", { event: "pos" }, ({ payload }) => heard.push(payload));
    const st = await join(ch);
    if (label.startsWith("signed in")) {
      // A real player near: says they're here (the victim's game answers a newcomer at once), then listens
      await ch.send({ type: "broadcast", event: "pos", payload: { id: attacker.id, name: "Nearby", look: {}, lng: HOME.lng + 0.0002, lat: HOME.lat, heading: 0, mode: "walk", moving: false } });
    }
    for (let i = 0; i < 24 && !heard.some((p) => p.id === victim.id); i++) await wait(500);
    const victimSeen = heard.find((p) => p.id === victim.id);
    if (label.startsWith("signed in")) {
      console.log(`  (check) ${label}: joined ${st}, heard the victim: ${!!victimSeen}`);
      if (!victimSeen) holes.push("hunters near each other no longer see each other");
    }
    else result(`listen in on hunters' positions and ids, ${label}`, !victimSeen, `join: ${st}; heard ${heard.length}${victimSeen ? `, the victim at ${victimSeen.lng.toFixed(4)},${victimSeen.lat.toFixed(4)}` : ""}`);
    if (label.startsWith("signed in")) {
      // Made up by a signed-in player: a hunter who doesn't exist, a Mirror copy without a Mirror, a real hunter (the
      // attacker) under a false name, and the attacker somewhere they aren't
      for (let i = 0; i < 4; i++) {
        await ch.send({ type: "broadcast", event: "pos", payload: { id: "11111111-2222-3333-4444-555555555555", name: "Ghost", look: {}, lng: HOME.lng + 0.0002, lat: HOME.lat, heading: 0, mode: "walk", moving: false } });
        await ch.send({ type: "broadcast", event: "pos", payload: { id: `${attacker.id}:m1`, name: "Copy", look: {}, lng: HOME.lng + 0.0004, lat: HOME.lat, heading: 0, mode: "walk", moving: false } });
        await ch.send({ type: "broadcast", event: "pos", payload: { id: attacker.id, name: "Loota Official", look: {}, lng: HOME.lng + 0.0002, lat: HOME.lat, heading: 0, mode: "walk", moving: false } });
        await wait(1500);
      }
      const drawn = await page.evaluate(() => window.__lootaOthers?.() ?? null).catch(() => null);
      result("put a made-up hunter on others' maps (signed in)", Array.isArray(drawn) && !drawn.includes("11111111-2222-3333-4444-555555555555") && !drawn.includes(`${attacker.id}:m1`), JSON.stringify(drawn));
      console.log(`  (check) a real hunter near is still drawn: ${!!drawn?.includes(attacker.id)}`);
      if (!drawn?.includes(attacker.id)) holes.push("real hunters near no longer drawn");
      // …while a real Mirror of Many's copies still show (the server says their Mirror is on)
      const { data: mirror } = await admin.from("wonder_events").insert({ user_id: attacker.id, wonder: "mirror_of_many", message: "test", ends_at: new Date(Date.now() + 300e3).toISOString() }).select("id").single();
      let copies = [];
      for (let i = 0; i < 12 && !copies.length; i++) {
        await ch.send({ type: "broadcast", event: "pos", payload: { id: `${attacker.id}:m1`, name: "x", look: {}, lng: HOME.lng + 0.002, lat: HOME.lat, heading: 0, mode: "walk", moving: false } });
        await wait(1000);
        copies = ((await page.evaluate(() => window.__lootaOthers?.() ?? []).catch(() => [])) ?? []).filter((id) => id.endsWith(":m1"));
      }
      console.log(`  (check) a real Mirror's copies still show: ${copies.length > 0}`);
      if (!copies.length) holes.push("the Mirror's copies no longer show");
      if (mirror) await admin.from("wonder_events").delete().eq("id", mirror.id);
      await ch.send({ type: "broadcast", event: "pos", payload: { id: attacker.id, name: "x", look: {}, lng: HOME.lng + 0.05, lat: HOME.lat + 0.05, heading: 0, mode: "walk", moving: true } });
    }
    // b) A fake hunter, malformed, onto the victim's map, the same way
    for (let i = 0; i < 2; i++) {
      await ch.send({ type: "broadcast", event: "pos", payload: { id: "fake-hunter", name: "<b>FAKE</b>".repeat(20), look: { skin: 42, hair: null, top: { evil: true } }, lng: HOME.lng + 0.0003, lat: HOME.lat, heading: "x", mode: "spaceship", moving: true } });
      await ch.send({ type: "broadcast", event: "pos", payload: { id: "fake-2", name: null, look: null, lng: "a", lat: {}, heading: null } });
      await wait(500);
    }
    await c.removeChannel(ch);
  }
  await wait(1500);
  const stillRuns = await page.evaluate(() => typeof window.__lootaPos === "function" && !!window.__lootaPos()).catch(() => false);
  result("crash the victim's game with a broken fake hunter", stillRuns && problems.length === 0, problems.length ? problems.slice(0, 2).join(" / ").slice(0, 120) : "game still running");

  // c) Freezing the victim: a "second device" on their device channel
  const freeze = async (label, c, priv) => {
    const ch = c.channel(`device:${victim.id}`, { config: { private: priv, presence: { key: `intruder-${Math.random()}` } } });
    const st = await join(ch);
    if (st === "SUBSCRIBED") await ch.track({ kind: "phone", at: new Date().toISOString() });
    let froze = false;
    for (let i = 0; i < 16 && !froze; i++) { await wait(500); froze = await locked(); }
    await ch.untrack().catch(() => {});
    await c.removeChannel(ch);
    for (let i = 0; i < 16 && (await locked()); i++) await wait(500); // (back to playing before the next try)
    return { st, froze };
  };
  for (const [label, c, priv] of [["signed out, open channel", outsider, false], ["signed out, private channel", outsider, true], ["signed in as another player, open channel", player, false], ["signed in as another player, private channel", player, true]]) {
    const { st, froze } = await freeze(label, c, priv);
    result(`freeze a player out of the game (a fake second device), ${label}`, !froze, `join: ${st}${froze ? "; the victim's game paused" : ""}`);
  }
  // …while the player's own second device still pauses it (the one-device rule still works)
  const own = await client(victim);
  const { st: ownSt, froze: ownFroze } = await freeze("own", own, true);
  console.log(`  (check) the victim's own second device: joined ${ownSt}, the game paused as it should: ${ownFroze}`);
  if (!ownFroze) holes.push("the one-device rule no longer works");

  // e) Sign-up (no account is made: each is stopped before it)
  const signup = async (username, password) => {
    const p = await (await browser.createBrowserContext()).newPage(); // (signed out: a window of its own)
    await p.goto(LOCAL + "/signup", { waitUntil: "networkidle2", timeout: 120000 }).catch(() => {});
    await p.type('input[name="username"]', username);
    await p.type('input[name="email"]', `sec-signup-${Date.now()}@example.com`);
    await p.type('input[name="password"]', password);
    await p.click('button[type="submit"]');
    let said = "";
    for (let i = 0; i < 30 && !said; i++) {
      await wait(500);
      said = await p.evaluate(() => document.querySelector('[role="alert"], .text-danger, [data-error]')?.textContent?.trim() ?? "").catch(() => "");
    }
    await p.close();
    return said;
  };
  const weak = await signup(`Sec${Date.now() % 100000}`, "password123");
  result("sign up with a password from data breaches (password123)", /breach/i.test(weak), weak);
  const strong = await signup("Loota", `Zq${Math.random().toString(36).slice(2)}!Kp${Date.now()}`);
  result("sign up as \"Loota\" (a strong password: past the breach check, refused for the name)", /isn't available/i.test(strong), strong);

  // d) A rival's Key Trial progress or position at a key's place: only players in that hunt may join
  for (const topic of [`trial:${secret.id}:1`, `keyworld:${secret.id}:1`]) {
    const ch = player.channel(topic, { config: { private: true, broadcast: { self: false } } });
    const st = await join(ch);
    result(`join ${topic.split(":")[0]} for a hunt I'm not in`, st !== "SUBSCRIBED", `join: ${st}`);
    await player.removeChannel(ch);
  }
} catch (e) {
  holes.push("ERROR");
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const h of hunts) {
    await admin.from("hunt_players").delete().eq("hunt_id", h);
    await admin.from("hunt_keys").delete().eq("hunt_id", h);
    await admin.from("hunts").delete().eq("id", h);
  }
  for (const id of ids) {
    await admin.from("hunter_scenes").delete().eq("user_id", id);
    await admin.from("hunter_motion").delete().eq("user_id", id);
    await admin.from("player_sessions").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`\ntest accounts and hunt deleted; ${holes.length ? `${holes.length} HOLES: ${holes.join("; ")}` : "no holes found"}`);
  process.exit(0);
}

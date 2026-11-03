// The broadcast screen (design doc 11), on a laptop-size screen as the owner: a live test hunt with two hunters (one in
// a Key Trial): the title card, the leaderboard (with TRIAL), a dot and name for each hunter on the map, the ticker;
// clicking a name follows them (the 3D avatar up close). Then, with the screen open, the newer moments reach the
// ticker (owner, 2 Nov 2026): a story trap sprung with its penalty (one line), the chest dug up in the key's quarter, a
// faint (the ambulance) and a Lamp prize. The hunt, its log, the hunters and the owner account are deleted.
//   SHOTS=<folder> node scripts/tests/broadcast-browser-test.mjs
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
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const NL = String.fromCharCode(10);
const ids = [];
let huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const user = async (tag) => {
  const email = `bcast-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};

try {
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const a = await user("ada"), b = await user("bayo");
  const names = { [a.id]: `Ada${Date.now() % 1000}`, [b.id]: `Bayo${Date.now() % 1000}` };
  for (const [id, name] of Object.entries(names)) await admin.from("profiles").update({ username: name }).eq("id", id);
  await admin.from("player_positions").upsert([
    { user_id: a.id, lng: 3.3787, lat: 6.5186, mode: "walk", energy: 80, updated_at: ago(5) },
    { user_id: b.id, lng: 3.3950, lat: 6.5020, mode: "walk", energy: 80, updated_at: ago(5) },
  ]);
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast test (automated)", prize: "₦50,000", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  const house = { title: "The test quarter", style: "lagos", layout: "court", items: {}, rooms: [{ id: "well", name: "The old well", kind: "cellar", role: "right" }, { id: "stall", name: "The stall", kind: "kitchen", role: "safe" }] };
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "Where?", category: "general", trial_kind: "sentries", area_lng: 3.38, area_lat: 6.52, area_radius_m: 1500, spot_lng: 3.38, spot_lat: 6.52, exact_m: 120, house });
  const { data: decoy } = await admin.from("hunt_decoys").insert({ hunt_id: huntId, key_n: 1, place: "the wrong lighthouse", lng: 3.39, lat: 6.51, radius_m: 100 }).select("id").single();
  const { data: pen } = await admin.from("penalties").select("code, title").eq("active", true).limit(1).single();
  await admin.from("hunt_players").insert([{ hunt_id: huntId, user_id: a.id, joined_at: ago(600) }, { hunt_id: huntId, user_id: b.id, joined_at: ago(500) }]);
  await admin.from("trial_attempts").insert({ hunt_id: huntId, user_id: b.id, key_n: 1, status: "active", started_at: ago(20), kind: "sentries", questions: [] }).then(({ error: e }) => e && console.log("(trial row:", e.message, ")"));

  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: owner.email, password: owner.password });
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setViewport({ width: 1600, height: 900 });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.goto(`http://localhost:3000/broadcast?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const body = () => page.evaluate((nl) => document.body.innerText.split(nl).join(" | "), NL);
  let text = "";
  for (let t = 0; t < 60 && !/Leaderboard/.test(text); t++) { await wait(500); text = await body(); }
  await wait(6000); // the map settles round everyone
  text = await body();
  check("the title card: LIVE, the hunt, the prize", /LIVE/.test(text) && /Broadcast test \(automated\)/.test(text) && /₦50,000/.test(text), text.slice(0, 160));
  check("the leaderboard: both hunters, one in a TRIAL", text.includes(names[a.id]) && text.includes(names[b.id]) && /TRIAL/.test(text));
  const dots = await page.$$eval(".loota-hunter-marker", (els) => els.length);
  check("a dot and name for each hunter on the map", dots === 2, `${dots} on the map`);
  check("the ticker: who joined, who started a trial", /joined the hunt/.test(text) && /started the Key Trial/.test(text));
  await page.screenshot({ path: `${OUT}/broadcast-1-field.png` });
  await page.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), names[a.id]);
  await wait(5000);
  check("clicking a name follows them", (await body()).includes(`Following ${names[a.id]}`));
  await page.screenshot({ path: `${OUT}/broadcast-2-follow.png` });

  // The newer moments, as they happen (the game's own records changed as its functions do)
  await admin.from("hunt_players").update({ decoys_sprung: [decoy.id] }).eq("hunt_id", huntId).eq("user_id", b.id);
  await admin.from("hunt_players").update({ last_penalty: pen.code, penalties_taken: 1 }).eq("hunt_id", huntId).eq("user_id", b.id);
  await admin.from("hunt_players").update({ house_key: 1, house_dug: "well" }).eq("hunt_id", huntId).eq("user_id", a.id);
  await admin.from("hospital_visits").upsert({ user_id: a.id, hospital: "Test General Hospital", lng: 3.38, lat: 6.52, bill: 50, approach: null,
    route: [[3.381, 6.52], [3.38, 6.52]], called_at: ago(1), picked_at: new Date(Date.now() + 60e3).toISOString(), arrives_at: new Date(Date.now() + 120e3).toISOString(), discharged_at: new Date(Date.now() + 180e3).toISOString(), left_at: null });
  const { data: lamp, error: lampErr } = await admin.from("detours").insert({ kind: "flash", area: "test", title: "Test lamp", story: "x", place_name: "Tejuosho Market", lng: 3.37, lat: 6.51, reward_coins: 10, ends_at: new Date(Date.now() + 600e3).toISOString() }).select("id").single();
  if (lampErr) console.log("(lamp:", lampErr.message, ")");
  else await admin.from("detour_claims").insert({ detour_id: lamp.id, user_id: b.id, question: {}, deadline: new Date().toISOString(), outcome: "won", asked_at: ago(2), answered_at: ago(1) });
  const seenText = new Set();
  for (let t = 0; t < 30; t++) {
    await wait(500);
    for (const line of (await body()).split(" | ")) seenText.add(line);
  }
  const all = [...seenText].join(" / ");
  await page.screenshot({ path: `${OUT}/broadcast-3-moments.png` });
  check("a story trap sprung, with its penalty, in one line", all.includes(`${names[b.id]} fell for a story trap at the wrong lighthouse: ${pen.title}!`), all.slice(0, 400));
  check("the chest dug up in the key's quarter", all.includes(`${names[a.id]} dug up the chest at Key 1!`));
  check("a faint: rushed to hospital", all.includes(`${names[a.id]} fainted from exhaustion and was rushed to Test General Hospital by ambulance`));
  check("a Lamp prize", all.includes(`${names[b.id]} won the Lamp's prize at Tejuosho Market!`));
  if (lamp) await admin.from("detours").delete().eq("id", lamp.id);

  // ---- Smooth movement (owner, 3 Nov 2026: "the movement on there leaps like a frog"): a hunter riding east, their
  // position heard once a second like the game sends it (about 50 m apart at the game's speed), glides on the screen:
  // it moves in almost every tenth of a second, at an even pace, instead of leaping and waiting.
  const live = c.channel(`hunt:${huntId}`, { config: { broadcast: { self: false } } });
  await new Promise((resolve) => live.subscribe((status) => status === "SUBSCRIBED" && resolve()));
  let lng = 3.3950;
  const ride = setInterval(() => {
    lng += 50 / (111320 * Math.cos((6.502 * Math.PI) / 180));
    void live.send({ type: "broadcast", event: "pos", payload: { id: b.id, lng, lat: 6.502, mode: "bicycle" } });
  }, 1000);
  await wait(4000); // a few positions heard first
  const track = [];
  for (let i = 0; i < 50; i++) {
    const p = await page.evaluate((id) => { const all = window.__broadcastShown?.(); return all?.[id] ? { ...all[id], t: all.drawnAt } : null; }, b.id);
    if (p) track.push(p);
    await wait(100);
  }
  clearInterval(ride);
  await c.removeChannel(live);
  const steps = track.slice(1).map((p, i) => Math.hypot((p.lng - track[i].lng) * 111320 * Math.cos((6.502 * Math.PI) / 180), (p.lat - track[i].lat) * 110574));
  const speedsInOrder = track.slice(1).map((p, i) => (p.t > track[i].t ? steps[i] / ((p.t - track[i].t) / 1000) : null)).filter((v) => v !== null);
  if (process.env.SHOW_SPEEDS) console.log(speedsInOrder.map((v) => Math.round(v)).join(" "));
  const speeds = [...speedsInOrder].sort((x, y) => x - y);
  const moving = steps.filter((m) => m > 0.5).length / Math.max(1, steps.length);
  const median = speeds[Math.floor(speeds.length / 2)] ?? 0;
  const fastest = speeds[speeds.length - 1] ?? 0;
  check("a riding hunter glides: moving in almost every tenth of a second", steps.length > 30 && moving >= 0.85, `${Math.round(moving * 100)}% of ${steps.length} samples`);
  check("…at an even pace, no leaps", median > 20 && fastest <= median * 2, `median ${median.toFixed(0)} m/s, fastest ${fastest.toFixed(0)} m/s (sent: 50 m/s)`);

  // ---- On a plane (owner, 3 Nov 2026: "The broadcast is not following the users. Fenzy is on a plane to tokyo now.
  // Also, we should have a direction drawn for planes"): a hunter flying Lagos to London, a minute into a 5-minute
  // flight, is drawn along the route (not at the airport), as ✈️ with where they're going; the route is drawn; the
  // ticker says they took off; following them pulls the camera out over the route.
  const from = [3.3211, 6.5791], to = [-0.4543, 51.47];
  const path = Array.from({ length: 21 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / 20, from[1] + ((to[1] - from[1]) * i) / 20]);
  const { error: tripErr } = await admin.from("transit_trips").insert({ user_id: a.id, mode: "plane", from_name: "Murtala Mohammed International Airport", to_name: "London Heathrow Airport",
    to_lng: to[0], to_lat: to[1], path, path_m: 5000000, fare: 100, booked_at: ago(120), departs_at: ago(60), arrives_at: new Date(Date.now() + 240e3).toISOString() });
  if (tripErr) throw new Error(`trip: ${tripErr.message}`);
  let flying = null;
  for (let i = 0; i < 20 && !flying?.trips?.includes(a.id); i++) {
    await wait(500);
    flying = await page.evaluate(() => window.__broadcastShown?.() ?? null);
  }
  const plane = flying?.[a.id];
  check("on a plane: drawn along the route, not at the airport", !!plane && plane.lat > 10 && plane.lat < 25, plane ? `lat ${plane.lat.toFixed(2)} (a fifth of the way: about 15.5)` : "not shown");
  const tag = await page.evaluate(() => [...document.querySelectorAll(".loota-hunter-marker")].map((m) => m.innerText).find((x) => x.includes("✈️")) ?? "");
  check("…as ✈️, with where they're going", /✈️/.test(tag) && /→ London Heathrow Airport/.test(tag), tag.replace(/s+/g, " "));
  check("…the route drawn", flying?.trips?.includes(a.id), JSON.stringify(flying?.trips));
  let took = "";
  for (let i = 0; i < 12 && !/took off from/.test(took); i++) { await wait(500); took = await body(); }
  check("…the ticker: took off", took.includes(`✈️ ${names[a.id]} took off from Murtala Mohammed International Airport for London Heathrow Airport`));
  await page.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n))?.click(), names[a.id]);
  await wait(6000);
  const zoom = await page.evaluate(() => window.__broadcastShown?.().zoom ?? null);
  check("…following them: the camera pulls out over the route", zoom !== null && zoom < 6.5, `zoom ${zoom?.toFixed(1)}`);
  await page.screenshot({ path: `${OUT}/broadcast-5-plane.png` });

  // A phone-size screen: the map stays open
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await wait(9000);
  await page.screenshot({ path: `${OUT}/broadcast-4-phone.png` });
  const covered = await page.evaluate(() => {
    // How much of the screen the panels take (the map is the rest).
    let area = 0;
    for (const el of document.querySelectorAll(".absolute")) {
      if (el.querySelector("canvas") || el.closest(".maplibregl-map")) continue;
      const r = el.getBoundingClientRect();
      area += r.width * r.height;
    }
    return area / (window.innerWidth * window.innerHeight);
  });
  check("on a phone, the panels leave most of the map open", covered < 0.3, `${Math.round(covered * 100)}% covered`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_events").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) await admin.from("hospital_visits").delete().eq("user_id", id);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

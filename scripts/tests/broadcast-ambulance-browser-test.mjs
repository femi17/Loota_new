// The ambulance on the broadcast (owner, 9 Nov 2026: "on the broadcast fix the ambulance pickup, it is not showing, user
// had to walk to hospital"). A hunter in a live test hunt faints (their hospital visit as call_ambulance saves it: the
// ambulance's way to them from 1.2 km off, the way on to the hospital, its times); the owner's broadcast follows them:
//   1. lying where they fell, "fainted: an ambulance on the way", the ambulance driving up to them;
//   2. picked up: the ambulance itself, along the way to the hospital (never walking), "Rushing … to <hospital>",
//      though their saved spot jumps to the hospital meanwhile (as their game saves it from inside the ambulance);
//   3. at the hospital: unseen inside, the ambulance parked, "being treated at <hospital>";
//   4. discharged: the chip goes.
// The hunt and the accounts are deleted.   SHOTS=<folder> node scripts/tests/broadcast-ambulance-browser-test.mjs
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
const at = (s) => new Date(Date.now() + s * 1000).toISOString();
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110574);
const ids = [];
let huntId = null, browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const FELL = [3.3787, 6.5186];
// The ambulance comes up from the south; the hospital ~1 km north-east, round a corner
const APPROACH = [[3.3787, 6.5078], [3.3787, 6.5130], [3.3787, 6.5186]];
const ROUTE = [FELL, [3.3787, 6.5240], [3.3850, 6.5240], [3.3850, 6.5262]];
const HOSPITAL = ROUTE[ROUTE.length - 1];
const user = async (tag) => {
  const email = `bamb-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  return { id: data.user.id, email, password };
};

try {
  const owner = await user("owner");
  await admin.from("profiles").update({ is_admin: true }).eq("id", owner.id);
  const hunter = await user("hunter");
  const name = `Fainter${Date.now() % 1000}`;
  await admin.from("profiles").update({ username: name, home_lng: FELL[0], home_lat: FELL[1], home_set_at: new Date().toISOString() }).eq("id", hunter.id);
  await admin.from("player_positions").upsert({ user_id: hunter.id, lng: FELL[0], lat: FELL[1], mode: "walk", energy: 0, updated_at: ago(5) });
  const { data: hunt, error } = await admin.from("hunts").insert({ title: "Broadcast ambulance test (automated)", prize: "Nothing", winners: 1, starts_at: ago(3600), ends_at: at(3600), published: true, all_day: true }).select("id").single();
  if (error) throw error;
  huntId = hunt.id;
  await admin.from("hunt_keys").insert({ hunt_id: huntId, n: 1, riddle: "The test key, far away.", category: "maths", area_lng: 3.45, area_lat: 6.58, area_radius_m: 800, spot_lng: 3.45, spot_lat: 6.58 });
  await admin.from("hunt_players").insert({ hunt_id: huntId, user_id: hunter.id, joined_at: ago(60) });

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email: owner.email, password: owner.password });
  const show = await browser.newPage();
  await show.setViewport({ width: 1280, height: 720 });
  const problems = [];
  show.on("pageerror", (e) => problems.push(e.message));
  await show.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await show.goto(`http://localhost:3000/broadcast?hunt=${huntId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 300) { const v = await fn(); if (v) return v; await wait(300); } return null; };
  await until(() => show.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(n)); b?.click(); return !!b; }, name), 60000);
  await wait(4000);

  // They faint: the visit, as call_ambulance saves it (picked up in 14 s, at the hospital 16 s later, out 12 s after)
  await admin.from("hospital_visits").upsert({ user_id: hunter.id, hospital: "Test General Hospital", lng: HOSPITAL[0], lat: HOSPITAL[1], approach: APPROACH, route: ROUTE, bill: 50,
    called_at: at(0), picked_at: at(14), arrives_at: at(30), discharged_at: at(42), left_at: null });
  const state = () => show.evaluate((id) => { const all = window.__broadcastShown?.(); return { p: all?.[id] ? [all[id].lng, all[id].lat] : null, care: all?.care ?? null, van: all?.careVan ? [all.careVan.lng, all.careVan.lat] : null, kind: all?.followedKind ?? null, chip: document.querySelector('[aria-label="Fainted"]')?.innerText ?? null }; }, hunter.id);

  // 1. Lying where they fell; the ambulance driving up
  const down = await until(async () => { const s = await state(); return /fainted/.test(s.care ?? "") && s; }, 30000);
  check("on the broadcast: they've fainted, an ambulance on the way", /an ambulance on the way/.test(down?.chip ?? ""), down?.chip);
  check("…lying where they fell", !!down?.p && metres(down.p, FELL) < 5, down?.p && `${metres(down.p, FELL).toFixed(1)} m off`);
  const vans = [];
  for (let i = 0; i < 12; i++) { const s = await state(); if (s.van && /fainted/.test(s.care ?? "")) vans.push(metres(s.van, FELL)); await wait(500); }
  check("…the ambulance driving up to them (closer and closer)", vans.length >= 6 && vans[0] > vans.at(-1) + 200 && vans.every((d, i) => !i || d <= vans[i - 1] + 1), vans.map((d) => Math.round(d)).join(" "));
  await show.screenshot({ path: `${OUT}/broadcast-ambulance-1-coming.png` });

  // 2. In the ambulance to the hospital; meanwhile their saved spot jumps there
  const riding = await until(async () => { const s = await state(); return /Rushing/.test(s.care ?? "") && s; }, 20000);
  check("picked up: the ambulance itself, rushing them to the hospital", /Rushing .* to Test General Hospital/.test(riding?.chip ?? "") && /:ambulance$/.test(riding?.kind ?? ""), `${riding?.chip} · ${riding?.kind}`);
  await admin.from("player_positions").update({ lng: HOSPITAL[0], lat: HOSPITAL[1], updated_at: new Date().toISOString() }).eq("user_id", hunter.id);
  const left = [];
  let offWay = 0;
  for (let i = 0; i < 30; i++) {
    const s = await state();
    if (!/Rushing/.test(s.care ?? "")) break;
    left.push(metres(s.p, HOSPITAL));
    // On the way: the north leg (lng 3.3787) or the east leg (lat 6.5240) or the last one (lng 3.3850)
    const off = Math.min(Math.abs(s.p[0] - 3.3787) * 110600, Math.abs(s.p[1] - 6.5240) * 110574, Math.abs(s.p[0] - 3.3850) * 110600);
    offWay = Math.max(offWay, off);
    if (i === 6) await show.screenshot({ path: `${OUT}/broadcast-ambulance-2-riding.png` });
    await wait(500);
  }
  check("…along the way to the hospital, never back", left.length >= 8 && left.every((d, i) => !i || d <= left[i - 1] + 1) && left[0] - left.at(-1) > 300, left.map((d) => Math.round(d)).join(" "));
  check("…on the road the ambulance takes (not walked across)", offWay < 3, `${offWay.toFixed(1)} m off it at most`);

  // 3. At the hospital
  const ward = await until(async () => { const s = await state(); return /being treated/.test(s.care ?? "") && s; }, 20000);
  check("at the hospital: being treated there, the ambulance parked outside", /being treated at Test General Hospital/.test(ward?.chip ?? "") && !!ward?.van && metres(ward.van, HOSPITAL) < 5 && metres(ward.p, HOSPITAL) < 5, `${ward?.chip} · van ${ward?.van && metres(ward.van, HOSPITAL).toFixed(1)} m from it`);
  await show.screenshot({ path: `${OUT}/broadcast-ambulance-3-ward.png` });
  const label = await show.evaluate(() => [...document.querySelectorAll(".loota-hunter-marker .name")].map((e) => e.textContent).join(" | "));
  check("…their name on the map says so", /🏥 .* · Test General Hospital/.test(label), label);

  // 4. Out
  await admin.from("hospital_visits").update({ left_at: new Date().toISOString() }).eq("user_id", hunter.id);
  const out = await until(async () => { const s = await state(); return !s.care && !s.chip && !s.van && s; }, 30000);
  check("discharged: the chip and the ambulance go, they stand at the hospital", !!out && metres(out.p, HOSPITAL) < 30, out?.p && `${metres(out.p, HOSPITAL).toFixed(1)} m from it`);
  check("no page errors", problems.length === 0, problems.join(" / "));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  if (huntId) {
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    await admin.from("hunts").delete().eq("id", huntId);
  }
  for (const id of ids) {
    await admin.from("hospital_visits").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`hunt and test accounts deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

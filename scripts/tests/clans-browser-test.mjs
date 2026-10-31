// Clans in the browser (owner, 31 Oct 2026: "ask them if they want to clan up or solo… This will handle referral").
//   1. A, just set up (/clan?welcome=1), is asked "clan up or solo" and starts a clan: members, the invite link.
//   2. Signed out, the invite link leads to sign-up and keeps the code; B, signed in, opens it and joins from the card.
//   3. The chat: B writes, A sees it.   4. A gives B coins from the members list.
//   5. The lobby shows A's clan.   6. The map: A has the clan chat button; the sheet shows the chat.
//   7. C chooses to hunt solo and lands in the lobby.
// Everything made is deleted.   SHOTS=<folder> node scripts/tests/clans-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const BASE = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let fails = 0, browser;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const users = [];
const NAME = `Owls ${Date.now().toString(36)}`;

async function player(tag, lng) {
  const email = `clanb-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  users.push(data.user.id);
  await admin.from("profiles").update({ home_lng: lng, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 500 }).eq("id", data.user.id);
  await admin.from("player_positions").upsert({ user_id: data.user.id, lng, lat: 6.5186, mode: "walk", energy: 100, updated_at: ago(30) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 420, height: 860 });
  await page.setCookie(...[...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })));
  await page.evaluateOnNewDocument((uid) => { try { localStorage.setItem(`loota:welcome:${uid}`, "1"); } catch {} }, data.user.id);
  return { id: data.user.id, page };
}
const text = (page) => page.evaluate(() => document.body.innerText);
async function until(page, fn, arg, ms = 30000) {
  for (let t = 0; t < ms; t += 500) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await wait(500); }
  return false;
}
const click = (page, label) => page.evaluate((l) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim().startsWith(l)); b?.click(); return !!b; }, label);

try {
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const A = await player("a", 3.3787), B = await player("b", 3.3797), C = await player("c", 3.3807);

  // 1. Clan up or solo, then start one
  await A.page.goto(`${BASE}/clan?welcome=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  check("a new player is asked: clan up or solo", await until(A.page, () => document.body.innerText.includes("One last thing: clan up or solo?")));
  await A.page.type('input[aria-label="Clan name"]', NAME);
  await A.page.evaluate(() => document.querySelector('[role="radiogroup"][aria-label="Crest"] button:nth-child(4)').click());
  await A.page.evaluate(() => document.querySelector('form[aria-label="Start a clan"] button[type="submit"]').click());
  check("A starts the clan: its name, 1 of 5, A the leader", await until(A.page, (n) => document.querySelector("h1")?.textContent === n && document.body.innerText.includes("1 of 5 hunters · you're the leader"), NAME));
  const link = await A.page.$eval('input[aria-label="Your invite link"]', (e) => e.value);
  const code = link.split("/join/")[1];
  check("…with an invite link", /^[0-9A-F]{8}$/.test(code ?? ""), link);
  await A.page.screenshot({ path: `${OUT}/clan-a.png`, fullPage: true });

  // 2. The invite link
  const visitor = await (await browser.createBrowserContext()).newPage();
  await visitor.goto(`${BASE}/join/${code}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const kept = (await visitor.cookies()).find((c) => c.name === "loota_invite");
  check("signed out, the invite leads to sign-up and keeps the code", new URL(visitor.url()).pathname === "/signup" && kept?.value === code, visitor.url());
  await B.page.goto(`${BASE}/join/${code}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  check("signed in, it opens the clan page with the invite", await until(B.page, (n) => location.pathname === "/clan" && document.body.innerText.includes(`Join ${n}`), NAME));
  await click(B.page, `Join ${NAME}`);
  check("B joins: 2 of 5", await until(B.page, () => document.body.innerText.includes("2 of 5 hunters · you're a member")));
  const { data: ref } = await admin.from("clan_referrals").select("inviter").eq("invitee", B.id).maybeSingle();
  check("…and B counts as A's referral", ref?.inviter === A.id);

  // 3. The chat
  await B.page.type('section[aria-label="Clan chat"] input[aria-label="Message"]', "I think it's the rock");
  await B.page.evaluate(() => document.querySelector('section[aria-label="Clan chat"] button[type="submit"]').click());
  check("B's message shows for B", await until(B.page, () => document.querySelector('section[aria-label="Clan chat"] ol')?.innerText.includes("I think it's the rock")));
  await A.page.reload({ waitUntil: "domcontentloaded" });
  check("…and reaches A", await until(A.page, () => document.querySelector('section[aria-label="Clan chat"] ol')?.innerText.includes("I think it's the rock"), null, 20000));

  // 4. Gifts
  const b0 = (await admin.from("profiles").select("coins").eq("id", B.id).single()).data.coins;
  const opened = await A.page.evaluate(() => { const row = [...document.querySelectorAll("[data-member]")].find((r) => !r.innerText.includes("· you")); row?.querySelector("button")?.click(); return !!row; });
  await until(A.page, () => !!document.querySelector('input[aria-label="Coins to give"]'));
  await A.page.$eval('input[aria-label="Coins to give"]', (e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(e, "25"); e.dispatchEvent(new Event("input", { bubbles: true })); });
  await click(A.page, "Give coins");
  const gave = await until(A.page, () => /You gave .+ 25 coins\./.test(document.body.innerText));
  const b1 = (await admin.from("profiles").select("coins").eq("id", B.id).single()).data.coins;
  check("A gives B 25 coins", opened && gave && b1 === b0 + 25, `B ${b0} → ${b1}`);
  await A.page.screenshot({ path: `${OUT}/clan-a-gift.png`, fullPage: true });

  // 5. The lobby
  await A.page.goto(`${BASE}/lobby`, { waitUntil: "domcontentloaded", timeout: 120000 });
  check("the lobby shows A's clan", await until(A.page, (n) => !!document.querySelector(`a[aria-label="Your clan: ${n}"]`), NAME));

  // 6. The map
  await A.page.goto(`${BASE}/play`, { waitUntil: "domcontentloaded", timeout: 120000 });
  check("the map has the clan chat button", await until(A.page, () => !!document.querySelector('[data-tool="clan"]'), null, 60000));
  await A.page.evaluate(() => document.querySelector('[data-tool="clan"]').click());
  check("…which opens the chat", await until(A.page, () => document.querySelector('[role="dialog"][aria-label="Your clan"]')?.innerText.includes("I think it's the rock")));
  await A.page.screenshot({ path: `${OUT}/clan-map.png` });

  // 7. Solo
  await C.page.goto(`${BASE}/clan?welcome=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(C.page, () => document.body.innerText.includes("Hunt solo"));
  await click(C.page, "🧭 Hunt solo");
  const solo = await until(C.page, () => location.pathname === "/lobby");
  const { data: asked } = await admin.from("profiles").select("clan_asked_at").eq("id", C.id).single();
  check("C hunts solo: back to the lobby, the choice remembered", solo && !!asked.clan_asked_at);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  const { data: clans } = await admin.from("clans").select("id").eq("name", NAME);
  for (const c of clans ?? []) await admin.from("clans").delete().eq("id", c.id);
  for (const u of users) await admin.auth.admin.deleteUser(u);
  console.log(`test clan and players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

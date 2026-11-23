// Before the first ads (owner, 23 Nov 2026): rules/terms/privacy pages, hunts in a state, a country or worldwide, and
// the finish email with a prize code checked against the database. The dev server must be running.
//   1. The database: a state hunt needs its state; a country hunt its country.
//   2. The finish email: not before the last key (409); after it, a claim row (winner). Sending (Resend faked in this
//      process): the email holds LOOTA-XXXX-XXXX, only its hash is stored, a second call sends nothing, "again" makes a
//      new code and the old one stops matching.
//   3. The owner's Prizes page: a code typed any old way matches; Mark as paid; the old code says No match.
//   4. The owner's new-hunt form: a Lagos hunt on a free day, 4 pm to 5 pm: stored as a state hunt with those hours;
//      its card says "in Lagos, Nigeria" and the story request ends "in Lagos, Nigeria".
//   5. /rules, /terms and /privacy open to visitors; sign-up links to them.
// Test players and hunts are deleted.
//   SHOTS=<folder> node --no-warnings --import ./scripts/tests/ts-ext.mjs scripts/tests/prize-claims-browser-test.mts
import { createRequire } from "node:module";
import puppeteer, { type Browser } from "puppeteer-core";
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const soon = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};
const users: string[] = [];
const hunts: string[] = [];
let browser: Browser | undefined;

async function makeUser(tag: string, isAdmin = false) {
  const email = `${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  users.push(data.user.id);
  await admin.from("profiles").update({ is_admin: isAdmin, home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString() }).eq("id", data.user.id);
  const jar = new Map<string, string>();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list: { name: string; value: string }[]) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  await c.auth.signInWithPassword({ email, password });
  return { id: data.user.id as string, email, jar, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}

try {
  // ---- 1. The database's area rules
  const base = { title: "Area test (automated)", prize: "none", winners: 1, starts_at: soon(86400 * 40), ends_at: soon(86400 * 40 + 3600), published: false };
  const noState = await admin.from("hunts").insert({ ...base, region: "state", area_country: "NG" }).select("id");
  if (noState.data?.length) hunts.push(...noState.data.map((h: { id: string }) => h.id));
  check("a state hunt without its state is refused", !!noState.error);
  const noCountry = await admin.from("hunts").insert({ ...base, region: "country" }).select("id");
  if (noCountry.data?.length) hunts.push(...noCountry.data.map((h: { id: string }) => h.id));
  check("a country hunt without its country is refused", !!noCountry.error);
  const old = await admin.from("hunts").select("region, area_country").eq("region", "nigeria");
  check("no hunt left on the old 'nigeria' area", (old.data ?? []).length === 0);

  // ---- 2. The finish email
  const hunter = await makeUser("prize");
  const { data: hunt, error } = await admin
    .from("hunts")
    .insert({ title: "Prize test (automated)", prize: "₦10,000 cash", winners: 1, starts_at: ago(600), ends_at: soon(3600), published: true, all_day: true, region: "state", area_country: "NG", area_state: "Lagos" })
    .select("id")
    .single();
  if (error) throw error;
  hunts.push(hunt.id);
  await admin.from("hunt_keys").insert({ hunt_id: hunt.id, n: 1, riddle: "Test key.", category: "maths", area_lng: 3.5, area_lat: 6.6, area_radius_m: 800, spot_lng: 3.5, spot_lat: 6.6 });
  await admin.from("hunt_players").insert({ hunt_id: hunt.id, user_id: hunter.id });
  const finishEmail = () =>
    fetch("http://localhost:3000/api/hunt/finish-email", { method: "POST", headers: { cookie: hunter.cookie, "content-type": "application/json" }, body: JSON.stringify({ hunt: hunt.id }) });
  const before = await finishEmail();
  check("before the last key: not finished (409)", before.status === 409, String(before.status));
  const g = await admin.rpc("gain_key", { p_user: hunter.id, p_hunt: hunt.id });
  check("the last key: finished, 1st", g.data?.finished === true && g.data.place === 1, JSON.stringify(g.data ?? g.error));
  const after = (await (await finishEmail()).json()) as { status: string; winner?: boolean };
  check("after it: the game's server answers for a winner", after.winner === true && ["sent", "no-email-service", "failed", "sending"].includes(after.status), JSON.stringify(after));
  const { data: row } = await admin.from("prize_claims").select("place, winner, code_hash").eq("hunt_id", hunt.id).eq("user_id", hunter.id).single();
  check("…a claim row: place 1, a winner", row?.place === 1 && row.winner === true);

  // Sending, with Resend faked in this process
  const sent: { to: string[]; subject: string; text: string; html: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("https://api.resend.com/")) {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "test" }), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  process.env.RESEND_API_KEY = "test-not-real";
  const { sendFinishEmail, hashPrizeCode } = await import("../../src/lib/prize.ts");
  await admin.from("prize_claims").update({ emailed_at: null, code_hash: null, sending_at: null }).eq("hunt_id", hunt.id).eq("user_id", hunter.id);
  const s1 = await sendFinishEmail(hunt.id, hunter.id, "https://playloota.com");
  const code1 = sent[0]?.text.match(/LOOTA-[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] ?? "";
  check("the email goes to the hunter, with a prize code", s1.status === "sent" && sent.length === 1 && sent[0].to[0] === hunter.email && !!code1, `${sent[0]?.subject} · ${code1}`);
  check("…and says how to claim, with the rules' address", /reply to this email/i.test(sent[0]?.text ?? "") && (sent[0]?.text ?? "").includes("https://playloota.com/rules"));
  const { data: r1 } = await admin.from("prize_claims").select("code_hash, email_to, emailed_at").eq("hunt_id", hunt.id).eq("user_id", hunter.id).single();
  check("only the code's hash is stored, and it matches", r1?.code_hash === hashPrizeCode(code1) && !JSON.stringify(r1).includes(code1.slice(6)) && !!r1?.emailed_at);
  check("a code typed any old way gives the same hash", hashPrizeCode(code1.toLowerCase().replace(/-/g, " ")) === hashPrizeCode(code1) && hashPrizeCode(code1.slice(6)) === hashPrizeCode(code1));
  const s2 = await sendFinishEmail(hunt.id, hunter.id, "https://playloota.com");
  check("a second call sends nothing", s2.status === "sent" && sent.length === 1);
  await sendFinishEmail(hunt.id, hunter.id, "https://playloota.com", true);
  const code2 = sent[1]?.text.match(/LOOTA-[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] ?? "";
  const { data: r2 } = await admin.from("prize_claims").select("code_hash").eq("hunt_id", hunt.id).eq("user_id", hunter.id).single();
  check("'again' sends a new code, which replaces the old", !!code2 && code2 !== code1 && r2?.code_hash === hashPrizeCode(code2));
  globalThis.fetch = realFetch;

  // ---- 3. The owner's Prizes page
  const owner = await makeUser("prizeowner", true);
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000 });
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push((e as Error).message));
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie(...[...owner.jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  await page.goto("http://localhost:3000/admin/prizes", { waitUntil: "networkidle2", timeout: 120000 });
  const winnerRow = await page.evaluate(() => document.querySelector("[data-winner]")?.textContent ?? "");
  check("the winner is listed, code emailed, not paid", /Prize test \(automated\)/.test(winnerRow) && /code emailed/.test(winnerRow) && /not paid/.test(winnerRow), winnerRow.slice(0, 160));
  const tryCode = async (code: string) => {
    await page.$eval("input[name=code]", (el) => ((el as HTMLInputElement).value = ""));
    await page.type("input[name=code]", code);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST", { timeout: 60000 }), page.click("form button[type=submit]")]);
    await page.waitForSelector("[data-code-result]", { timeout: 30000 });
    await wait(500);
    return page.evaluate(() => {
      const el = document.querySelector("[data-code-result]");
      return { ok: el?.getAttribute("data-code-result"), text: el?.textContent ?? "" };
    });
  };
  const old1 = await tryCode(code1);
  check("the replaced code: No match", old1.ok === "no", old1.text.slice(0, 80));
  const good = await tryCode(code2.toLowerCase().replace(/-/g, " "));
  check("the current code, typed in lower case with spaces: it matches, with whose it is", good.ok === "yes" && good.text.includes(hunter.email) && good.text.includes("₦10,000 cash"), good.text.slice(0, 120));
  await page.screenshot({ path: `${OUT}/prizes-check.png` });
  await page.type("input[name=note]", "TRF-TEST-123");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }), page.click("[data-code-result=yes] form button")]);
  const { data: paid } = await admin.from("prize_claims").select("paid_at, paid_note").eq("hunt_id", hunt.id).eq("user_id", hunter.id).single();
  check("Mark as paid: recorded with its note", !!paid?.paid_at && paid.paid_note === "TRF-TEST-123");
  const again = await tryCode(code2);
  check("checked again: already paid, don't pay twice", again.ok === "yes" && /Already paid/.test(again.text));

  // ---- 4. The new-hunt form: a Lagos hunt, 4 pm to 5 pm
  const { data: all } = await admin.from("hunts").select("starts_at");
  const usedDays = new Set((all ?? []).map((h: { starts_at: string }) => new Date(Date.parse(h.starts_at) + 3_600_000).toISOString().slice(0, 10)));
  let day = "";
  for (let i = 29; i > 1 && !day; i--) {
    const d = new Date(Date.now() + 3_600_000 + i * 86_400_000).toISOString().slice(0, 10);
    if (!usedDays.has(d)) day = d;
  }
  await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });
  await page.$eval("input[name=day]", (el, d) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, d);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, day);
  await page.$eval("input[name=start]", (el) => ((el as HTMLInputElement).value = "16:00"));
  await page.$eval("input[name=end]", (el) => ((el as HTMLInputElement).value = "17:00"));
  await page.select("select[name=region]", "state");
  await wait(200);
  const stateOptions = await page.$$eval("select[name=state] option", (o) => o.length);
  check("a state hunt in Nigeria offers the 36 states and the FCT", stateOptions === 37, String(stateOptions));
  await page.select("select[name=state]", "Lagos");
  await page.$eval("input[name=keys]", (el) => ((el as HTMLInputElement).value = "3"));
  await page.type("input[name=prize]", "₦10,000 cash");
  await page.screenshot({ path: `${OUT}/admin-new-hunt.png` });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }), page.click("form[action] button[type=submit], form button[type=submit]")]);
  const { data: made } = await admin.from("hunts").select("id, region, area_country, area_state, starts_at, ends_at, keys_wanted").eq("created_by", owner.id).maybeSingle();
  if (made) hunts.push(made.id);
  check(
    "the hunt is stored: Lagos, Nigeria, 4 pm to 5 pm Lagos time on that day, 3 keys",
    made?.region === "state" && made.area_country === "NG" && made.area_state === "Lagos" && made.starts_at.startsWith(`${day}T15:00`) && made.ends_at.startsWith(`${day}T16:00`) && made.keys_wanted === 3,
    JSON.stringify(made),
  );
  const card = await page.evaluate(() => [...document.querySelectorAll("section")].find((s) => s.querySelector("[aria-label='Waiting for its story']"))?.textContent ?? "");
  check("its card: in Lagos, Nigeria, and the request ends so", card.includes("keys in Lagos, Nigeria") && !!made && card.includes(`/new-story-hunt ${made.id} 3 keys in Lagos, Nigeria`), card.slice(0, 200));
  const dup = await page.evaluate(() => document.querySelector("input[name=day]") !== null);
  check("the form stays open for the next day's hunt", dup);
  check("no page errors on the owner pages", problems.length === 0, problems.join(" | "));

  // ---- 5. The public pages
  const visitor = await (await browser.createBrowserContext()).newPage(); // no owner cookies
  await visitor.setViewport({ width: 390, height: 844 });
  for (const [path, title] of [["/rules", "Hunt rules"], ["/terms", "Terms of use"], ["/privacy", "Privacy policy"]]) {
    const res = await visitor.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle2", timeout: 120000 });
    const h1 = await visitor.$eval("h1", (e) => e.textContent);
    const wide = await visitor.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`${path} opens for a visitor, fits a phone`, res?.status() === 200 && h1 === title && !wide, `${res?.status()} ${h1}${wide ? " (scrolls sideways)" : ""}`);
    await visitor.screenshot({ path: `${OUT}/legal${path.replace("/", "-")}.png`, fullPage: true });
  }
  await visitor.goto("http://localhost:3000/signup", { waitUntil: "networkidle2", timeout: 120000 });
  const links = await visitor.$$eval("form a", (as) => as.map((a) => a.getAttribute("href")));
  check("sign-up links to the terms, rules and privacy", ["/terms", "/rules", "/privacy"].every((h) => links.includes(h)), links.join(","));
} catch (e) {
  fails++;
  console.log("FAIL  ", e);
} finally {
  await browser?.close();
  for (const h of hunts) await admin.from("hunts").delete().eq("id", h);
  for (const u of users) await admin.auth.admin.deleteUser(u);
  console.log(fails ? `\n${fails} check(s) failed` : "\nAll checks passed");
  process.exit(fails ? 1 : 0);
}

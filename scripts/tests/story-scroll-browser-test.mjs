// The story scroll and the trailer (owner, 31 Oct 2026: "we create a reader, something like a scroll that user can always
// open and close. What will be in the lobby, story trailer, I will create that, and there should be a place for me to
// upload it"). A live story hunt with a story (its answers, decoys and live pieces kept with it), a picture and a trailer:
//   1. the story the game's server hands a hunter has the chapters and the picture, and none of the answers;
//      not signed in: refused; a hunt not started yet: no chapters, only when it opens; an unpublished hunt: none;
//   2. the lobby shows the hunt's trailer, with the story's first picture as its cover;
//   3. on the map (a phone), the scroll's button glows until read; it opens the story (title, the prologue with its
//      picture), Next turns the chapter, ✕ and Escape close it, and it reopens at the chapter being read;
//   4. the owner's card in the admin has the trailer and its Upload button.
// The hunts, files and test players are deleted.   SHOTS=<folder> node scripts/tests/story-scroll-browser-test.mjs
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
const sharp = app("sharp");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const ahead = (s) => new Date(Date.now() + s * 1000).toISOString();
const users = [];
const hunts = [];
const files = { "story-pictures": [], "story-trailers": [] };
let browser;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const home = { lng: 3.3787, lat: 6.5186 };

// What must never reach a hunter: the answer, a decoy, a live piece, the villain's motive.
const SECRETS = ["Sun Voyager Sculpture", "Harpa Concert Hall", "THE SIX O'CLOCK BULLETIN SAYS", "revenge for the drowned"];
const work = {
  keys: 1, writer: "claude-code", designs: { 1: { steps: ["…"], plants: [], live: "THE SIX O'CLOCK BULLETIN SAYS: go to the steel ship." } },
  decoys: { 1: [{ name: "Harpa Concert Hall", searchName: "Harpa Concert Hall" }] }, map: {}, spent: {}, done: true, log: [],
  skeleton: {
    title: "The Test of the Northern Light", logline: "A lighthouse keeper's last letter, and a ship made of steel.",
    villain: { name: "Mr Grey", motive: "revenge for the drowned" }, heroes: [], rules: [],
    chapters: [
      { n: 0, title: "The Letter", setting: "A cold harbour, before dawn" },
      { n: 1, title: "The Second Bell", setting: "Somewhere by the water" },
      { n: 2, title: "Home", setting: "Evening" },
    ],
    keys: [{ n: 1, question: "Where did the keeper send the letter?", answer: { name: "Sun Voyager Sculpture", city: "Reykjavik", country: "Iceland", searchName: "Sun Voyager Sculpture", aliases: [] } }],
  },
  chapters: {
    0: { text: "The fog came in off the water.\n\nThe keeper wrote by the lamp until it guttered.", leaks: [] },
    1: { text: "The second bell rang at seven.\n\nNobody in the harbour admitted to hearing it.", leaks: [] },
    2: { text: "And so the light went out for the last time.", leaks: [] },
  },
};

async function player(admin_ = false) {
  const email = `scroll-${Date.now()}-${users.length}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  users.push(data.user.id);
  await admin.from("profiles").update({ is_admin: admin_, home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", data.user.id);
  await admin.from("player_positions").upsert({ user_id: data.user.id, lng: home.lng, lat: home.lat, mode: "walk", energy: 100, updated_at: ago(30) });
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  return { id: data.user.id, cookies: [...jar].map(([n, value]) => ({ name: n, value, domain: "localhost", path: "/" })) };
}
async function hunt(fields) {
  const { data, error } = await admin.from("hunts").insert({ prize: "Test prize (automated)", winners: 1, story: work, story_status: "ready", keys_wanted: 1, ...fields }).select("id").single();
  if (error) throw error;
  hunts.push(data.id);
  await admin.from("hunt_keys").insert({ hunt_id: data.id, n: 1, riddle: work.skeleton.keys[0].question, category: "general", trial_kind: "sentries", area_lng: 3.3958, area_lat: 6.4541, area_radius_m: 800, spot_lng: 3.3958, spot_lat: 6.4541 });
  return data.id;
}

try {
  const hunter = await player();
  const owner = await player(true);
  const live = await hunt({ title: "The Test of the Northern Light", description: work.skeleton.logline, starts_at: ago(3600), ends_at: ahead(6 * 3600), published: true, all_day: true });
  const soon = await hunt({ title: "A story not open yet (automated)", starts_at: ahead(20 * 3600), ends_at: ahead(32 * 3600), published: true });
  const hidden = await hunt({ title: "An unpublished story (automated)", starts_at: ago(3600), ends_at: ahead(6 * 3600), published: false });
  await admin.from("hunt_players").insert({ hunt_id: live, user_id: hunter.id, guess_n: 1, guess_name: "Test answer", guess_lng: 0, guess_lat: 0 });

  // A picture for the prologue, and a trailer
  const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 40, g: 70, b: 110 } } }).png().toBuffer();
  const picture = `${live}/1-test.png`;
  await admin.storage.from("story-pictures").upload(picture, png, { contentType: "image/png" });
  files["story-pictures"].push(picture);
  await admin.from("story_pictures").insert([{ hunt_id: live, n: 1, chapter: 0, prompt: "A harbour in fog.", path: picture }, { hunt_id: live, n: 2, chapter: 1, prompt: "Not uploaded yet.", path: null }]);
  const trailer = `${live}/trailer-test.mp4`;
  const { error: up } = await admin.storage.from("story-trailers").upload(trailer, Buffer.from("not really a video"), { contentType: "video/mp4" });
  if (up) throw up;
  files["story-trailers"].push(trailer);
  await admin.from("hunts").update({ trailer_path: trailer }).eq("id", live);

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.setCookie(...hunter.cookies);
  await page.evaluateOnNewDocument((h, uid) => {
    try {
      localStorage.setItem(`loota:riddle-seen:${h}`, "1");
      localStorage.setItem(`loota:welcome:${uid}`, "1");
      localStorage.setItem(`loota:story:${h}:start`, "1");
    } catch {}
  }, live, hunter.id);

  // ---- 1. What the server hands a hunter
  await page.goto("http://localhost:3000/lobby", { waitUntil: "networkidle2", timeout: 120000 });
  const got = await page.evaluate(async (ids) => {
    const one = async (h) => { const r = await fetch(`/api/hunt/story?hunt=${h}`); return { status: r.status, text: await r.text() }; };
    return { live: await one(ids[0]), soon: await one(ids[1]), hidden: await one(ids[2]) };
  }, [live, soon, hidden]);
  const story = JSON.parse(got.live.text);
  check("the story for a hunter: every chapter's text, and the uploaded picture", got.live.status === 200 && story.chapters.length === 3 && story.chapters[1].paragraphs.length === 2 && story.pictures.length === 1 && story.pictures[0].chapter === 0, `${got.live.status}, ${story.chapters?.length} chapters, ${story.pictures?.length} pictures`);
  check("…and none of the answers, decoys, live pieces or the villain's motive", SECRETS.every((x) => !got.live.text.includes(x)), SECRETS.filter((x) => got.live.text.includes(x)).join(", ") || "clean");
  const notIn = await fetch(`http://localhost:3000/api/hunt/story?hunt=${live}`);
  check("not signed in: refused", notIn.status === 401, notIn.status);
  const soonStory = JSON.parse(got.soon.text);
  check("a hunt not started: no chapters yet, only when it opens", got.soon.status === 200 && soonStory.chapters.length === 0 && soonStory.pictures.length === 0 && !!soonStory.opensAt, `${soonStory.chapters?.length} chapters`);
  check("an unpublished hunt: no story", got.hidden.status === 404, got.hidden.status);

  // ---- 2. The lobby's trailer
  const video = await page.evaluate((title) => {
    const card = [...document.querySelectorAll("article")].find((a) => a.textContent?.includes(title));
    const v = card?.querySelector("video");
    return v ? { src: v.getAttribute("src"), poster: v.getAttribute("poster"), controls: v.controls, width: v.getBoundingClientRect().width } : null;
  }, "The Test of the Northern Light");
  check("the lobby: the hunt's trailer, with the story's first picture as its cover", !!video && /story-trailers\/.+trailer-test\.mp4$/.test(video.src) && /story-pictures\/.+1-test\.png$/.test(video.poster ?? "") && video.controls, JSON.stringify(video));
  check("…fitting a phone (no sideways scroll)", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth} / ${window.innerWidth}`));
  await page.screenshot({ path: `${OUT}/story-scroll-1-lobby.png`, fullPage: true });

  // ---- 3. The scroll on the map
  await page.goto(`http://localhost:3000/play?hunt=${live}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  let button = null;
  for (let i = 0; i < 40 && !button; i++) {
    await wait(1000);
    button = await page.evaluate(() => {
      const b = document.querySelector('[data-tool="story"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { label: b.getAttribute("aria-label"), top: r.top, bottom: r.bottom, right: r.right };
    });
  }
  check("the map: the scroll's button, glowing until read", /not read yet/.test(button?.label ?? ""), button?.label);
  check("…on the screen", !!button && button.top >= 0 && button.bottom <= 844 && button.right <= 390, JSON.stringify(button));
  await page.screenshot({ path: `${OUT}/story-scroll-2-map.png` });
  await page.click('[data-tool="story"]');
  await wait(600);
  const first = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="The story"]');
    return d ? { text: d.innerText, img: d.querySelector("article img")?.getAttribute("src") ?? null, chapter: d.querySelector("article")?.getAttribute("data-chapter") } : null;
  });
  check("tapped: the scroll opens on the story's title and the prologue", !!first && first.text.includes("The Test of the Northern Light") && first.text.includes("PROLOGUE") && first.text.includes("The keeper wrote by the lamp") && first.chapter === "0", first?.text.slice(0, 160));
  check("…with its picture", /1-test\.png$/.test(first?.img ?? ""), first?.img);
  check("…and nothing of the answers", SECRETS.every((x) => !first?.text.includes(x)));
  await page.screenshot({ path: `${OUT}/story-scroll-3-prologue.png` });
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Next/.test(b.textContent ?? ""))?.click());
  await wait(400);
  const second = await page.evaluate(() => document.querySelector('[role="dialog"] article')?.innerText ?? "");
  check("Next: chapter 1", /CHAPTER 1/.test(second) && second.includes("The second bell rang at seven"), second.slice(0, 120));
  await page.screenshot({ path: `${OUT}/story-scroll-4-chapter.png` });
  await page.click('[aria-label="Close the scroll"]');
  await wait(400);
  check("✕ closes it", !(await page.$('[role="dialog"][aria-label="The story"]')));
  const after = await page.evaluate(() => document.querySelector('[data-tool="story"]')?.getAttribute("aria-label"));
  check("…and the button stops glowing (read)", after === "The story", after);
  await page.click('[data-tool="story"]');
  await wait(500);
  const again = await page.evaluate(() => document.querySelector('[role="dialog"] article')?.getAttribute("data-chapter"));
  check("opened again: back at the chapter being read", again === "1", again);
  await page.keyboard.press("Escape");
  await wait(400);
  check("Escape closes it too", !(await page.$('[role="dialog"][aria-label="The story"]')));
  check("no page errors", problems.length === 0, problems.join(" / "));

  // ---- 4. The owner's card
  const ownerPage = await browser.newPage();
  await ownerPage.setViewport({ width: 1280, height: 1000 });
  await ownerPage.setCookie(...owner.cookies);
  await ownerPage.goto("http://localhost:3000/admin", { waitUntil: "networkidle2", timeout: 120000 });
  const box = await ownerPage.evaluate((title) => {
    const card = [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent === title);
    const t = card?.querySelector('[aria-label="Story trailer"]');
    return t ? { text: t.textContent, video: t.querySelector("video")?.getAttribute("src") ?? null, input: !!t.querySelector('input[type="file"][accept*="video/mp4"]') } : null;
  }, "The Test of the Northern Light");
  check("the admin: the hunt's trailer, with Replace (an MP4, WebM or MOV)", !!box && /uploaded: in the lobby/.test(box.text) && /trailer-test\.mp4$/.test(box.video ?? "") && box.input && /Replace the trailer/.test(box.text), box?.text?.slice(0, 120));
  await ownerPage.screenshot({ path: `${OUT}/story-scroll-5-admin.png` });
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  await browser?.close();
  for (const [bucket, paths] of Object.entries(files)) if (paths.length) await admin.storage.from(bucket).remove(paths);
  for (const h of hunts) await admin.from("hunts").delete().eq("id", h);
  for (const u of users) await admin.auth.admin.deleteUser(u);
  console.log(`test hunts, files and players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}

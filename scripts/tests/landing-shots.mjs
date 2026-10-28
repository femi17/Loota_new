// The home page, on a phone and a desktop: full-page screenshots (and the phone screen by screen), with no page errors
// and no sideways scroll; the gallery's pictures all load.
//   SHOTS=<folder> node scripts/tests/landing-shots.mjs
import puppeteer from "puppeteer-core";
const OUT = process.env.SHOTS ?? (await import("node:os")).tmpdir();
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
try {
  for (const [name, vp] of [["phone", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ["desktop", { width: 1440, height: 900 }]]) {
    const page = await browser.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.setViewport(vp);
    await page.goto("http://localhost:3000/", { waitUntil: "networkidle2", timeout: 120000 });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    // Every picture in, as a visitor scrolling (and swiping the gallery) would see it.
    await page.evaluate(() => document.querySelectorAll("img").forEach((i) => (i.loading = "eager")));
    await new Promise((r) => setTimeout(r, 3000));
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).length);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${OUT}/landing-${name}.png`, fullPage: true });
    if (name === "phone") {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0, n = 1; y < h; y += 844, n++) {
        await page.evaluate((y) => window.scrollTo(0, y), y);
        await new Promise((r) => setTimeout(r, 400));
        await page.screenshot({ path: `${OUT}/landing-phone-${n}.png` });
      }
    }
    check(`${name}: no page errors`, problems.length === 0, problems.join(" / "));
    check(`${name}: no sideways scroll`, wide <= 0, `${wide}px`);
    check(`${name}: every picture loads`, broken === 0, `${broken} not loaded`);
    await page.close();
  }
} finally {
  await browser.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
}

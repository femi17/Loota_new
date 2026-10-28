// Screenshots for the home page, taken by any browser test: load this first and every page the test opens hides
// Next.js's dev badge; with SHOT_DAY=1 the page's clock also moves to the next 1 pm in Lagos (sunny), time still running.
// Only for tests whose screens don't count down to a server time (a trial's clock would be off by the shift).
//   SHOTS=<folder> [SHOT_DAY=1] node --import ./scripts/tests/shot-mode.mjs scripts/tests/<test>.mjs
import puppeteer from "puppeteer-core";

const HOUR = 3600_000;
const now = Date.now();
const lagos = new Date(now + HOUR); // Lagos is UTC+1
const target = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate(), 13) - HOUR;
const shift = process.env.SHOT_DAY ? (target > now ? target : target + 24 * HOUR) - now : 0;

const launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = async (...args) => {
  const browser = await launch(...args);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => {
    const page = await newPage(...a);
    await page.evaluateOnNewDocument((shift) => {
      const css = () => {
        const s = document.createElement("style");
        s.textContent = "nextjs-portal { display: none !important; }";
        document.documentElement.appendChild(s);
      };
      if (document.documentElement) css();
      else document.addEventListener("DOMContentLoaded", css);
      if (!shift) return;
      const RealDate = Date;
      const realNow = RealDate.now.bind(RealDate);
      class ShiftedDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [realNow() + shift]));
        }
        static now() {
          return realNow() + shift;
        }
      }
      globalThis.Date = ShiftedDate;
    }, shift);
    return page;
  };
  return browser;
};

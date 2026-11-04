// The logos for "Guess the logo" (owner, 4 Nov 2026: "The guess the logo should be an image not a word description"):
// from the Simple Icons package (CC0; its licence and its trademark disclaimer copied alongside: the logos stay their
// companies' marks), each drawn in its brand's colour on a tile (dark under a light colour), its <title> (the name)
// taken out, under a file name of its own that doesn't say the brand; and a map for the game's server
// (src/game/puzzles/logo-files.ts). Only logos that are a picture, not the name spelled out (no KFC, BMW, Burger King,
// Nissan, Peugeot, Porsche or Ford: their logos say their names).
//   node scripts/make-logos.mjs <the simple-icons package folder>
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [pkg] = process.argv.slice(2);
if (!pkg) throw new Error("usage: node scripts/make-logos.mjs <simple-icons package folder>");
/** [slug, the name players choose] */
const BRANDS = [
  ["nike", "Nike"], ["apple", "Apple"], ["mcdonalds", "McDonald's"], ["adidas", "Adidas"], ["toyota", "Toyota"], ["shell", "Shell"],
  ["puma", "Puma"], ["starbucks", "Starbucks"], ["volkswagen", "Volkswagen"], ["ferrari", "Ferrari"],
  ["lamborghini", "Lamborghini"], ["netflix", "Netflix"], ["audi", "Audi"], ["honda", "Honda"],
  ["mastercard", "Mastercard"], ["facebook", "Facebook"], ["youtube", "YouTube"], ["whatsapp", "WhatsApp"], ["instagram", "Instagram"],
  ["spotify", "Spotify"], ["playstation", "PlayStation"], ["tesla", "Tesla"], ["android", "Android"], ["redbull", "Red Bull"],
  ["hyundai", "Hyundai"], ["renault", "Renault"],
  ["chevrolet", "Chevrolet"], ["huawei", "Huawei"], ["tiktok", "TikTok"],
  ["snapchat", "Snapchat"], ["telegram", "Telegram"], ["pinterest", "Pinterest"], ["reddit", "Reddit"], ["discord", "Discord"],
  ["twitch", "Twitch"], ["x", "X (Twitter)"], ["paypal", "PayPal"], ["airbnb", "Airbnb"], ["google", "Google"], ["suzuki", "Suzuki"],
];
const data = JSON.parse(readFileSync(`${pkg}/data/simple-icons.json`, "utf8"));
const icons = Array.isArray(data) ? data : data.icons;
const slugOf = (i) => i.slug ?? i.title.toLowerCase().replace(/[^a-z0-9]/g, "");
const out = new URL("../public/logos/", import.meta.url);
mkdirSync(out, { recursive: true });
const files = {};
for (const [slug, name] of BRANDS) {
  const icon = icons.find((i) => slugOf(i) === slug);
  if (!icon) throw new Error(`no icon data for ${slug}`);
  const svg = readFileSync(`${pkg}/icons/${slug}.svg`, "utf8");
  const path = svg.match(/<path d="([^"]+)"/)?.[1];
  if (!path) throw new Error(`no path in ${slug}`);
  const hex = `#${icon.hex}`;
  const [r, g, b] = [0, 2, 4].map((k) => parseInt(icon.hex.slice(k, k + 2), 16) / 255);
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
  const tile = light ? "#1B2230" : "#F4F1EA";
  const file = `${createHash("sha1").update(`loota-logo:${slug}`).digest("hex").slice(0, 12)}.svg`;
  writeFileSync(new URL(file, out), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 32 32"><rect x="-4" y="-4" width="32" height="32" rx="5" fill="${tile}"/><path fill="${hex}" d="${path}"/></svg>\n`);
  files[slug] = { file, name };
}
copyFileSync(`${pkg}/LICENSE.md`, new URL("LICENSE-simple-icons.md", out));
copyFileSync(`${pkg}/DISCLAIMER.md`, new URL("DISCLAIMER-simple-icons.md", out));
writeFileSync(
  new URL("../src/game/puzzles/logo-files.ts", import.meta.url),
  `/** Each brand's logo in public/logos, and the name players choose (made by scripts/make-logos.mjs from Simple Icons,\n * CC0; the logos stay their companies' marks). */\nexport const LOGO_FILES: Record<string, { file: string; name: string }> = ${JSON.stringify(files, null, 2)};\n`,
);
console.log(`${BRANDS.length} logos made`);

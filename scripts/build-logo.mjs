// The Loota logo (owner, 19 Oct 2026), from the owner's image (black script on white) to transparent PNGs:
// light (cream, for the dark screens), dark (brown, for the parchment cards) and the app icon (on an ink tile).
//   node scripts/build-logo.mjs assets/loota-logo-source.webp
import sharp from "sharp";
const src = process.argv[2];
const OUT = new URL("../public/brand/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

// Ink coverage (0 white paper … 255 black ink), trimmed to the letters with a little air around them.
const grey = await sharp(src).flatten({ background: "#ffffff" }).greyscale().trim({ threshold: 20 }).extend({ top: 12, bottom: 12, left: 12, right: 12, background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
const { width, height } = grey.info;
const alpha = Buffer.alloc(width * height);
for (let i = 0; i < width * height; i++) {
  const ink = 255 - grey.data[i];
  alpha[i] = Math.max(0, Math.min(255, Math.round((ink - 18) * 1.25))); // the paper's speckle gone, the strokes solid
}
async function tinted(hex, name, h) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([r, g, b, alpha[i]], i * 4);
  await sharp(rgba, { raw: { width, height, channels: 4 } }).resize({ height: h }).png({ compressionLevel: 9 }).toFile(OUT + name);
}
await tinted("#F4F1EA", "loota-light.png", 240);
await tinted("#3A2410", "loota-dark.png", 240);
await tinted("#F4B41A", "loota-gold.png", 240);
// The app icon: the cream logo on the ink tile, a little padding.
const logo = await sharp(OUT + "loota-light.png").resize({ width: 400, height: 400, fit: "inside" }).toBuffer();
const icon = sharp({ create: { width: 512, height: 512, channels: 4, background: "#0F1420" } }).composite([{ input: logo, gravity: "center" }]);
const tile = await icon.png().toBuffer();
await sharp(tile).toFile(OUT + "icon-512.png");
await sharp(tile).resize(180).png().toFile(OUT + "apple-icon.png");
await sharp(tile).resize(64).png().toFile(OUT + "icon-64.png");
console.log(`logo ${width}×${height} → public/brand/`);

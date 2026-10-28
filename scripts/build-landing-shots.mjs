// The home page's pictures of the game: phone screenshots taken by the browser tests (SHOTS=<folder>), made small
// (540 px wide, WebP) into src/images/landing/<name>.webp. Optionally cut from the top/bottom (in screenshot pixels).
//   node scripts/build-landing-shots.mjs <shot.png>=<name>[:top:bottom] ...
import sharp from "sharp";
import { mkdirSync } from "node:fs";
const OUT = new URL("../src/images/landing/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
mkdirSync(OUT, { recursive: true });
for (const arg of process.argv.slice(2)) {
  const [src, spec] = arg.split(/=(?=[^=]+$)/);
  const [name, top = "0", bottom = "0"] = spec.split(":");
  const meta = await sharp(src).metadata();
  const height = meta.height - Number(top) - Number(bottom);
  const info = await sharp(src)
    .extract({ left: 0, top: Number(top), width: meta.width, height })
    .resize({ width: 540 })
    .webp({ quality: 80 })
    .toFile(`${OUT}${name}.webp`);
  console.log(`${name}.webp  ${info.width}x${info.height}  ${Math.round(info.size / 1024)} KB`);
}

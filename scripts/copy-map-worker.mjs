// MapLibre draws the map in a web worker that loads from its own file. The
// bundler doesn't serve that file, so copy it into public/ (see GameMap's
// setWorkerUrl). Runs before `dev` and `build` so it matches the installed version.
import { copyFileSync } from "node:fs";

copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");

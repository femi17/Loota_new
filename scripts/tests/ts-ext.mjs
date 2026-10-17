// Lets test scripts import the game's TypeScript files directly:
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/<test>.mts
// Imports without an extension get ".ts"; "@/…" points into src/.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = new URL("../../src/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), src).href;
    if ((specifier.startsWith(".") || specifier.startsWith("file:")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      const base = specifier.startsWith("file:") ? new URL(specifier) : new URL(specifier, context.parentURL);
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        const candidate = fileURLToPath(base) + ext;
        if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
      }
    }
    return next(specifier, context);
  },
});

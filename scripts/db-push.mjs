// Applies every new file in supabase/migrations to the hosted Supabase project.
// Usage: npm run db:push            (apply)
//        npm run db:push -- --dry-run (list what would be applied)
//
// Reads SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD from .env.local; the
// Supabase CLI picks both up from the environment, so they never appear on the
// command line or in the output.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

process.loadEnvFile(".env.local");

const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"].filter(
  (name) => !process.env[name],
);
if (missing.length) {
  console.error(`Add ${missing.join(" and ")} to .env.local first (see .env.example).`);
  process.exit(1);
}

const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const supabase = (args) =>
  execFileSync("npx", ["supabase", ...args], { stdio: "inherit", shell: process.platform === "win32" });

if (!existsSync("supabase/.temp/project-ref")) {
  supabase(["link", "--project-ref", projectRef, "--yes"]);
}
supabase(["db", "push", "--linked", "--yes", ...process.argv.slice(2)]);

// Writes the penalties (scripts/penalties/penalties.mjs) to the database: new ones added; ones already there are left
// as they are (the owner edits them in the admin: /admin/penalties), and none deleted.   npm run penalties:seed
import { createRequire } from "node:module";
import { penalties } from "./penalties.mjs";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const all = penalties();
for (let i = 0; i < all.length; i += 200) {
  const { error } = await db.from("penalties").upsert(all.slice(i, i + 200), { onConflict: "code", ignoreDuplicates: true });
  if (error) throw error;
}
const { count } = await db.from("penalties").select("code", { count: "exact", head: true });
console.log(`${all.length} penalties written; ${count} in the database`);

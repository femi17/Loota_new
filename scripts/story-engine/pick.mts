// Today's story picks, for a story written in Claude Code (owner, 31 Oct 2026: no paid API; "I can always prompt you
// to create a new story"). Chooses the genre, the theme, and for each key a lock (kind of puzzle) and a channel (how its
// live piece reaches players), least used first; prints them with everything earlier stories used (never reuse), and
// writes a draft to fill in: docs/stories/drafts/<date>-<hunt or "new">.json. Then write the story into it and run
// npm run story:import.
//   npm run story:pick -- [--hunt <id>] [--keys 5] [--genre "..."] [--theme "..."]
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { assignmentOf, newWork, nextStep, type Used } from "../../src/lib/story/engine.ts";

process.loadEnvFile(".env.local");
const argv = process.argv;
const opt = (name: string, fallback: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const huntId = opt("hunt", "");
let keys = Number(opt("keys", "5"));
if (huntId) {
  const { data: h } = await db.from("hunts").select("title, keys_wanted, story_status, starts_at").eq("id", huntId).maybeSingle();
  if (!h) throw new Error(`No hunt ${huntId}`);
  keys = h.keys_wanted ?? keys;
  console.log(`Hunt: ${h.title} (${h.story_status ?? "made by hand"}), starts ${h.starts_at}, ${keys} keys`);
}
const { data: rows } = await db.from("story_registry").select("title, genre, theme, locks, channels, places, decoys, characters").order("id");
const used = (rows ?? []) as Used[];

const work = newWork(keys, "claude-code", { genre: opt("genre", ""), theme: opt("theme", "") });
await nextStep(work, used); // the picks only: no API
const date = new Date().toISOString().slice(0, 10);
mkdirSync("docs/stories/drafts", { recursive: true });
const file = `docs/stories/drafts/${date}-${huntId ? huntId.slice(0, 8) : "new"}.json`;
writeFileSync(file, JSON.stringify(work, null, 2));

console.log(`\nGenre: ${work.picked!.genre}\nTheme: ${work.picked!.theme}\nKeys: ${keys}\n`);
for (const a of assignmentOf(work)) {
  console.log(`Key ${a.n}: lock "${a.lock.id}" (${a.lock.name}: ${a.lock.how})`);
  console.log(`        channel "${a.channel.id}" (${a.channel.name}: ${a.channel.how})${a.channel.game === "to-build" ? " [game feature to build]" : ""}`);
}
console.log(`\nNever reuse:\n- Places: ${used.flatMap((u) => u.places.map((p) => p.name)).join("; ") || "none"}\n- Characters: ${used.flatMap((u) => u.characters).join("; ") || "none"}\n- Titles: ${used.map((u) => u.title).join("; ") || "none"}\n- Decoys: ${used.flatMap((u) => u.decoys).join("; ") || "none"}`);
console.log(`\nDraft: ${file}\nFill in skeleton, designs, decoys, chapters and production (shapes: STORY_SHAPES in src/lib/story/engine.ts), then:\n  npm run story:import -- ${file}${huntId ? ` --hunt ${huntId}` : ""}`);

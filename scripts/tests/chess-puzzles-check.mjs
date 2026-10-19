// Every mate-in-one puzzle in a SQL file (or the database with DB=1): legal, White to move, the stored move is
// checkmate, and it's the only mating move.   node scripts/tests/chess-puzzles-check.mjs <file.sql> | DB=1 node …
import { createRequire } from "node:module";
import fs from "node:fs";
import { Chess } from "chess.js";
let list;
if (process.env.DB) {
  const app = createRequire(new URL("../../package.json", import.meta.url));
  const { createClient } = app("@supabase/supabase-js");
  process.loadEnvFile(new URL("../../.env.local", import.meta.url));
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  list = (await admin.from("chess_puzzles").select("fen, solution, san")).data;
} else {
  list = [...fs.readFileSync(process.argv[2], "utf8").matchAll(/\('([^']+)', '([a-h][1-8][a-h][1-8])', '([^']+)'\)/g)].map((m) => ({ fen: m[1], solution: m[2], san: m[3] }));
}
let bad = 0;
for (const p of list) {
  const g = new Chess(p.fen);
  const mates = g.moves({ verbose: true }).filter((m) => { g.move(m); const x = g.isCheckmate(); g.undo(); return x; });
  const ok = g.turn() === "w" && !g.isCheck() && mates.length === 1 && `${mates[0].from}${mates[0].to}` === p.solution && mates[0].san === p.san;
  if (!ok) { bad++; console.log("BAD", p.fen, p.solution, mates.map((m) => m.san)); }
}
console.log(`${list.length} puzzles checked, ${bad} bad`);

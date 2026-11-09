// Listens to a hunt's live channel (what each hunter's game sends the broadcast) for a while and sums it up: how often
// positions come and whether they carry the mirror's recording (trail: the hunter as their own screen drew them).
// Reads only.
//   node scripts/tests/live-channel-probe.mjs <hunt id> [seconds]
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const [hunt, secs = "60"] = process.argv.slice(2);
if (!hunt) throw new Error("hunt id?");
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();
const log = [];
const ch = c.channel(`hunt:${hunt}`, { config: { broadcast: { self: false } } });
ch.on("broadcast", { event: "*" }, ({ event, payload }) => log.push({ at: Date.now() - t0, event, payload }));
ch.subscribe((status) => console.log("channel:", status));
await new Promise((r) => setTimeout(r, Number(secs) * 1000));
await c.removeChannel(ch);
const pos = log.filter((e) => e.event === "pos");
console.log(`${log.length} messages in ${secs} s: ${pos.length} pos, others: ${[...new Set(log.filter((e) => e.event !== "pos").map((e) => e.event))].join(", ") || "none"}`);
for (const e of pos.slice(0, 12)) {
  const p = e.payload;
  console.log(`  +${(e.at / 1000).toFixed(1)}s ${p.name} ${p.mode} moving=${p.moving} ${p.lng?.toFixed(5)},${p.lat?.toFixed(5)} trail=${Array.isArray(p.trail) ? p.trail.length : "-"} sent ${p.t ? Date.now() - (Date.now() - t0 - e.at) - p.t : "?"}`);
}
process.exit(0);

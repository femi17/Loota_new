// Importing a story written in Claude Code (owner, 31 Oct 2026: no paid API). A draft built from the saved Keeper's Last
// Light plan (its real keys and 22–25 decoys each) with stand-in chapters and pictures:
//   1. --check: the free checks run (codes, the map, leaks) and nothing changes;
//   2. a chapter naming a key place is refused;
//   3. imported into a waiting hunt: the hunt gets the story's title, a key at each real place, a picture slot per
//      prompt, a registry row, and the PDFs are written.
// Needs docs/stories/.work-2026-10-30.json (the saved plan; kept on this computer only). Everything made is deleted.
//   node scripts/tests/story-import-test.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const SAVED = "docs/stories/.work-2026-10-30.json";
if (!existsSync(SAVED)) {
  console.log(`skipped: ${SAVED} isn't on this computer`);
  process.exit(0);
}

const saved = JSON.parse(readFileSync(SAVED, "utf8"));
const designs = {}, decoys = {};
for (const [k, v] of Object.entries(saved)) {
  const m = k.match(/^(key|decoys)-(\d+)$/);
  if (m?.[1] === "key") designs[m[2]] = v;
  if (m?.[1] === "decoys") decoys[m[2]] = v.decoys;
}
const s = saved.skeleton;
const filler = "The fog came in off the water and the keeper lit the lamp, as he had every night for thirty years. ".repeat(40);
const draft = {
  keys: s.keys.length, writer: "claude-code", picked: saved.picked, skeleton: s, designs, decoys, map: {},
  chapters: Object.fromEntries(s.chapters.map((c) => [c.n, { text: `${filler}\n\n${filler}`, leaks: [] }])),
  production: { style: "Cinematic painted thriller", characters: [{ name: "Tobias", look: "a tall old keeper" }], voices: [{ name: "Narrator", direction: "warm, slow" }], pictures: [{ chapter: 0, prompt: "Test prompt one." }, { chapter: 1, prompt: "Test prompt two." }, { chapter: 2, prompt: "Test prompt three." }] },
  spent: {}, done: false, log: [],
};
const file = `${tmpdir()}/loota-import-test.json`.replace(/\\/g, "/");
const run = (...args) => {
  try {
    return { ok: true, out: execFileSync("node", ["--no-warnings", "--import", "./scripts/tests/ts-ext.mjs", "scripts/story-engine/import.mts", ...args], { encoding: "utf8", timeout: 600_000 }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};
let hunt = null;
let outDir = null;
try {
  // 1. Check only
  writeFileSync(file, JSON.stringify(draft));
  const before = (await admin.from("hunts").select("id", { count: "exact", head: true })).count;
  const c = run(file, "--check");
  const after = (await admin.from("hunts").select("id", { count: "exact", head: true })).count;
  check("--check runs the free checks: every answer looked up on the map", /map, key 5/.test(c.out) && (c.out.match(/found:/g) ?? []).length === 5, c.out.split("\n").filter((l) => /^map/.test(l)).join(" | ").slice(0, 300));
  check("…and changes nothing", before === after);

  // 2. A chapter that names a key place is refused
  const leaky = structuredClone(draft);
  leaky.chapters[s.chapters[2].n].text += " They stood at last beneath Hook Lighthouse.";
  writeFileSync(file, JSON.stringify(leaky));
  const l = run(file, "--check");
  check("a chapter naming a key place is refused", !l.ok && /names Hook Lighthouse/.test(l.out), l.out.split("\n").find((x) => /names/.test(x)) ?? "");

  // 3. Into a waiting hunt
  const { data: h, error } = await admin.from("hunts").insert({
    title: "A new story hunt (waiting for its story)", prize: "Test prize (automated)", description: "", winners: 1, questions_per_trial: 3, seconds_per_question: 12,
    starts_at: new Date(Date.now() + 86400e3).toISOString(), ends_at: new Date(Date.now() + 86400e3 + 12 * 3600e3).toISOString(), keys_wanted: 5, story_status: "waiting",
  }).select("id").single();
  if (error) throw error;
  hunt = h.id;
  writeFileSync(file, JSON.stringify(draft));
  const imp = run(file, "--hunt", hunt, "--force"); // --force: the map may miss a few decoys (warnings), not a reason to stop the test
  outDir = imp.out.match(/PDFs: (\S+)\/story\.pdf/)?.[1] ?? null;
  const { data: made } = await admin.from("hunts").select("title, story_status, description").eq("id", hunt).single();
  check("imported: the hunt takes the story's title and is ready", made?.title === "The Keeper's Last Light" && made.story_status === "ready" && made.description.length > 20, `${made?.title} · ${made?.story_status}`);
  const { data: keys } = await admin.from("hunt_keys").select("n, riddle").eq("hunt_id", hunt);
  check("…a key at each real place", (keys ?? []).length === 5, `${(keys ?? []).length} keys`);
  const { data: pics } = await admin.from("story_pictures").select("n").eq("hunt_id", hunt);
  check("…a picture slot per prompt", (pics ?? []).length === 3);
  const { data: reg } = await admin.from("story_registry").select("title, decoys").eq("hunt_id", hunt);
  check("…recorded in the registry (so no later story reuses it)", reg?.length === 1 && reg[0].decoys.length > 100, `${reg?.[0]?.decoys.length ?? 0} decoys recorded`);
  check("…and the PDFs written", !!outDir && existsSync(`${outDir}/story.pdf`) && existsSync(`${outDir}/answers.pdf`), outDir ?? imp.out.slice(-300));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (hunt) {
    await admin.from("story_registry").delete().eq("hunt_id", hunt);
    await admin.from("hunts").delete().eq("id", hunt);
  }
  if (outDir) rmSync(outDir, { recursive: true, force: true });
  rmSync(file, { force: true });
  console.log(`test hunt, registry row and files deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}

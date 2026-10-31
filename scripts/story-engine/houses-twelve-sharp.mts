// The houses of "Twelve Sharp" (owner, 1 Nov 2026: "there shouldn't be open chest… we already agreed it is a house
// 3d"). The story was written before every key had a house; each right room is pointed to by a line the hunter has
// already read when they get there, and the trap rooms echo the near misses the story warns about.
// Checks each house (houseProblems), then saves it to the draft, the hunt's story and its key.
//   node --no-warnings --import ./scripts/tests/ts-ext.mjs scripts/story-engine/houses-twelve-sharp.mts
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { STORY_SHAPES, houseProblems, type HouseT } from "../../src/lib/story/engine.ts";

const HUNT = "45b94806-a16a-4e88-8eae-7337474a71f3";
const DRAFT = "docs/stories/drafts/2026-10-31-45b94806.json";

const HOUSES: Record<number, HouseT> = {
  // Chapter 1: "Aunty Ìyábọ̀ is waiting below it, at her indigo"; the card in a palm stained indigo to the wrist.
  // The trap: "he still owes me for the blue wrapper".
  1: {
    title: "Aunty Ìyábọ̀'s dye house",
    style: "cave",
    items: {},
    rooms: [
      { id: "wrappers", name: "The wrapper store", kind: "storeroom", role: "trap" },
      { id: "indigo", name: "The indigo room", kind: "kitchen", role: "right" },
      {
        id: "parlour", name: "The front parlour", kind: "parlour", role: "safe",
        objects: [{ id: "grandma", kind: "picture", label: "An old photograph", look: "A woman laughing in front of a great grey rock", found: "Grandma, young, at the foot of the rock. On the back, in pencil: 'Under the rock is home.'" }],
      },
    ],
  },
  // Chapter 2: "The light, Kemi. Only the light." And not "the old hotel with the long verandah, or the clock tower".
  2: {
    title: "The keeper's house under the light",
    style: "keeper",
    items: {},
    rooms: [
      { id: "verandah", name: "The long verandah", kind: "parlour", role: "trap" },
      {
        id: "clock", name: "The clock room", kind: "library", role: "trap",
        objects: [{ id: "stopped", kind: "clock", label: "A tall clock", look: "Its hands stopped at a quarter to ten" }],
      },
      { id: "lamp", name: "The lamp room", kind: "study", role: "right" },
    ],
  },
  // Chapter 3: "she keeps her card where the bells are seven times seven": the carillon of forty-nine bells, "at the
  // top of her tower among the bells". Not a ring of eight, not the organ.
  3: {
    title: "St Colman's tower",
    style: "stone",
    items: {},
    rooms: [
      { id: "sacristy", name: "The sacristy", kind: "storeroom", role: "safe" },
      { id: "ringers", name: "The ringers' room", kind: "chapel", role: "trap" },
      { id: "carillon", name: "The carillon", kind: "chapel", role: "right" },
      { id: "organ", name: "The organ loft", kind: "library", role: "trap" },
    ],
  },
  // Chapter 4: Lars "on the old ketch, the one with the green hull"; the painted houses, red and yellow and blue. The
  // engine room is the engineer's, and the wrong guess.
  4: {
    title: "The painted house on the canal",
    style: "cottage",
    items: {},
    rooms: [
      { id: "red", name: "The red room", kind: "parlour", role: "safe" },
      { id: "yellow", name: "The yellow room", kind: "kitchen", role: "trap" },
      { id: "green", name: "The green room", kind: "study", role: "right" },
      { id: "blue", name: "The blue room", kind: "bedroom", role: "trap" },
      { id: "engine", name: "The engine room", kind: "cellar", role: "trap" },
    ],
  },
  // Chapter 5: "Card five is in my coat." Among the cannons and the dry docks and the old stone walls.
  5: {
    title: "The fortress barracks",
    style: "fort",
    items: {},
    rooms: [
      { id: "cannon", name: "The cannon room", kind: "storeroom", role: "trap" },
      { id: "kitchen", name: "The barracks kitchen", kind: "kitchen", role: "safe" },
      { id: "dock", name: "The dry-dock office", kind: "study", role: "trap" },
      {
        id: "cloak", name: "The cloakroom", kind: "bedroom", role: "right",
        objects: [{ id: "coats", kind: "wardrobe", label: "A row of coats", look: "Heavy coats on pegs, one still damp from the ferry" }],
      },
      { id: "chapel", name: "The garrison chapel", kind: "chapel", role: "trap" },
    ],
  },
  // Chapter 6: "Gus Power, the cook". He talks about the weather; the lighthouse sees the sunrise first; the radio was
  // Kemi's father's. The cook keeps it in his galley.
  6: {
    title: "The light-keepers' house at the cape",
    style: "keeper",
    items: {},
    rooms: [
      { id: "lamp", name: "The lamp room", kind: "study", role: "trap" },
      { id: "bunks", name: "The bunk room", kind: "bedroom", role: "safe" },
      {
        id: "radio", name: "The radio room", kind: "study", role: "trap",
        objects: [{ id: "set", kind: "radio", label: "An old ship's radio", look: "Dials, a headset, a call sign scratched off" }],
      },
      { id: "galley", name: "The galley", kind: "kitchen", role: "right" },
      { id: "weather", name: "The weather room", kind: "library", role: "trap" },
      { id: "boats", name: "The boat store", kind: "storeroom", role: "safe" },
    ],
  },
  // Chapter 7: "I'm standing next to it. Right next to it." Not the top of the hill, not the old castle, not the
  // mountain; he sets his watch by the gun.
  7: {
    title: "The Lion Battery",
    style: "fort",
    items: {},
    rooms: [
      { id: "lookout", name: "The lookout at the top", kind: "study", role: "trap" },
      { id: "powder", name: "The powder store", kind: "cellar", role: "trap" },
      { id: "kitchen", name: "The gunners' kitchen", kind: "kitchen", role: "safe" },
      {
        id: "watch", name: "The watch room", kind: "library", role: "trap",
        objects: [{ id: "watches", kind: "clock", label: "A wall of clocks", look: "Every one of them a few seconds out" }],
      },
      { id: "gun", name: "The gun room", kind: "storeroom", role: "right" },
      { id: "castle", name: "The castle room", kind: "parlour", role: "trap" },
      { id: "bench", name: "The bench room", kind: "bedroom", role: "safe" },
    ],
  },
};

const problems: string[] = [];
for (const [n, h] of Object.entries(HOUSES)) {
  const shape = STORY_SHAPES.House.safeParse(h);
  if (!shape.success) problems.push(`key ${n}: ${shape.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  for (const p of houseProblems(h)) problems.push(`key ${n}: ${p}`);
}
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log("7 houses checked");

const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

const draft = JSON.parse(readFileSync(DRAFT, "utf8"));
for (const [n, h] of Object.entries(HOUSES)) draft.designs[n] = { ...draft.designs[n], house: h };
writeFileSync(DRAFT, JSON.stringify(draft, null, 2));

const { data: hunt, error } = await db.from("hunts").select("story").eq("id", HUNT).single();
if (error) throw error;
for (const [n, h] of Object.entries(HOUSES)) hunt.story.designs[n] = { ...hunt.story.designs[n], house: h };
const saved = await db.from("hunts").update({ story: hunt.story }).eq("id", HUNT);
if (saved.error) throw saved.error;
for (const [n, h] of Object.entries(HOUSES)) {
  const r = await db.from("hunt_keys").update({ house: h }).eq("hunt_id", HUNT).eq("n", Number(n));
  if (r.error) throw r.error;
}
const { data: keys } = await db.from("hunt_keys").select("n, house").eq("hunt_id", HUNT).order("n");
console.log(keys.map((k: { n: number; house: HouseT | null }) => `key ${k.n}: ${k.house?.title} (${k.house?.rooms.length} rooms)`).join("\n"));

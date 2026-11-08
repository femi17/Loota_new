// Each key's rooms have puzzles of their own, harder than the easiest (owner, 8 Nov 2026: "The key location. I get same
// puzzle for key 1 and key 2. Also, the questions are cheap not tasking"). For many made-up hunters: a room at key 1 and
// the same room at key 2 never share a puzzle; the same key and room give the same one every time; every room is made
// at level 2 or more (more words, items or a bigger board than before).
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/house-rooms-check.mts
import { makePuzzle } from "../../src/game/puzzles/index.ts";
import { roomKind, roomLevel, roomSeed } from "../../src/lib/house-rooms.ts";

let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};
const HUNT = "45ce2919-ed8d-4930-ae3c-24baf0fde5a1";
const made = (uid: string, key: number, room: number) => JSON.stringify(makePuzzle(roomKind(uid, HUNT, key, room), roomLevel(key), roomSeed(uid, HUNT, key, room)).puzzle);

let same = 0, kinds = 0, total = 0;
for (let i = 0; i < 200; i++) {
  const uid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  for (const room of [1, 2, 3, 4, 5]) {
    total++;
    if (made(uid, 1, room) === made(uid, 2, room)) same++;
    if (roomKind(uid, HUNT, 1, room) !== roomKind(uid, HUNT, 2, room)) kinds++;
  }
}
check("a room at key 1 and at key 2: never the same puzzle", same === 0, `${same} of ${total} the same`);
check("…and never the same kind of puzzle as that room at the key before", kinds === total, `${kinds} of ${total}`);
const uid = "d49dbcbc-8bd1-4ffa-bb5b-b1e6ff66e31e";
check("the same key and room: the same puzzle each time it's asked", made(uid, 2, 3) === made(uid, 2, 3));
// Owner, 8 Nov 2026: "remember all the users gets same category but different questions"
let sameKind = 0, ownPuzzle = 0, pairs = 0;
for (let i = 0; i < 100; i++) {
  const a = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, b = `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`;
  for (const key of [1, 2, 3]) for (const room of [1, 2, 3, 4, 5]) {
    pairs++;
    if (roomKind(a, HUNT, key, room) === roomKind(b, HUNT, key, room)) sameKind++;
    if (made(a, key, room) !== made(b, key, room)) ownPuzzle++;
  }
}
check("two hunters at the same room of a key: the same kind of puzzle", sameKind === pairs, `${sameKind} of ${pairs}`);
check("…each their own puzzle of it (different words, sums, boards)", ownPuzzle >= pairs * 0.9, `${ownPuzzle} of ${pairs} different`);
check("the rooms are never at the easiest level: 2 at keys 1–2, 3 from key 3", roomLevel(1) === 2 && roomLevel(2) === 2 && roomLevel(3) === 3 && roomLevel(6) === 3);
const words = (key: number) => (makePuzzle("vowels", roomLevel(key), 7).puzzle as { words: unknown[] }).words.length;
check("Lost Vowels: 4 words at the first keys, 5 from key 3 (was 3)", words(1) === 4 && words(3) === 5, `${words(1)}, ${words(3)}`);
let quick = 0;
for (let i = 0; i < 200; i++) for (const room of [1, 2, 3, 4, 5]) if (["flags", "brands"].includes(roomKind(`u${i}`, HUNT, 3, room))) quick++;
check("no quick picks (flags, brands) from key 3", quick === 0, `${quick}`);
const theme = (key: number) => (makePuzzle("vowels", roomLevel(key), 11).puzzle as { theme: string }).theme;
check("Lost Vowels at the keys: the harder themes", !["Money", "Fruit", "Colours", "Planets"].includes(theme(1)), theme(1));
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);

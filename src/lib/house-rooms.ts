import type { PuzzleKind } from "@/game/puzzles";

/**
 * The puzzles on the key's chest and the boxes in the town's houses (owner, 3 Nov 2026: "they complete the puzzle";
 * 4 Nov 2026: "Remove this sentrie game, replace with something else… grammar, simple algebra, type 5 coutries
 * starting with L, guess the flag… guess the brand"): each box's kind is drawn from these, its own for each hunter.
 * Used by the game's server only (/api/house/room). Its own for each key too (owner, 8 Nov 2026: "I get same puzzle for
 * key 1 and key 2"), and harder from key to key ("the questions are cheap not tasking"): roomLevel.
 */
export const ROOM_KINDS: PuzzleKind[] = ["grammar", "algebra", "countries", "flags", "brands", "vowels", "route", "threads", "sudoku"];

/** A seed from the hunter, the hunt, the key, the room and the try (the same puzzle every time they ask, a new one after
 * the time runs out, and another at the next key). */
export function roomSeed(uid: string, hunt: string, key: number, room: number, attempt = 0) {
  let n = 2166136261;
  for (const ch of `${uid}:${hunt}:${key}:${room}${attempt ? `:${attempt}` : ""}`) n = Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0;
  return n % 2147483646 || 1;
}

/** The kinds at a key: no quick picks (flags, brands) at the last keys (owner, 8 Nov 2026: "not tasking"). */
const kindsAt = (key: number) => (roomLevel(key) >= 3 ? ROOM_KINDS.filter((k) => k !== "flags" && k !== "brands") : ROOM_KINDS);

/** Which kind of puzzle a box is locked by at this key: the same for every hunter (owner, 8 Nov 2026: "all the users
 * gets same category but different questions"; each hunter's own puzzle of it comes from roomSeed), and never the kind
 * the same box had at the key before. `uid` is kept for the callers but no longer chooses the kind. */
export function roomKind(_uid: string, hunt: string, key: number, room: number): PuzzleKind {
  let n = roomSeed("", hunt, key, room) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b) >>> 0;
  const kinds = kindsAt(key);
  let k = kinds[n % kinds.length];
  if (key > 1 && k === roomKind("", hunt, key - 1, room)) k = kinds[(kinds.indexOf(k) + 1) % kinds.length];
  // The chain's three locks (rooms 1, 6, 7: owner, 12 Nov 2026) each of another kind
  const before = room === 6 ? [roomKind("", hunt, key, 1)] : room === 7 ? [roomKind("", hunt, key, 1), roomKind("", hunt, key, 6)] : [];
  while (before.includes(k)) k = kinds[(kinds.indexOf(k) + 1) % kinds.length];
  return k;
}

/** How hard: never the easiest (owner, 8 Nov 2026: "the questions are cheap not tasking"), the hardest from the third key. */
export const roomLevel = (key: number) => (key >= 3 ? 3 : 2);

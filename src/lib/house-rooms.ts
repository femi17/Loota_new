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

/** Which puzzle a box is locked by, for this hunter at this key (the same every time they come to it); never the kind
 * the same box had at the key before. */
export function roomKind(uid: string, hunt: string, key: number, room: number): PuzzleKind {
  let n = roomSeed(uid, hunt, key, room) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b) >>> 0;
  const kinds = kindsAt(key);
  const k = kinds[n % kinds.length];
  return key > 1 && k === roomKind(uid, hunt, key - 1, room) ? kinds[(kinds.indexOf(k) + 1) % kinds.length] : k;
}

/** How hard: never the easiest (owner, 8 Nov 2026: "the questions are cheap not tasking"), the hardest from the third key. */
export const roomLevel = (key: number) => (key >= 3 ? 3 : 2);

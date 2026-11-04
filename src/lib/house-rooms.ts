import type { PuzzleKind } from "@/game/puzzles";

/**
 * The puzzles on the key's chest and the boxes in the town's houses (owner, 3 Nov 2026: "they complete the puzzle";
 * 4 Nov 2026: "Remove this sentrie game, replace with something else… grammar, simple algebra, type 5 coutries
 * starting with L, guess the flag… guess the brand"): each box's kind is drawn from these, its own for each hunter,
 * at its easiest. Used by the game's server only (/api/house/room).
 */
export const ROOM_KINDS: PuzzleKind[] = ["grammar", "algebra", "countries", "flags", "brands", "vowels", "route", "threads", "sudoku"];

/** A seed from the hunter, the hunt, the room and the try (the same puzzle every time they ask, a new one after the
 * time runs out). */
export function roomSeed(uid: string, hunt: string, room: number, attempt = 0) {
  let n = 2166136261;
  for (const ch of `${uid}:${hunt}:${room}${attempt ? `:${attempt}` : ""}`) n = Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0;
  return n % 2147483646 || 1;
}

/** Which puzzle a box is locked by, for this hunter (the same every time they come to it). */
export function roomKind(uid: string, hunt: string, room: number): PuzzleKind {
  let n = roomSeed(uid, hunt, room) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b) >>> 0;
  return ROOM_KINDS[n % ROOM_KINDS.length];
}

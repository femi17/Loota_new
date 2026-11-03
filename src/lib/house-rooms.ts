import type { PuzzleKind } from "@/game/puzzles";

/**
 * The five rooms of the treasure building, each shut by a quick puzzle (owner, 3 Nov 2026: "we open the roof of the
 * building, and they complete the puzzle"): from three kinds of puzzle (logic, a path, words), a different one in
 * each room, at its easiest. Used by the game's server only (/api/house/room).
 */
export const ROOM_KINDS: PuzzleKind[] = ["sentries", "route", "vowels", "threads", "sudoku"];

/** A seed from the hunter, the hunt and the room (the same puzzle every time they ask). */
export function roomSeed(uid: string, hunt: string, room: number) {
  let n = 2166136261;
  for (const ch of `${uid}:${hunt}:${room}`) n = Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0;
  return n % 2147483646 || 1;
}

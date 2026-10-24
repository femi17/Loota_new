/**
 * Torn Map (a Key Trial puzzle, owner 24 Oct 2026: "different kinds of mini puzzle game"): the real streets around the
 * key, drawn as an old map and torn into squares, scattered (and, at later keys, turned). Put the map back together.
 * Pieces that look the same (two empty corners) may sit either way round: the check compares what each square shows,
 * not which piece it is. The drawing is made by the game's server from our own road data (tornmap-drawing.ts).
 */
import { seeded } from "./rng.ts";

/** A street: points (x, y, x, y, … in 0–1, y down) and how wide (1 lane, 2 street, 3 main road). */
export type MapLine = { pts: number[]; w: 1 | 2 | 3 };
/** A street's name, where to write it, and at what angle (degrees). */
export type MapName = { x: number; y: number; angle: number; text: string };
export type MapDrawing = { lines: MapLine[]; names: MapName[] };
/** What the player sees: the drawing, the grid, whether pieces are turned, and where each piece starts ([piece, quarter turns] per square). */
export type TornMapPuzzle = MapDrawing & { n: number; rotate: boolean; start: [number, number][] };
/** The answer: for each square, the piece put there and its quarter turns clockwise. */
export type TornMapAnswer = [number, number][];

const RES = 10; // each piece's picture, as a 10 × 10 grid of inked or blank, to compare pieces

/** Which of each piece's little squares have ink on them (any street passing). */
export function pieceInk(d: MapDrawing, n: number): string[] {
  const ink = [...Array(n * n)].map(() => new Uint8Array(RES * RES));
  const mark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return;
    const c = Math.floor(x * n), r = Math.floor(y * n);
    const lx = Math.floor((x * n - c) * RES), ly = Math.floor((y * n - r) * RES);
    ink[r * n + c][ly * RES + lx] = 1;
  };
  for (const line of d.lines) {
    for (let k = 2; k < line.pts.length; k += 2) {
      const [x1, y1, x2, y2] = [line.pts[k - 2], line.pts[k - 1], line.pts[k], line.pts[k + 1]];
      const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * n * RES * 2) + 1;
      for (let s = 0; s <= steps; s++) mark(x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps);
    }
  }
  return ink.map((b) => Array.from(b).join(""));
}

/** A piece's picture turned `q` quarter turns clockwise. */
function turn(pic: string, q: number) {
  let cur = pic;
  for (let t = 0; t < ((q % 4) + 4) % 4; t++) {
    let next = "";
    for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) next += cur[(RES - 1 - x) * RES + y];
    cur = next;
  }
  return cur;
}

/** The puzzle: the map torn into n × n pieces (3 at level 1, then 4; turned at level 3), scattered from a seed. */
export function makeTornMap(seed: number, level: number, drawing: MapDrawing): { puzzle: TornMapPuzzle; answer: TornMapAnswer } {
  const rng = seeded(seed);
  const n = level <= 1 ? 3 : 4;
  const rotate = level >= 3;
  const pics = pieceInk(drawing, n);
  // Scatter until no more than one piece is already where (and how) it belongs.
  let start: [number, number][] = [];
  for (let tries = 0; tries < 200; tries++) {
    const order = rng.shuffle([...Array(n * n).keys()]);
    start = order.map((p) => [p, rotate ? rng.int(4) : 0]);
    const inPlace = start.filter(([p, q], i) => turn(pics[p], q) === pics[i]).length;
    if (inPlace <= 1) break;
  }
  return { puzzle: { ...drawing, n, rotate, start }, answer: [...Array(n * n).keys()].map((i) => [i, 0]) };
}

/** Is the map whole? Every square shows what belongs there (each piece used once). */
export function checkTornMap(p: TornMapPuzzle, placed: TornMapAnswer): boolean {
  const { n } = p;
  if (!Array.isArray(placed) || placed.length !== n * n) return false;
  const used = new Set<number>();
  for (const pq of placed) {
    if (!Array.isArray(pq) || pq.length !== 2 || !Number.isInteger(pq[0]) || !Number.isInteger(pq[1])) return false;
    if (pq[0] < 0 || pq[0] >= n * n || used.has(pq[0])) return false;
    if (!p.rotate && pq[1] % 4 !== 0) return false;
    used.add(pq[0]);
  }
  const pics = pieceInk(p, n);
  return placed.every(([piece, q], i) => turn(pics[piece], q) === pics[i]);
}

/** How many pieces have ink at all (a map with too few streets makes a poor puzzle). */
export function inkedPieces(d: MapDrawing, n: number) {
  return pieceInk(d, n).filter((pic) => pic.includes("1")).length;
}

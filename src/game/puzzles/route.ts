/**
 * Route (a Key Trial puzzle, after LinkedIn's Zip): draw one unbroken route through every square of the grid, moving
 * up, down, left or right, passing the numbered landmarks in order from 1 to the last, never through a wall. Each
 * puzzle has exactly one route.
 */
import { seeded, type Rng } from "./rng.ts";

/**
 * What the player sees: the grid's size, the numbered squares (square index → number, 1 first) and the walls (pairs of
 * side-by-side squares with a wall between them).
 */
export type RoutePuzzle = { n: number; numbers: Record<number, number>; walls: [number, number][] };
/** The answer: the squares in the order the route passes them. */
export type RouteAnswer = number[];

const wallKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Each square's neighbours, with the walls taken out. */
function adjacency(n: number, walls: [number, number][]) {
  const blocked = new Set(walls.map(([a, b]) => wallKey(a, b)));
  return [...Array(n * n).keys()].map((i) => {
    const r = Math.floor(i / n), c = i % n;
    const out: number[] = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out.filter((j) => !blocked.has(wallKey(i, j)));
  });
}

/** A random route through every square (backtracking, preferring squares with few ways on: Warnsdorff). */
function randomPath(n: number, rng: Rng): number[] | null {
  const adj = adjacency(n, []);
  const total = n * n;
  const seen = new Uint8Array(total);
  const path: number[] = [];
  let budget = 200000;
  const onward = (i: number) => adj[i].filter((j) => !seen[j]).length;
  const go = (i: number): boolean => {
    if (--budget < 0) return false;
    seen[i] = 1;
    path.push(i);
    if (path.length === total) return true;
    const next = rng.shuffle(adj[i].filter((j) => !seen[j])).sort((a, b) => onward(a) - onward(b));
    for (const j of next) if (go(j)) return true;
    seen[i] = 0;
    path.pop();
    return false;
  };
  return go(rng.int(total)) ? path : null;
}

/**
 * The routes (up to `max`) that start on 1, pass the numbers in order, end on the last and cover every square.
 * `budget`: how many steps to try; past it the answer is "don't know" (null).
 */
export function solveRoute(p: RoutePuzzle, max = 2, budget = 300000): RouteAnswer[] | null {
  const { n, numbers } = p;
  const total = n * n;
  const adj = adjacency(n, p.walls ?? []);
  const numberAt = new Int16Array(total);
  let last = 0, start = -1, end = -1;
  for (const [cell, num] of Object.entries(numbers)) {
    numberAt[Number(cell)] = num;
    if (num === 1) start = Number(cell);
    if (num > last) {
      last = num;
      end = Number(cell);
    }
  }
  if (start < 0) return [];
  const seen = new Uint8Array(total);
  const path: number[] = [];
  const found: RouteAnswer[] = [];
  const queue = new Int16Array(total);
  const mark = new Uint8Array(total);
  let steps = 0;
  let gaveUp = false;

  /** Can the rest still be done from `head`? No square stranded, and only the end may be a dead end. */
  const hopeful = (head: number, left: number) => {
    if (left === 0) return true;
    // Dead ends: an unvisited square with one way in and out (counting the head) must be the end.
    for (let i = 0; i < total; i++) {
      if (seen[i]) continue;
      let free = 0;
      for (const k of adj[i]) if (!seen[k] || k === head) free++;
      if (free === 0 || (free === 1 && i !== end)) return false;
    }
    // Every unvisited square reachable from the head.
    mark.fill(0);
    let qh = 0, qt = 0, reached = 0;
    for (const k of adj[head]) {
      if (!seen[k] && !mark[k]) {
        mark[k] = 1;
        queue[qt++] = k;
      }
    }
    while (qh < qt) {
      const i = queue[qh++];
      reached++;
      for (const k of adj[i]) {
        if (!seen[k] && !mark[k]) {
          mark[k] = 1;
          queue[qt++] = k;
        }
      }
    }
    return reached === left;
  };

  const go = (i: number, want: number) => {
    if (found.length >= max || gaveUp) return;
    if (++steps > budget) {
      gaveUp = true;
      return;
    }
    seen[i] = 1;
    path.push(i);
    const nextWant = numberAt[i] === want ? want + 1 : want;
    const left = total - path.length;
    if (left === 0) {
      if (i === end) found.push([...path]);
    } else if (i !== end && hopeful(i, left)) {
      for (const j of adj[i]) {
        if (seen[j]) continue;
        const m = numberAt[j];
        if (m && m !== nextWant) continue; // numbers in order only
        go(j, nextWant);
      }
    }
    seen[i] = 0;
    path.pop();
  };
  go(start, 1);
  return gaveUp ? null : found;
}

/**
 * A puzzle with exactly one route, `n` squares a side (5 to 7); `keep`: about how many numbers to leave (fewer is
 * harder); walls are added where another route would sneak through.
 */
export function makeRoute(seed: number, n: number, keep = n + 1): { puzzle: RoutePuzzle; answer: RouteAnswer } {
  const rng = seeded(seed);
  const total = n * n;
  for (let tries = 0; tries < 40; tries++) {
    const path = randomPath(n, rng);
    if (!path) continue;
    const used = new Set<string>();
    for (let k = 1; k < total; k++) used.add(wallKey(path[k - 1], path[k]));
    const stops = new Set<number>([0, total - 1]);
    while (stops.size < Math.min(keep, total)) stops.add(1 + rng.int(total - 2));
    const walls: [number, number][] = [];
    const puzzleOf = (): RoutePuzzle => {
      const numbers: Record<number, number> = {};
      [...stops].sort((a, b) => a - b).forEach((idx, k) => (numbers[path[idx]] = k + 1));
      return { n, numbers, walls: [...walls] };
    };
    // Close the gaps another route sneaks through: a wall across its first step off our route (or, now and then, one
    // more number), until our route is the only one.
    let unique = false;
    for (let fix = 0; fix < 60; fix++) {
      const found = solveRoute(puzzleOf(), 2);
      if (found && found.length === 1) {
        unique = true;
        break;
      }
      if (!found) {
        stops.add(1 + rng.int(total - 2)); // too open to tell quickly: one more number
        continue;
      }
      const other = found.find((f) => f.some((cell, k) => cell !== path[k]))!;
      const k = other.findIndex((cell, idx) => cell !== path[idx]);
      const a = other[k - 1], b = other[k];
      if (rng.next() < 0.75 && !used.has(wallKey(a, b))) walls.push([a, b]);
      else stops.add(k);
    }
    if (!unique) continue;
    // Then take numbers away again while the route stays the only one.
    for (const idx of rng.shuffle([...stops].filter((s) => s !== 0 && s !== total - 1))) {
      if (stops.size <= keep) break;
      stops.delete(idx);
      const found = solveRoute(puzzleOf(), 2);
      if (!found || found.length !== 1) stops.add(idx);
    }
    return { puzzle: puzzleOf(), answer: path };
  }
  throw new Error(`No unique Route puzzle for seed ${seed}`);
}

/** Is this route right? Every square once, each step to a neighbour (not through a wall), the numbers in order. */
export function checkRoute(p: RoutePuzzle, route: number[]): boolean {
  const { n, numbers } = p;
  const total = n * n;
  const adj = adjacency(n, p.walls ?? []);
  if (!Array.isArray(route) || route.length !== total) return false;
  if (route.some((i) => !Number.isInteger(i) || i < 0 || i >= total) || new Set(route).size !== total) return false;
  for (let k = 1; k < total; k++) if (!adj[route[k - 1]].includes(route[k])) return false;
  const last = Math.max(...Object.values(numbers));
  let want = 1;
  for (const cell of route) {
    const num = numbers[cell];
    if (num === undefined) continue;
    if (num !== want) return false;
    want++;
  }
  return want === last + 1 && numbers[route[0]] === 1 && numbers[route[total - 1]] === last;
}

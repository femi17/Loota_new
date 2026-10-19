// Mate-in-one puzzles for the roadside chess player (owner, 19 Oct 2026: "let them play a game, like mate in 1"):
// natural-looking positions (castled kings behind their pawns, a few attackers and defenders), each checked with
// chess.js to have EXACTLY ONE mating move for White, at least one other check to tempt you, no promotions, and
// neither king already in check. Same seed, same puzzles.
//   node scripts/build-chess-puzzles.mjs [count=60] > supabase/migrations/<version>_chess_puzzles_data.sql
import { Chess } from "chess.js";

const COUNT = Number(process.argv[2] ?? 60);
let seed = 20261019;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const FILES = "abcdefgh";
const sq = (f, r) => `${FILES[f]}${r}`;

// Black's king corners and pawn shields; White's king safe at home.
const BLACK_HOMES = [
  { k: "g8", pawns: [["f7", "g7", "h7"], ["f7", "g6", "h7"], ["f7", "g7", "h6"], ["f6", "g7", "h7"], ["g7", "h7"], ["f7", "g7"]] },
  { k: "h8", pawns: [["g7", "h7"], ["f7", "g7", "h7"], ["g6", "h7"]] },
  { k: "c8", pawns: [["a7", "b7", "c7"], ["b7", "c7"], ["a7", "b7"]] },
  { k: "e8", pawns: [["d7", "e7", "f7"], ["e7", "f7"], ["d7", "f7"]] },
];
const WHITE_HOME = { k: "g1", pawns: ["f2", "g2", "h2"] };
const ATTACK_SETS = [["Q"], ["R"], ["Q", "R"], ["R", "R"], ["Q", "B"], ["R", "B"], ["Q", "N"], ["R", "N"], ["B", "N"], ["Q", "B", "N"], ["R", "B", "N"]];
const DEFENCE_SETS = [[], ["r"], ["b"], ["n"], ["q"], ["r", "b"], ["r", "n"], ["b", "n"], ["r", "r"]];

function toFen(board) {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board.get(sq(f, r));
      if (p) {
        if (empty) row += empty;
        row += p;
        empty = 0;
      } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} w - - 0 1`;
}

/** A free square, optionally within `near.max` (and at least `near.min`) king steps of `near.at`. */
function freeSquare(board, avoidRanks = [], near = null) {
  for (let tries = 0; tries < 200; tries++) {
    const f = Math.floor(rand() * 8);
    const r = 1 + Math.floor(rand() * 8);
    if (avoidRanks.includes(r)) continue;
    if (near) {
      const d = Math.max(Math.abs(f - FILES.indexOf(near.at[0])), Math.abs(r - Number(near.at[1])));
      if (d > near.max || d < near.min) continue;
    }
    const s = sq(f, r);
    if (!board.has(s)) return s;
  }
  return null;
}

const found = new Map(); // fen -> puzzle
const byPiece = {};
for (let attempt = 0; attempt < 400000 && found.size < COUNT; attempt++) {
  if (attempt % 5000 === 0) process.stderr.write(`${attempt} tried, ${found.size} found
`);
  const board = new Map();
  const home = pick(BLACK_HOMES);
  board.set(home.k, "k");
  for (const p of pick(home.pawns)) board.set(p, "p");
  board.set(WHITE_HOME.k, "K");
  for (const p of WHITE_HOME.pawns) if (rand() < 0.85) board.set(p, "P");
  let ok = true;
  for (const piece of pick(ATTACK_SETS)) {
    // Attackers within striking range of the black king (queens and rooks may stand further off, on open lines).
    const s = freeSquare(board, [], { at: home.k, min: 2, max: piece === "N" ? 3 : piece === "B" ? 5 : 7 });
    if (!s) ok = false;
    else board.set(s, piece);
  }
  for (const piece of pick(DEFENCE_SETS)) {
    const s = freeSquare(board, [1], { at: home.k, min: 1, max: 3 });
    if (!s) ok = false;
    else board.set(s, piece);
  }
  // A couple of pawns elsewhere, as in a real game.
  for (let i = 0; i < Math.floor(rand() * 3); i++) {
    const s = freeSquare(board, [1, 8]);
    if (s) board.set(s, rand() < 0.5 ? "P" : "p");
  }
  if (!ok) continue;
  const fen = toFen(board);
  let game;
  try {
    game = new Chess(fen);
  } catch {
    continue; // illegal (e.g. pawns on the back rank)
  }
  if (game.isCheck()) continue; // White mustn't start in check
  // Black mustn't be in check either: it would be White's move with Black in check.
  const flipped = new Chess(fen.replace(" w ", " b "), { skipValidation: true });
  if (flipped.isCheck()) continue;
  const moves = game.moves({ verbose: true });
  if (moves.length < 12) continue;
  if (moves.some((m) => m.promotion)) continue;
  const mates = [];
  let checks = 0;
  for (const m of moves) {
    game.move(m);
    if (game.isCheckmate()) mates.push(m);
    else if (game.isCheck()) checks++;
    game.undo();
  }
  if (mates.length !== 1 || checks < 1) continue;
  const m = mates[0];
  // Variety: not too many mates by the same piece.
  const kind = m.piece.toUpperCase();
  if ((byPiece[kind] ?? 0) >= Math.ceil(COUNT * 0.7)) continue;
  byPiece[kind] = (byPiece[kind] ?? 0) + 1;
  found.set(fen, { fen, solution: `${m.from}${m.to}`, san: m.san });
}

const list = [...found.values()];
if (process.env.JSON) {
  console.log(JSON.stringify(list, null, 1));
} else {
  console.log(`-- ${list.length} mate-in-one puzzles, generated and checked by scripts/build-chess-puzzles.mjs (chess.js): exactly one
-- mating move each (White to move), at least one other check, no promotions. Mates by: ${JSON.stringify(byPiece)}.`);
  console.log("insert into public.chess_puzzles (fen, solution, san) values");
  console.log(list.map((p) => `  ('${p.fen}', '${p.solution}', '${p.san.replace(/'/g, "''")}')`).join(",\n") + ";");
}

// Every puzzle at a key's place (and the Key Trial) has an answer the game accepts (owner, 9 Nov 2026: "verify the
// questions in the key location actually have an asnwer. I solved one and it said all the answers are wrong, same
// happened with the english too yesterday"). For each kind and level, 300 puzzles: the answer the puzzle was made
// with, sent as the hunter's board sends it, must be accepted; a question with a choice must have its right answer
// once and only once among different options; an equation must hold for its x and no other whole number.
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/puzzle-answers-check.mts
import { PICKED_KINDS, checkPuzzle, makePuzzle, type AnyPuzzle, type PuzzleKind } from "../../src/game/puzzles/index.ts";

let fails = 0;
const problems = new Map<string, string[]>();
const note = (what: string, example: string) => {
  fails++;
  const list = problems.get(what) ?? [];
  if (list.length < 3) list.push(example);
  problems.set(what, list);
};

/** The answer as the hunter's board sends it (the boards hand over what they hold: typed numbers as text). */
function asSent(kind: PuzzleKind, answer: unknown): unknown {
  if (kind === "algebra") return (answer as number[]).map(String);
  return answer;
}

/** Does `x` make the equation as shown true? ("3x + 4 = 19", "5x − 7 = 18", "4(x + 3) = 28", "8x + 20 = 2x + 50", "(x + 5) ÷ 3 = 4") */
function holds(equation: string, x: number) {
  const js = (side: string) =>
    side
      .replace(/−/g, "-")
      .replace(/÷/g, "/")
      .replace(/(\d)x/g, "$1*x")
      .replace(/(\d)\(/g, "$1*(")
      .replace(/x/g, `(${x})`);
  const [l, r] = equation.split("=");
  return Math.abs(Function(`return ${js(l)}`)() - Function(`return ${js(r)}`)()) < 1e-9;
}

for (const kind of PICKED_KINDS) {
  let made = 0;
  for (const level of [1, 2, 3]) {
    for (let seed = 1; seed <= 300; seed++) {
      let m: { puzzle: AnyPuzzle; answer: unknown };
      try {
        m = makePuzzle(kind, level, seed * 7919 + level);
      } catch (e) {
        note(`${kind}: couldn't be made`, `level ${level}, seed ${seed}: ${(e as Error).message}`);
        continue;
      }
      made++;
      const id = `level ${level}, seed ${seed}`;
      if (!checkPuzzle(kind, m.puzzle, asSent(kind, m.answer), m.answer)) note(`${kind}: its own answer is refused`, `${id}: ${JSON.stringify(m.answer).slice(0, 100)}`);
      const items = (m.puzzle as { items?: { options?: string[]; equation?: string; sentence?: string; clue?: string }[] }).items;
      if (items && Array.isArray(m.answer)) {
        items.forEach((it, i) => {
          const right = (m.answer as number[])[i];
          if (it.options) {
            if (new Set(it.options.map((o) => o.trim().toLowerCase())).size !== it.options.length) note(`${kind}: the same option twice`, `${id}: ${JSON.stringify(it.options)}`);
            if (!(right >= 0 && right < it.options.length)) note(`${kind}: the right answer isn't among the options`, `${id}: ${JSON.stringify(it)} → ${right}`);
          }
          if (it.equation) {
            if (!holds(it.equation, right)) note(`algebra: the equation doesn't hold for its x`, `${id}: ${it.equation}, x = ${right}`);
            const others = [];
            for (let x = -50; x <= 200; x++) if (x !== right && holds(it.equation, x)) others.push(x);
            if (others.length) note(`algebra: another x also works`, `${id}: ${it.equation}, x = ${right}, also ${others.slice(0, 3)}`);
          }
        });
      }
    }
  }
  console.log(`${kind}: ${made} made`);
}
for (const [what, examples] of problems) console.log(`FAIL  ${what}\n        ${examples.join("\n        ")}`);
console.log(fails ? `${fails} problems` : "all accepted");
process.exit(fails ? 1 : 0);

// The broadcast's auto camera (owner, 9 Nov 2026: "When i put it on auto view… it shows a users, then back to the map to
// shows all users, then it went straight back to the same user it has shown before. I think the logic is broken"):
// three hunters each have a turn, leaders first, then the whole field, then a new round (never with whoever was on
// screen just before the field); one hunter: the camera stays on them; someone doing something goes next, never the one on screen.
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/autocam-check.mts
import { nextAutoView } from "../../src/game/autocam.ts";

let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};
/** Turns the camera takes from `start`, with `here` on the map. */
function turns(here: string[], start: string, n: number, wantAt: Record<number, string> = {}) {
  const seen = new Set<string>();
  let cur = start, last: string | null = null;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    cur = nextAutoView(here, cur, seen, wantAt[i] ?? null, last);
    if (cur !== "field") last = cur;
    out.push(cur);
  }
  return out;
}

const three = turns(["ada", "bayo", "chi"], "field", 9);
check("three hunters: each in turn, leaders first, then the field, then a new round", three.join(" ") === "ada bayo chi field ada bayo chi field ada", three.join(" → "));
const afterField = (list: string[]) => list.every((v, i) => !(i >= 2 && list[i - 1] === "field" && v === list[i - 2]));
check("…never straight back to the one shown just before the field", afterField(three));
check("…never the same hunter twice in a row", three.every((v, i) => i === 0 || v === "field" || v !== three[i - 1]));
const one = turns(["ada"], "field", 4);
check("one hunter: the camera stays on them (no back and forth to the field)", one.every((v) => v === "ada"), one.join(" → "));
const two = turns(["ada", "bayo"], "field", 6);
check("two hunters: each in turn, the field between rounds, never straight back to the one before the field", two.join(" ") === "ada bayo field ada bayo field" && afterField(two), two.join(" → "));
const wanted = turns(["ada", "bayo", "chi"], "field", 4, { 1: "chi" });
check("someone doing something goes next", wanted[1] === "chi" && wanted[2] === "bayo", wanted.join(" → "));
const self = turns(["ada", "bayo", "chi"], "field", 2, { 1: "ada" });
check("…but never the one already on screen", self[1] !== "ada", self.join(" → "));
check("nobody on the map: the field", turns([], "ada", 1)[0] === "field");
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);

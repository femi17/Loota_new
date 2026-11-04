/**
 * Grammar (owner, 4 Nov 2026: "we can have grammar"): four sentences, each with a gap and a few words to fill it;
 * pick the right one for each. The everyday mix-ups of English (their/there, its/it's, fewer/less…). The right words
 * stay on the game's server.
 */
import { seeded } from "./rng.ts";

export type GrammarPuzzle = { items: { sentence: string; options: string[] }[] };
export type GrammarAnswer = number[];

/** [the sentence (___ for the gap), the right word, the wrong ones] */
const BANK: [string, string, string[]][] = [
  ["The children left ___ bags at the door.", "their", ["there", "they're"]],
  ["Put the box over ___, by the window.", "there", ["their", "they're"]],
  ["___ going to the match on Saturday.", "They're", ["Their", "There"]],
  ["The dog wagged ___ tail.", "its", ["it's"]],
  ["___ raining again this morning.", "It's", ["Its"]],
  ["Is this ___ phone on the table?", "your", ["you're"]],
  ["___ late for the bus!", "You're", ["Your"]],
  ["She is taller ___ her brother.", "than", ["then"]],
  ["We ate, and ___ we went home.", "then", ["than"]],
  ["There are ___ cars on the road on Sundays.", "fewer", ["less"]],
  ["I drink ___ coffee than I used to.", "less", ["fewer"]],
  ["He gave the tickets to Ada and ___.", "me", ["I", "myself"]],
  ["Ada and ___ went to the market.", "I", ["me", "myself"]],
  ["The weather will ___ the harvest.", "affect", ["effect"]],
  ["The new rule had a big ___ on prices.", "effect", ["affect"]],
  ["She ___ the book on the table.", "laid", ["lay", "lied"]],
  ["I could ___ helped you, if you'd asked.", "have", ["of"]],
  ["Neither of the boys ___ ready.", "is", ["are"]],
  ["Everyone ___ their own seat.", "has", ["have"]],
  ["The team ___ won every game this year.", "has", ["have", "is"]],
  ["She speaks English very ___.", "well", ["good"]],
  ["He felt ___ after the long walk.", "tired", ["tiring"]],
  ["We waited for ___ hour.", "an", ["a"]],
  ["She is ___ honest woman.", "an", ["a"]],
  ["He wants to be ___ engineer.", "an", ["a"]],
  ["It was ___ unique idea.", "a", ["an"]],
  ["I have lived here ___ 2019.", "since", ["for", "from"]],
  ["I have lived here ___ five years.", "for", ["since", "from"]],
  ["The keys are ___ the drawer.", "in", ["on", "at"]],
  ["We met ___ Monday.", "on", ["in", "at"]],
  ["The film starts ___ eight o'clock.", "at", ["in", "on"]],
  ["She was born ___ 1998.", "in", ["on", "at"]],
  ["If I ___ rich, I'd buy a boat.", "were", ["was", "am"]],
  ["He ___ to school every day.", "goes", ["go", "going"]],
  ["They ___ football yesterday.", "played", ["play", "plays"]],
  ["I have ___ that film twice.", "seen", ["saw", "see"]],
  ["She has ___ a letter to her aunt.", "written", ["wrote", "write"]],
  ["The bell ___ at noon.", "rang", ["rung", "ringed"]],
  ["We ___ the whole cake last night.", "ate", ["eaten", "eated"]],
  ["Who ___ the window?", "broke", ["broken", "breaked"]],
  ["This is the ___ day of my life!", "best", ["goodest", "better"]],
  ["A bus is ___ than a car.", "bigger", ["more big", "biggest"]],
  ["That was the ___ exam of the year.", "hardest", ["most hard", "harder"]],
  ["Please be ___ with that glass.", "careful", ["carefully", "care"]],
  ["She sang ___ at the wedding.", "beautifully", ["beautiful", "beauty"]],
  ["The two sisters help each ___.", "other", ["another", "others"]],
  ["Can you ___ me your pen?", "lend", ["borrow"]],
  ["May I ___ your umbrella?", "borrow", ["lend"]],
  ["___ book is this? It has no name.", "Whose", ["Who's"]],
  ["___ coming to the party tonight?", "Who's", ["Whose"]],
  ["The news ___ good today.", "is", ["are"]],
  ["Two plus two ___ four.", "makes", ["make", "making"]],
];

/** A puzzle of `count` sentences (4 at every key: quick enough for a minute). */
export function makeGrammar(seed: number, count = 4): { puzzle: GrammarPuzzle; answer: GrammarAnswer } {
  const rng = seeded(seed);
  const picked = rng.shuffle(BANK).slice(0, count);
  const items = picked.map(([sentence, right, wrong]) => {
    const options = rng.shuffle([right, ...wrong]);
    return { sentence, options, right: options.indexOf(right) };
  });
  return { puzzle: { items: items.map(({ sentence, options }) => ({ sentence, options })) }, answer: items.map((i) => i.right) };
}

/** Every gap filled with the right word. */
export function checkGrammar(solution: GrammarAnswer, answer: GrammarAnswer) {
  return Array.isArray(answer) && answer.length === solution.length && answer.every((a, i) => Number(a) === solution[i]);
}

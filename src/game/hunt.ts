/**
 * Hunts (design doc section 6): the shapes the hunt functions in the database
 * return. Riddles for later keys, key spots and trial answers never reach the
 * browser; the server reveals each step as it's earned.
 */

export type HuntPhase = "draft" | "upcoming" | "live" | "ended";

/**
 * The riddle clock (owner, 25 Oct 2026): 15 seconds to name the place from when the hunter first sees the riddle, then
 * a 60-second wait before the next 15, until they lock one in. Times are the server's.
 */
export type RiddleClock =
  | { phase: "ready"; key: number }
  | { phase: "answer"; key: number; now: string; endsAt: string }
  | { phase: "wait"; key: number; now: string; until: string }
  | { phase: "locked"; key: number; guess: { name: string; lng: number; lat: number } };

export type HuntSummary = {
  id: string;
  title: string;
  prize: string;
  description: string;
  winners: number;
  startsAt: string;
  endsAt: string;
  phase: HuntPhase;
  keys: number;
  players: number;
  joined: boolean;
};

/**
 * A Key Trial that's a puzzle (owner, 24 Oct 2026): the puzzle (null until the game's server makes it, when the phone
 * asks: /api/trial/puzzle), the lives left and the clock (null until then). Never the answer.
 */
export type PuzzleTrialView = {
  attempt: string;
  key: number;
  kind: "puzzle";
  puzzleKind: "sentries" | "route" | "adire" | "tornmap";
  /** 1 for early keys, 3 for the last: bigger boards, fewer clues, and no warnings when a rule is broken. */
  level: number;
  puzzle: unknown;
  lives: number;
  seconds: number;
  secondsLeft: number | null;
};
/** A Key Trial: a quiz question, or a puzzle. */
export type AnyTrialView = TrialView | PuzzleTrialView;

/** The current question of a Key Trial (never the answer). */
export type TrialView = {
  kind?: undefined;
  attempt: string;
  key: number;
  index: number;
  count: number;
  prompt: string;
  choices: string[];
  /** Shown with the question (a row of fruit to count), or first, to memorise, for `showSeconds` (then hidden). */
  show?: string | null;
  showSeconds?: number;
  seconds: number;
  /** Including any memorising time still to come. */
  secondsLeft: number;
};

export type HuntState = {
  id: string;
  title: string;
  prize: string;
  winners: number;
  startsAt: string;
  endsAt: string;
  phase: HuntPhase;
  keys: number;
  joined: boolean;
  keysHeld: number;
  finishedAt: string | null;
  place: number | null;
  winnersFound: number;
  riddle: string | null;
  /** On a relay's trail: the last chest held a clue, not the key (owner, 24 Oct 2026). */
  trail?: boolean;
  /** The next key's trial: a quiz (in `category`), one puzzle, or "puzzle" (one at random). */
  trialKind?: "quiz" | "sentries" | "route" | "adire" | "tornmap" | "puzzle" | null;
  category: TrialCategory | null;
  /** The Final Approach clue, once the player has reached the key's area. */
  clue: string | null;
  trial: AnyTrialView | null;
  /** Set when a trial ran out while the player was away: where they were thrown. */
  thrown: { lng: number; lat: number } | null;
};

export type SearchResult =
  | { ok: true; result: "trial"; trial: AnyTrialView }
  | { ok: true; result: "area"; clue: string; band: string }
  | { ok: true; result: "cold"; band: string }
  | { ok: false; reason: "not_live" | "not_joined" | "finished" | "wait" | "no_key" | "answer_first" }
  | { ok: false; reason: "thrown"; lng: number; lat: number }
  | { ok: false; reason: "position"; lng: number; lat: number };

export type AnswerResult =
  | { ok: true; result: "next"; trial: TrialView }
  | { ok: true; result: "failed"; reason: "wrong" | "timeout"; correct: string | null; lng: number; lat: number; saved?: boolean }
  /** A relay chest: no key, a clue (the riddle) to the next place, where the key is. */
  | { ok: true; result: "relay"; key: number; keysHeld: number; keys: number; riddle: string }
  /** A puzzle answered wrong, with lives left. */
  | { ok: true; result: "wrong"; lives: number }
  | { ok: true; result: "key"; keysHeld: number; keys: number; riddle: string; bonuses?: Bonus[] }
  | { ok: true; result: "finished"; keysHeld: number; keys: number; place: number; winner: boolean; bonuses?: Bonus[] }
  | { ok: false; reason: "no_trial" };

/** A bonus for a key: first to it (+100), in golden minutes (+50), a showdown won (+50, against `rival`). */
export type Bonus = { kind: "first" | "golden" | "showdown"; coins: number; rival?: string | null };

/** The player's hunt in one card (hunt_recap). */
export type HuntRecap = {
  title: string;
  prize: string;
  winners: number;
  place: number | null;
  keys: number;
  keysHeld: number;
  joinedAt: string;
  finishedAt: string | null;
  hunters: number;
  perKey: { key: number; at: string; minutes: number; tries: number }[];
  medals: { kind: Bonus["kind"]; key: number; coins: number; rival: string | null }[];
  bonusCoins: number;
  roadEvents: number;
};

export type BoardRow = { rank: number; username: string; keysHeld: number; place: number | null; me: boolean };

/** Something that just happened in the hunt (hunt_feed); `metres`: how far from the player it was. */
export type FeedEvent = {
  at: string;
  /** `relay`: someone opened a relay chest (a clue toward the key, not the key). */
  kind: "key" | "relay" | "trial" | "finished" | "joined" | "first" | "showdown";
  who: string;
  mine: boolean;
  key: number | null;
  place: number | null;
  metres: number | null;
  /** A showdown: who was beaten. */
  text: string | null;
};

/** The race around the player (hunt_feed): news, the rivals chasing the same key within 2 km, the pressure. */
export type HuntFeed = {
  now: string;
  phase: HuntPhase;
  rank: number | null;
  hunters: number;
  events: FeedEvent[];
  rivals: { name: string; lng: number; lat: number; metres: number }[];
  inMyArea: number;
  /** Golden minutes: until when, if on; when the next begin. */
  golden: string | null;
  goldenNext: string | null;
  /** A tip for a hunter falling behind (once per key). */
  tip: { key: number; direction: string; band: string } | null;
};

export type TrialCategory = "maths" | "sequences" | "general" | "nigeria";

export const CATEGORY_NAMES: Record<TrialCategory, string> = {
  maths: "Mental maths",
  sequences: "Number sequences",
  general: "General knowledge",
  nigeria: "Know Nigeria",
};

/** "1st", "2nd", "3rd", "4th"… */
export function ordinal(n: number) {
  const rest = n % 100;
  const suffix = rest >= 11 && rest <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

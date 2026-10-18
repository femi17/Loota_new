/**
 * Hunts (design doc section 6): the shapes the hunt functions in the database
 * return. Riddles for later keys, key spots and trial answers never reach the
 * browser; the server reveals each step as it's earned.
 */

export type HuntPhase = "draft" | "upcoming" | "live" | "ended";

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

/** The current question of a Key Trial (never the answer). */
export type TrialView = {
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
  category: TrialCategory | null;
  /** The Final Approach clue, once the player has reached the key's area. */
  clue: string | null;
  trial: TrialView | null;
  /** Set when a trial ran out while the player was away: where they were thrown. */
  thrown: { lng: number; lat: number } | null;
};

export type SearchResult =
  | { ok: true; result: "trial"; trial: TrialView }
  | { ok: true; result: "area"; clue: string; band: string }
  | { ok: true; result: "cold"; band: string }
  | { ok: false; reason: "not_live" | "not_joined" | "finished" | "wait" | "no_key" }
  | { ok: false; reason: "thrown"; lng: number; lat: number }
  | { ok: false; reason: "position"; lng: number; lat: number };

export type AnswerResult =
  | { ok: true; result: "next"; trial: TrialView }
  | { ok: true; result: "failed"; reason: "wrong" | "timeout"; correct: string; lng: number; lat: number; saved?: boolean }
  | { ok: true; result: "key"; keysHeld: number; keys: number; riddle: string }
  | { ok: true; result: "finished"; keysHeld: number; keys: number; place: number; winner: boolean }
  | { ok: false; reason: "no_trial" };

export type BoardRow = { rank: number; username: string; keysHeld: number; place: number | null; me: boolean };

/** Something that just happened in the hunt (hunt_feed); `metres`: how far from the player it was. */
export type FeedEvent = {
  at: string;
  kind: "key" | "trial" | "finished" | "joined";
  who: string;
  mine: boolean;
  key: number | null;
  place: number | null;
  metres: number | null;
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

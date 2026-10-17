"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CATEGORY_NAMES,
  ordinal,
  type AnswerResult,
  type BoardRow,
  type HuntState,
  type SearchResult,
  type TrialView,
} from "@/game/hunt";

/** What the hunt panel needs from the map. */
export type HuntActions = {
  /** Check for the key where the hunter stands (also saves the position). */
  search: (hunt: string) => Promise<SearchResult | null>;
  /** Move the hunter to a spot the server has recorded. */
  placeAt: (lng: number, lat: number) => void;
  /** Hold the hunter still during a Key Trial. */
  setFrozen: (frozen: boolean) => void;
  say: (text: string, alert?: boolean) => void;
};

type Ending =
  | { kind: "failed"; reason: "wrong" | "timeout"; correct: string }
  | { kind: "key"; keysHeld: number; keys: number; riddle: string }
  | { kind: "finished"; place: number; winner: boolean };

const REFRESH_MS = 30_000;

/**
 * The hunt card (riddle, keys, Search here, leaderboard) and the Key Trial.
 * Answers are checked only by the server; this never knows them.
 */
export function HuntPanel({ huntId, actions, onHide }: { huntId: string; actions: RefObject<HuntActions | null>; onHide: () => void }) {
  const supabase = useRef(createClient()).current;
  const [state, setState] = useState<HuntState | null>(null);
  const [open, setOpen] = useState(true);
  const [feedback, setFeedback] = useState<{ text: string; hot: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [trial, setTrial] = useState<TrialView | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [board, setBoard] = useState<BoardRow[] | null>(null);

  function startTrial(view: TrialView) {
    actions.current?.setFrozen(true);
    setEnding(null);
    setTrial(view);
  }

  async function refresh() {
    const { data } = await supabase.rpc("hunt_state", { p_hunt: huntId });
    const next = data as HuntState | null;
    if (!next) return;
    setState(next);
    if (next.thrown) {
      actions.current?.placeAt(next.thrown.lng, next.thrown.lat);
      actions.current?.say("Your Key Trial ran out of time while you were away, so you were thrown 2 km from the key.", true);
    }
    if (next.trial) startTrial(next.trial);
  }
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  // Start once the map is ready (it may still be loading), then keep up to date.
  useEffect(() => {
    let timer = 0;
    const begin = () => {
      if (actions.current) {
        void refreshRef.current();
        timer = window.setInterval(() => void refreshRef.current(), REFRESH_MS);
      } else {
        timer = window.setTimeout(begin, 500);
      }
    };
    begin();
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    };
  }, [actions, huntId]);

  async function search() {
    const map = actions.current;
    if (!map || searching) return;
    setSearching(true);
    try {
      const r = await map.search(huntId);
      if (!r) {
        setFeedback({ text: "Couldn't search right now. Check your connection and try again.", hot: false });
        return;
      }
      if (r.ok && r.result === "trial") {
        startTrial(r.trial);
        setFeedback(null);
      } else if (r.ok && r.result === "area") {
        setState((s) => (s ? { ...s, clue: r.clue } : s));
        setFeedback({ text: `Warm! You're in the right area. The key is ${r.band} from here.`, hot: true });
      } else if (r.ok) {
        setFeedback({ text: `Cold. The key's area is ${r.band} from here.`, hot: false });
      } else if (r.reason === "wait") {
        setFeedback({ text: "Give it a few seconds between searches.", hot: false });
      } else if (r.reason === "position") {
        setFeedback({ text: "Your position was corrected. Try searching again.", hot: false });
      } else if (r.reason === "thrown") {
        setFeedback({ text: "Your last Key Trial ran out, so you were thrown 2 km away. Travel back and search again.", hot: false });
        void refresh();
      } else {
        void refresh();
      }
    } finally {
      setSearching(false);
    }
  }

  async function answer(attempt: string, choice: number) {
    const { data } = await supabase.rpc("answer_trial", { p_attempt: attempt, p_choice: choice });
    const r = data as AnswerResult | null;
    if (!r || !r.ok) {
      setTrial(null);
      actions.current?.setFrozen(false);
      void refresh();
      return;
    }
    if (r.result === "next") {
      setTrial(r.trial);
      return;
    }
    setTrial(null);
    if (r.result === "failed") {
      actions.current?.placeAt(r.lng, r.lat);
      setEnding({ kind: "failed", reason: r.reason, correct: r.correct });
    } else if (r.result === "key") {
      setEnding({ kind: "key", keysHeld: r.keysHeld, keys: r.keys, riddle: r.riddle });
    } else {
      setEnding({ kind: "finished", place: r.place, winner: r.winner });
    }
    setFeedback(null);
    void refresh();
  }

  function closeEnding() {
    const was = ending;
    setEnding(null);
    actions.current?.setFrozen(false);
    if (was?.kind === "failed") {
      actions.current?.say("You were thrown 2 km away. Travel back to the key and search again: you'll get new questions.", true);
    }
  }

  async function toggleBoard() {
    if (board) {
      setBoard(null);
      return;
    }
    const { data } = await supabase.rpc("hunt_board", { p_hunt: huntId });
    setBoard((data ?? []) as BoardRow[]);
  }

  if (!state) return null;
  const next = state.keysHeld + 1;
  const done = !!state.finishedAt;

  return (
    <>
      <section className="pointer-events-auto flex w-full max-w-md flex-col gap-2 rounded-2xl bg-ink p-3" aria-label="Hunt">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
            <span className="flex shrink-0 gap-0.5" aria-label={`${state.keysHeld} of ${state.keys} keys`}>
              {Array.from({ length: state.keys }, (_, i) => (
                <svg key={i} width="16" height="16" viewBox="0 0 24 24" fill={i < state.keysHeld ? "#F4B41A" : "none"} stroke="#F4B41A" strokeWidth="2" aria-hidden="true">
                  <circle cx="8" cy="8" r="5" />
                  <path d="M11.5 11.5L20 20M16 16l2.5-2.5M18 18l2-2" />
                </svg>
              ))}
            </span>
            <span className="truncate text-sm font-bold">
              {state.phase === "upcoming"
                ? `${state.title} · starts soon`
                : state.phase === "ended" && !done
                  ? `${state.title} · ended`
                  : done
                    ? `Finished ${ordinal(state.place ?? 0)}`
                    : `Key ${next} of ${state.keys}`}
            </span>
            <span className="ml-auto text-muted" aria-hidden="true">{open ? "▴" : "▾"}</span>
          </button>
          {state.phase === "live" && !done && (
            <button
              type="button"
              disabled={searching}
              onClick={() => void search()}
              className="h-10 shrink-0 rounded-xl bg-gold px-3 text-sm font-extrabold text-ink disabled:opacity-60"
            >
              {searching ? "Searching…" : "Search here"}
            </button>
          )}
          <button
            type="button"
            onClick={onHide}
            aria-label="Hide the hunt (continue it from the lobby)"
            title="Hide the hunt (continue it from the lobby)"
            className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-paper/70 hover:bg-ink-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {open && (
          <div className="flex flex-col gap-2 text-sm">
            {state.phase === "upcoming" && (
              <p className="text-muted">
                The first riddle appears when the hunt starts. Until then, roam to collect coins, relics and intel.
              </p>
            )}
            {state.phase === "live" && !done && state.riddle && (
              <>
                <p className="font-display text-base leading-snug">&ldquo;{state.riddle}&rdquo;</p>
                {state.category && <p className="text-xs text-muted">Key Trial: {CATEGORY_NAMES[state.category]}</p>}
                {state.clue && (
                  <p className="rounded-xl bg-ink-2 p-2">
                    <b className="text-gold">Final approach: </b>
                    {state.clue}
                  </p>
                )}
              </>
            )}
            {done && (
              <p>
                You collected every key and finished {ordinal(state.place ?? 0)}.
                {state.place != null && state.place <= state.winners ? " You're a winner! The Loota team will contact you about your prize." : ""}
              </p>
            )}
            {state.phase === "ended" && !done && <p className="text-muted">This hunt is over. {state.winnersFound} hunters finished.</p>}
            {feedback && (
              <p role="status" className={`rounded-xl p-2 font-bold ${feedback.hot ? "bg-[#7a2e12] text-paper" : "bg-[#173b5c] text-paper"}`}>
                {feedback.text}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>Prize: {state.prize}</span>
              <button type="button" onClick={() => void toggleBoard()} className="ml-auto font-bold text-gold">
                {board ? "Hide board" : "Leaderboard"}
              </button>
            </div>
            {board && (
              <ol className="flex flex-col gap-1">
                {board.length === 0 && <li className="text-muted">No hunters yet.</li>}
                {board.map((row) => (
                  <li key={row.rank} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${row.me ? "bg-ink-2 font-bold" : ""}`}>
                    <span className="w-6 text-muted">{row.rank}</span>
                    <span className="flex-1 truncate">{row.username}</span>
                    <span>{row.place ? `Finished ${ordinal(row.place)}` : `${row.keysHeld} key${row.keysHeld === 1 ? "" : "s"}`}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>

      {trial && <KeyTrial key={`${trial.attempt}:${trial.index}`} trial={trial} onAnswer={(choice) => answer(trial.attempt, choice)} />}

      {ending && (
        <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-ink/80 p-4">
          <div role="dialog" aria-label="Key Trial result" className="flex w-full max-w-md flex-col gap-4 rounded-3xl bg-ink-2 p-6 text-center">
            {ending.kind === "failed" && (
              <>
                <h2 className="font-display text-3xl font-extrabold text-danger">{ending.reason === "timeout" ? "Time's up!" : "Wrong answer!"}</h2>
                <p>
                  The answer was <b>{ending.correct}</b>.
                </p>
                <p className="text-muted">
                  You&apos;ve been thrown 2 km away. Travel back to the key and search again for a new set of questions.
                </p>
              </>
            )}
            {ending.kind === "key" && (
              <>
                <h2 className="font-display text-3xl font-extrabold text-gold">Key {ending.keysHeld} earned!</h2>
                <p className="text-muted">
                  {ending.keysHeld} of {ending.keys} keys. Your next riddle:
                </p>
                <p className="font-display text-lg">&ldquo;{ending.riddle}&rdquo;</p>
              </>
            )}
            {ending.kind === "finished" && (
              <>
                <h2 className="font-display text-3xl font-extrabold text-gold">
                  {ending.winner ? "You won!" : "Hunt complete!"}
                </h2>
                <p>
                  You collected every key and finished <b>{ordinal(ending.place)}</b>.
                </p>
                {ending.winner && <p className="text-muted">The Loota team will contact you about your prize.</p>}
              </>
            )}
            <button type="button" onClick={closeEnding} className="h-12 rounded-2xl bg-gold font-bold text-ink">
              Continue
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** One question of a Key Trial, with its countdown. Running out of time counts as a miss. */
function KeyTrial({ trial, onAnswer }: { trial: TrialView; onAnswer: (choice: number) => Promise<void> | void }) {
  const [left, setLeft] = useState(trial.secondsLeft);
  const [sent, setSent] = useState<number | null>(null);
  const deadline = useRef(0);
  const sentRef = useRef(false);
  const answerRef = useRef(onAnswer);
  useEffect(() => {
    answerRef.current = onAnswer;
  });

  useEffect(() => {
    deadline.current = performance.now() + trial.secondsLeft * 1000;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, (deadline.current - performance.now()) / 1000);
      setLeft(remaining);
      if (remaining <= 0 && !sentRef.current) {
        sentRef.current = true;
        setSent(-1);
        void answerRef.current(-1);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [trial.secondsLeft]);

  const choose = (i: number) => {
    if (sentRef.current) return;
    sentRef.current = true;
    setSent(i);
    void answerRef.current(i);
  };

  const share = left / trial.seconds;
  return (
    <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-ink/80 p-4">
      <div role="dialog" aria-label="Key Trial" className="flex w-full max-w-lg flex-col gap-4 rounded-3xl bg-ink-2 p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-extrabold text-gold">Key Trial · Key {trial.key}</h2>
          <span className="text-sm text-muted">
            Question {trial.index + 1} of {trial.count}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-line" role="timer" aria-label={`${Math.ceil(left)} seconds left`}>
          <div className={`h-full ${share < 0.3 ? "bg-danger" : "bg-gold"}`} style={{ width: `${share * 100}%` }} />
        </div>
        <p className="text-center font-display text-2xl font-extrabold leading-snug">{trial.prompt}</p>
        <div className="grid grid-cols-2 gap-3">
          {trial.choices.map((choice, i) => (
            <button
              key={i}
              type="button"
              disabled={sent !== null}
              onClick={() => choose(i)}
              className={`min-h-14 rounded-2xl border-2 px-3 py-2 text-base font-bold ${
                sent === i ? "border-gold bg-gold text-ink" : "border-line bg-ink text-paper hover:border-gold"
              } disabled:cursor-default`}
            >
              {choice}
            </button>
          ))}
        </div>
        <p className="text-center text-xs text-muted">
          {Math.ceil(left)} s left · one wrong answer or running out of time throws you 2 km away
        </p>
      </div>
    </div>
  );
}

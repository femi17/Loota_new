"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { LootaLogo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";
import {
  CATEGORY_NAMES,
  ordinal,
  type AnswerResult,
  type BoardRow,
  type Bonus,
  type HuntRecap,
  type FeedEvent,
  type HuntFeed,
  type HuntState,
  type SearchResult,
  type AnyTrialView,
  type TrialView,
} from "@/game/hunt";
import { PuzzleTrial } from "./puzzles/PuzzleTrial";
import { cue } from "@/game/sound";
import { PUZZLE_NAMES } from "@/game/puzzles/names";
import { Confetti } from "./Confetti";

/** What the hunt panel needs from the map. */
export type HuntActions = {
  /** Check for the key where the hunter stands (also saves the position). */
  search: (hunt: string) => Promise<SearchResult | null>;
  /** Move the hunter to a spot the server has recorded. */
  placeAt: (lng: number, lat: number) => void;
  /** Hold the hunter still during a Key Trial. */
  setFrozen: (frozen: boolean) => void;
  say: (text: string, alert?: boolean) => void;
  /** Which way and how far a spot is from the hunter, as the screen shows it (bearing in degrees, 0 = up). */
  pointer: (lng: number, lat: number) => { bearing: number; metres: number };
};

const FEED_MS = 6000;
const TOAST_MS = 4500;
const far = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** A line of hunt news. */
function newsOf(e: FeedEvent) {
  const where = e.metres != null ? ` · ${far(e.metres)} from you` : "";
  if (e.kind === "key") return `🔑 ${e.who} found Key ${e.key}${where}`;
  if (e.kind === "relay") return `🗺️ ${e.who} opened a relay chest: a clue toward Key ${e.key}${where}`;
  if (e.kind === "trial") return `⚔️ ${e.who} is in the Key ${e.key} trial${where}`;
  if (e.kind === "finished") return `🏁 ${e.who} finished ${ordinal(e.place ?? 0)}!`;
  if (e.kind === "first") return `🥇 ${e.who} was FIRST to Key ${e.key}! +100 coins`;
  if (e.kind === "showdown") return `⚔️ ${e.who} won a showdown at Key ${e.key}${e.text ? ` against ${e.text}` : ""}!`;
  return `👋 ${e.who} joined the hunt`;
}

/** What the next key's trial is, for the card: a puzzle (named, if the key is set to one) or a quiz's category. */
function trialLabel(s: HuntState) {
  const kind = s.trialKind ?? "quiz";
  if (kind === "quiz") return s.category ? `questions, ${CATEGORY_NAMES[s.category]}` : "questions";
  if (kind === "puzzle") return "a puzzle";
  return `a puzzle: ${PUZZLE_NAMES[kind].name}`;
}

type Ending =
  /** `correct`: a quiz's right answer (a puzzle has none to show). */
  | { kind: "failed"; reason: "wrong" | "timeout"; correct: string | null; saved: boolean }
  | { kind: "key"; keysHeld: number; keys: number; riddle: string; bonuses: Bonus[] }
  | { kind: "relay"; key: number; riddle: string }
  | { kind: "finished"; place: number; winner: boolean; bonuses: Bonus[] };

const BONUS_TEXT: Record<Bonus["kind"], string> = { first: "🥇 First to this key", golden: "✨ Golden minutes", showdown: "⚔️ Showdown won" };

const REFRESH_MS = 30_000;

/**
 * The hunt card (riddle, keys, Search here, leaderboard) and the Key Trial.
 * Answers are checked only by the server; this never knows them.
 */
/**
 * The trial on the map (owner, 18 Oct 2026: scenes in the world): the card tells the map as a trial begins
 * ("loota:trial", on), as each answer is right ("loota:trial-step") and how it ends ("loota:trial", off, with the
 * outcome); `scene` while the map shows it: the card steps aside and the questions sit in a strip at the bottom.
 */
const trialEvent = (detail: { on: boolean; outcome?: "key" | "relay" | "finished" | "failed" | "error" }) => window.dispatchEvent(new CustomEvent("loota:trial", { detail }));

export function HuntPanel({
  huntId,
  actions,
  onHide,
  scene = false,
  keeper = "The Keeper",
  inArea = false,
}: {
  huntId: string;
  actions: RefObject<HuntActions | null>;
  onHide: () => void;
  scene?: boolean;
  /** Who asks the trial on the map (the key's place: the market woman, the guide, the Keeper of the Key…). */
  keeper?: string;
  /** In the key's area (the metal detector feels its heat): only then can you search (owner, 20 Oct 2026). */
  inArea?: boolean;
}) {
  const supabase = useRef(createClient()).current;
  const [state, setState] = useState<HuntState | null>(null);
  const [open, setOpen] = useState(true);
  const [feedback, setFeedback] = useState<{ text: string; hot: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [trial, setTrial] = useState<AnyTrialView | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [feed, setFeed] = useState<HuntFeed | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [revealed, setRevealed] = useState<string | null>(null); // the riddle being revealed (the start of the hunt)
  const feedSince = useRef<string | null>(null);
  const [tip, setTip] = useState<HuntFeed["tip"]>(null);
  const [rival, setRival] = useState<string | null>(null); // a showdown: someone else in this key's trial
  const [recap, setRecap] = useState<HuntRecap | null>(null);
  const recentTrials = useRef<{ who: string; key: number; at: number }[]>([]);
  const wasGolden = useRef(false);
  const skew = useRef(0); // the server's clock minus this device's
  const lastRank = useRef<number | null>(null);

  function toast(text: string) {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
  }

  function startTrial(view: AnyTrialView) {
    actions.current?.setFrozen(true);
    setEnding(null);
    setTrial(view);
    trialEvent({ on: true });
    const near = recentTrials.current.find((x) => x.key === view.key && Date.now() - x.at < 90_000);
    if (near) setRival(near.who);
  }

  async function refresh() {
    const { data } = await supabase.rpc("hunt_state", { p_hunt: huntId });
    const next = data as HuntState | null;
    if (!next) return;
    setState(next);
    if (next.phase === "live" && next.joined && next.keysHeld === 0 && next.riddle && !next.finishedAt) {
      const seen = `loota:riddle-seen:${next.id}`;
      let shown = false;
      try {
        shown = localStorage.getItem(seen) === "1";
        localStorage.setItem(seen, "1");
      } catch {
        shown = false;
      }
      if (!shown) setRevealed(next.riddle);
    }
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
    // A Wonder took or gave keys (the map hears of it first).
    const changed = () => void refreshRef.current();
    window.addEventListener("loota:hunt-changed", changed);
    // "Open the chest" on the map: search right there (it starts the Key Trial).
    const openChest = () => void searchRef.current();
    window.addEventListener("loota:hunt-search", openChest);
    // The map may be waiting to open a chest: after this render's effects, once searchRef holds the search.
    const ready = window.setTimeout(() => window.dispatchEvent(new Event("loota:hunt-ready")), 0);
    return () => {
      window.clearTimeout(ready);
      window.clearTimeout(timer);
      window.clearInterval(timer);
      window.removeEventListener("loota:hunt-changed", changed);
      window.removeEventListener("loota:hunt-search", openChest);
    };
  }, [actions, huntId]);

  // A clock for the countdown and the rivals' arrows.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // The start: at the moment the hunt begins, everyone sees "GO!" (for 2 s) and gets the first riddle.
  const startsIn = state?.phase === "upcoming" ? Math.ceil((Date.parse(state.startsAt) - now) / 1000) : null;
  const sinceStart = state ? (now - Date.parse(state.startsAt)) / 1000 : null;
  const go = sinceStart !== null && sinceStart >= 0 && sinceStart < 2;
  const due = startsIn !== null && startsIn <= 0; // started by the clock; the server may need a second to agree
  // The last ten seconds beep; GO! with a drum.
  useEffect(() => {
    if (startsIn !== null && startsIn > 0 && startsIn <= 10) cue("countdown");
  }, [startsIn]);
  useEffect(() => {
    if (go) cue("go");
  }, [go]);
  useEffect(() => {
    if (!due) return;
    const retry = window.setInterval(() => void refreshRef.current(), 1500);
    return () => window.clearInterval(retry);
  }, [due]);

  // The race: news, rivals, rank, every few seconds while the hunt is on.
  const racing = state?.phase === "live" && state.joined && !state.finishedAt;
  useEffect(() => {
    if (!racing) return;
    let stopped = false;
    const db = createClient();
    async function poll() {
      const { data } = await db.rpc("hunt_feed", { p_hunt: huntId, p_since: feedSince.current });
      const f = data as HuntFeed | null;
      if (stopped || !f) return;
      const first = feedSince.current === null;
      feedSince.current = f.now;
      skew.current = Date.parse(f.now) - Date.now();
      setFeed(f);
      for (const e of f.events) {
        if (e.kind === "trial" && !e.mine && e.key != null) {
          recentTrials.current = [...recentTrials.current.filter((x) => Date.now() - x.at < 90_000), { who: e.who, key: e.key, at: Date.parse(e.at) - skew.current }];
          setRival((r) => r ?? (trialKeyRef.current === e.key ? e.who : null)); // they started the trial I'm in
        }
      }
      if (!first) {
        let keys = false;
        for (const e of f.events) {
          if (e.mine) continue;
          toast(newsOf(e));
          cue(e.kind === "key" || e.kind === "first" || e.kind === "finished" ? "rival" : "news");
          if (e.kind === "key" || e.kind === "relay" || e.kind === "finished") keys = true;
        }
        if (keys) void refreshRef.current();
      }
      if (f.golden && !wasGolden.current && !first) toast("✨ Golden minutes! For 10 minutes the detector reaches twice as far, and every key pays +50.");
      wasGolden.current = !!f.golden;
      if (f.tip) {
        setTip(f.tip);
        toast(`🧭 A tip for the chase: Key ${f.tip.key}'s area lies ${f.tip.direction} of you, ${f.tip.band}.`);
      }
      if (f.rank != null && lastRank.current != null && f.rank !== lastRank.current) {
        toast(f.rank < lastRank.current ? `📈 You moved up to ${ordinal(f.rank)}!` : `📉 You dropped to ${ordinal(f.rank)}.`);
      }
      lastRank.current = f.rank;
    }
    void poll();
    const timer = window.setInterval(() => void poll(), FEED_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [racing, huntId]);

  const trialKeyRef = useRef<number | null>(null);
  useEffect(() => {
    trialKeyRef.current = trial?.key ?? null;
  });

  const searchRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    searchRef.current = search;
  });

  async function search() {
    const map = actions.current;
    if (!map || searching) return;
    setSearching(true);
    setOpen(true); // its answer shows on the card
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
        setFeedback({
          text: `Cold: the key isn't here. Its area is ${r.band} away. Work out the place the riddle names, travel there, then search again.`,
          hot: false,
        });
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
    settle(data as AnswerResult | null);
  }

  /** A trial's outcome (a quiz's answer, or a puzzle's verdict): the next question, the key, finished, or failed. */
  function settle(r: AnswerResult | null) {
    if (r?.ok && r.result === "wrong") return; // a puzzle with lives left: it carries on
    if (!r || !r.ok) {
      setTrial(null);
      trialEvent({ on: false, outcome: "error" });
      actions.current?.setFrozen(false);
      void refresh();
      return;
    }
    if (r.result === "next") {
      cue("right");
      window.dispatchEvent(new Event("loota:trial-step")); // right: on to the next question
      setTrial(r.trial);
      return;
    }
    setTrial(null);
    trialEvent({ on: false, outcome: r.result });
    if (r.result === "failed") {
      actions.current?.placeAt(r.lng, r.lat);
      setEnding({ kind: "failed", reason: r.reason, correct: r.correct, saved: !!r.saved });
      cue(r.saved ? "solved" : "failed");
    } else if (r.result === "relay") {
      // No key in this chest: a clue to the next place (the detector turns to it).
      setEnding({ kind: "relay", key: r.key, riddle: r.riddle });
      setRival(null);
      setTip(null);
      cue("relay");
    } else if (r.result === "key") {
      // On the map, a moment for the Keeper's cheer before the key's card.
      const won = { kind: "key" as const, keysHeld: r.keysHeld, keys: r.keys, riddle: r.riddle, bonuses: r.bonuses ?? [] };
      if (scene) window.setTimeout(() => setEnding(won), 1700);
      else setEnding(won);
      setRival(null);
      setTip(null);
      window.dispatchEvent(new Event("loota:key-earned"));
    } else {
      const won = { kind: "finished" as const, place: r.place, winner: r.winner, bonuses: r.bonuses ?? [] };
      if (scene) window.setTimeout(() => setEnding(won), 1700);
      else setEnding(won);
      setRival(null);
      window.dispatchEvent(new Event("loota:key-earned"));
    }
    window.dispatchEvent(new Event("loota:hunt-changed"));
    setFeedback(null);
    void refresh();
  }

  function closeEnding() {
    const was = ending;
    setEnding(null);
    actions.current?.setFrozen(false);
    if (was?.kind === "failed" && !was.saved) {
      actions.current?.say("You were thrown 2 km away. Travel back to the key and search again: you'll get new questions.", true);
    }
  }

  async function openRecap() {
    const { data } = await supabase.rpc("hunt_recap", { p_hunt: huntId });
    if (data) setRecap(data as HuntRecap);
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
      <section className={`pointer-events-auto flex w-full max-w-md flex-col gap-2 rounded-2xl bg-ink p-3 ${scene ? "hidden" : ""}`} aria-label="Hunt">
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
                    : `Key ${next} of ${state.keys}${state.trail ? " · the trail" : ""}`}
            </span>
            <span className="ml-auto text-muted" aria-hidden="true">{open ? "▴" : "▾"}</span>
          </button>
          {state.phase === "live" && !done && inArea && (
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
              <>
                {startsIn !== null && startsIn > 0 && startsIn < 24 * 3600 && (
                  <p className="font-display text-2xl font-extrabold text-gold" aria-label="Starts in">
                    Starts in {Math.floor(startsIn / 3600) > 0 ? `${Math.floor(startsIn / 3600)}:` : ""}
                    {String(Math.floor((startsIn % 3600) / 60)).padStart(Math.floor(startsIn / 3600) > 0 ? 2 : 1, "0")}:{String(startsIn % 60).padStart(2, "0")}
                  </p>
                )}
                <p className="text-muted">
                  Everyone gets the first riddle at the same moment. Until then, roam to collect coins, relics and intel.
                </p>
              </>
            )}
            {state.phase === "live" && !done && state.riddle && (
              <>
                {state.trail && (
                  <p className="text-xs font-bold text-[#7FD1FF]">🗺️ The last chest held a clue, not the key. Follow it:</p>
                )}
                <p className="font-display text-base leading-snug">&ldquo;{state.riddle}&rdquo;</p>
                <p className="text-xs text-muted">Key Trial: {trialLabel(state)}</p>
                {!inArea && (
                  <p className="text-xs text-muted">
                    No typing: the riddle names a real place. Go there on the map: <b>Search here</b> appears when you reach the key&apos;s area.
                  </p>
                )}
                {state.clue && (
                  <p className="rounded-xl bg-ink-2 p-2">
                    <b className="text-gold">Final approach: </b>
                    {state.clue}
                  </p>
                )}
              </>
            )}
            {racing && feed && (feed.inMyArea > 0 || feed.rivals.length > 0) && (
              <div className="flex flex-col gap-1 rounded-xl bg-ink-2 p-2 text-xs" aria-label="Your rivals">
                {feed.inMyArea > 0 && (
                  <span className="font-bold text-[#FF9A5C]">
                    🔥 {feed.inMyArea} hunter{feed.inMyArea > 1 ? "s are" : " is"} already in your key&apos;s area
                  </span>
                )}
                {feed.rivals.slice(0, 3).map((r) => {
                  const p = actions.current?.pointer(r.lng, r.lat);
                  return (
                    <span key={r.name} className="flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="#FF9A5C" aria-hidden="true" style={{ transform: `rotate(${p?.bearing ?? 0}deg)` }}>
                        <path d="M12 2l6 18-6-4-6 4z" />
                      </svg>
                      <b className="truncate">{r.name}</b>
                      <span className="text-muted">chasing the same key · {far(p?.metres ?? r.metres)}</span>
                    </span>
                  );
                })}
              </div>
            )}
            {done && (
              <p>
                You collected every key and finished {ordinal(state.place ?? 0)}.
                {state.place != null && state.place <= state.winners ? " You're a winner! The Loota team will contact you about your prize." : ""}
              </p>
            )}
            {racing && feed && (() => {
              const until = feed.golden ? Date.parse(feed.golden) - skew.current : null;
              const next = feed.goldenNext ? Date.parse(feed.goldenNext) - skew.current : null;
              const left = until ? Math.max(0, Math.round((until - now) / 1000)) : null;
              const soon = next ? Math.round((next - now) / 1000) : null;
              const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
              if (left) {
                return (
                  <p className="rounded-xl bg-[#3B2F0A] p-2 text-xs font-bold text-gold ring-1 ring-gold" aria-label="Golden minutes">
                    ✨ Golden minutes · {mm(left)} left: the detector reaches twice as far, keys pay +50
                  </p>
                );
              }
              if (soon != null && soon > 0 && soon <= 15 * 60) {
                return <p className="text-xs font-bold text-gold/80" aria-label="Golden minutes soon">✨ Golden minutes in {mm(soon)}</p>;
              }
              return null;
            })()}
            {racing && tip && tip.key === state.keysHeld + 1 && (
              <p className="rounded-xl bg-[#14324A] p-2 text-xs font-bold text-paper" aria-label="A tip">
                🧭 A tip: Key {tip.key}&apos;s area lies {tip.direction} of where you were, {tip.band}.
              </p>
            )}
            {done && (
              <button type="button" onClick={() => void openRecap()} className="h-10 rounded-xl bg-gold font-bold text-ink">
                📜 Your hunt, in one card
              </button>
            )}
            {state.phase === "ended" && !done && <p className="text-muted">This hunt is over. {state.winnersFound} hunters finished.</p>}
            {feedback && (inArea || !feedback.hot) && (
              <p role="status" className={`rounded-xl p-2 font-bold ${feedback.hot ? "bg-[#7a2e12] text-paper" : "bg-[#173b5c] text-paper"}`}>
                {feedback.text}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>Prize: {state.prize}</span>
              {racing && feed?.rank != null && (
                <span className="font-bold text-paper">
                  {ordinal(feed.rank)} of {feed.hunters}
                </span>
              )}
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

      {/* Hunt news, a few seconds each. */}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-3 bottom-[190px] z-20 mx-auto flex max-w-sm flex-col gap-1.5" aria-live="polite">
          {toasts.map((t) => (
            <p key={t.id} className="loota-wonder-banner rounded-xl bg-ink/95 px-3 py-2 text-sm font-bold text-paper ring-1 ring-gold">
              {t.text}
            </p>
          ))}
        </div>
      )}

      {/* The last ten seconds before the start, then GO! */}
      {((startsIn !== null && startsIn > 0 && startsIn <= 10) || go) && (
        <div className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center bg-ink/60" aria-live="assertive">
          <LootaLogo height={96} tone="gold" priority className="mb-3 drop-shadow-[0_0_24px_rgba(244,180,26,0.45)]" />
          <p className="text-sm font-bold uppercase tracking-widest text-paper/80">{go ? state.title : "The hunt starts in"}</p>
          <p key={go ? "go" : startsIn} className="loota-count font-display text-[9rem] font-extrabold leading-none text-gold">
            {go ? "GO!" : startsIn}
          </p>
        </div>
      )}

      {/* The first riddle, revealed with a flourish. */}
      {revealed && !go && (
        <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-ink/85 p-5">
          <div role="dialog" aria-label="The first riddle" className="loota-wonder-banner flex w-full max-w-md flex-col gap-4 rounded-3xl bg-[#F5ECD8] p-6 text-center text-[#3A2410]">
            <LootaLogo height={64} tone="dark" className="mx-auto" />
            <p className="text-xs font-extrabold uppercase tracking-widest text-[#8A5A00]">The hunt is on · Key 1 of {state.keys}</p>
            <p className="font-display text-2xl font-extrabold leading-snug">&ldquo;{revealed}&rdquo;</p>
            <p className="text-sm">At the key, a Key Trial: {trialLabel(state)}.</p>
            <p className="text-sm text-[#5A4020]">
              There&apos;s nothing to type: the riddle names a real place. Work out where it is, travel there on the map before the
              others: <b>Search here</b> appears when you arrive.
            </p>
            <button type="button" onClick={() => setRevealed(null)} className="h-12 rounded-2xl bg-[#3A2410] font-bold text-[#F5ECD8]">
              Let&apos;s go
            </button>
          </div>
        </div>
      )}

      {trial &&
        (trial.kind === "puzzle" ? (
          <PuzzleTrial key={trial.attempt} trial={trial} rival={rival} world={scene} keeper={keeper} onResult={settle} />
        ) : (
          <KeyTrial key={`${trial.attempt}:${trial.index}`} trial={trial} rival={rival} world={scene} keeper={keeper} onAnswer={(choice) => answer(trial.attempt, choice)} />
        ))}
      {recap && <RecapCard recap={recap} onClose={() => setRecap(null)} />}

      {ending && (
        <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-ink/80 p-4">
          <div role="dialog" aria-label="Key Trial result" className="flex w-full max-w-md flex-col gap-4 rounded-3xl bg-ink-2 p-6 text-center">
            {ending.kind === "failed" && (
              <>
                <h2 className="font-display text-3xl font-extrabold text-danger">{ending.reason === "timeout" ? "Time's up!" : "Wrong answer!"}</h2>
                {ending.correct ? (
                  <p>
                    The answer was <b>{ending.correct}</b>.
                  </p>
                ) : (
                  <p>{ending.reason === "timeout" ? "The chest slammed shut before you finished." : "The lock jammed: that wasn't it."}</p>
                )}
                {ending.saved ? (
                  <p className="text-[#C3A6FF]">
                    🪙 Your Djinn&apos;s Coin glowed and crumbled to dust: you stand your ground. Search again for a new set of questions.
                  </p>
                ) : (
                  <p className="text-muted">
                    You&apos;ve been thrown 2 km away. Travel back to the key and search again for a new trial.
                  </p>
                )}
              </>
            )}
            {ending.kind === "relay" && (
              <>
                <p className="text-5xl" aria-hidden="true">🗺️</p>
                <h2 className="font-display text-3xl font-extrabold text-[#7FD1FF]">No key… only a clue!</h2>
                <p className="text-muted">
                  The chest held a torn map, not Key {ending.key}. Someone moved it. The key is somewhere else:
                </p>
                <p className="font-display text-lg">&ldquo;{ending.riddle}&rdquo;</p>
              </>
            )}
            {ending.kind === "key" && (
              <>
                <Confetti />
                <p className="loota-key-spin text-6xl" aria-hidden="true">🗝️</p>
                <h2 className="font-display text-3xl font-extrabold text-gold">Key {ending.keysHeld} earned!</h2>
                <p className="text-muted">
                  {ending.keysHeld} of {ending.keys} keys. Your next riddle:
                </p>
                <p className="font-display text-lg">&ldquo;{ending.riddle}&rdquo;</p>
                <Bonuses bonuses={ending.bonuses} />
              </>
            )}
            {ending.kind === "finished" && (
              <>
                <Confetti big />
                <h2 className="font-display text-3xl font-extrabold text-gold">
                  {ending.winner ? "You won!" : "Hunt complete!"}
                </h2>
                <p>
                  You collected every key and finished <b>{ordinal(ending.place)}</b>.
                </p>
                {ending.winner && <p className="text-muted">The Loota team will contact you about your prize.</p>}
                <Bonuses bonuses={ending.bonuses} />
                <button
                  type="button"
                  onClick={() => {
                    setEnding(null);
                    actions.current?.setFrozen(false);
                    void openRecap();
                  }}
                  className="h-12 rounded-2xl border-[1.5px] border-gold font-bold text-paper"
                >
                  📜 Your hunt, in one card
                </button>
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

/**
 * One question of a Key Trial, with its countdown. Running out of time counts as a miss. Some kinds show something
 * first to memorise (then hide it), some show it alongside (a row to count), and jumbled words come as letter tiles.
 */
function KeyTrial({
  trial,
  rival,
  world = false,
  keeper = "The Keeper",
  onAnswer,
}: {
  trial: TrialView;
  rival: string | null;
  /** Who asks, on the map. */
  keeper?: string;
  /** On the map (the Keeper of the Key by the chest): a strip at the bottom, the scene in view above. */
  world?: boolean;
  onAnswer: (choice: number) => Promise<void> | void;
}) {
  const [left, setLeft] = useState(trial.secondsLeft);
  const memorise = (trial.showSeconds ?? 0) > 0;
  const memorising = memorise && left > trial.seconds; // the first seconds: look, then it's hidden
  const scramble = /^Unscramble: /.test(trial.prompt) ? trial.prompt.replace(/^Unscramble: /, "").split(" ") : null;
  const [sent, setSent] = useState<number | null>(null);
  const deadline = useRef(0);
  const sentRef = useRef(false);
  const answerRef = useRef(onAnswer);
  useEffect(() => {
    answerRef.current = onAnswer;
  });

  const lastTick = useRef(0);
  useEffect(() => {
    deadline.current = performance.now() + trial.secondsLeft * 1000;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, (deadline.current - performance.now()) / 1000);
      setLeft(remaining);
      // The last five seconds tick.
      const whole = Math.ceil(remaining);
      if (whole > 0 && whole <= 5 && whole !== lastTick.current && !sentRef.current) {
        lastTick.current = whole;
        cue("tick");
      }
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

  const answerLeft = Math.min(left, trial.seconds);
  const share = answerLeft / trial.seconds;
  if (world) {
    // The Keeper asks; you answer in the strip.
    return (
      <div
        data-scene-strip=""
        role="dialog"
        aria-label="Key Trial"
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 rounded-t-3xl bg-ink/92 p-3 backdrop-blur-sm sm:inset-x-auto sm:left-1/2 sm:w-[28rem] sm:-translate-x-1/2"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-sm font-extrabold text-gold">Key Trial · Key {trial.key}</span>
          <span className="text-xs text-muted">
            Question {trial.index + 1} of {trial.count}
          </span>
        </div>
        {rival && (
          <p className="loota-wonder-banner rounded-lg bg-danger/20 px-2 py-1 text-center text-xs font-extrabold text-paper ring-1 ring-danger" aria-label="Showdown">
            ⚔️ Showdown! {rival} is in this trial too: finish first for +50
          </p>
        )}
        {memorising ? (
          <div className="flex flex-col items-center gap-1 py-1" aria-label="Memorise">
            <p className="text-xs font-extrabold uppercase tracking-widest text-gold">{keeper}: memorise!</p>
            <p className="loota-count text-center font-display text-3xl font-extrabold leading-snug tracking-wide">{trial.show}</p>
            <p className="text-xs text-muted">Hidden in {Math.ceil(left - trial.seconds)}…</p>
          </div>
        ) : (
          <>
            {trial.show && !memorise && <p className="text-center text-2xl leading-relaxed tracking-wide" aria-label="Count these">{trial.show}</p>}
            {scramble ? (
              <div className="flex flex-wrap items-center justify-center gap-1">
                <span className="mr-1 text-xs font-bold text-muted">Unscramble:</span>
                <span className="flex flex-wrap justify-center gap-1" aria-label={`Letters: ${scramble.join(" ")}`}>
                  {scramble.map((ch, i) => (
                    <span key={i} className="flex size-8 items-center justify-center rounded-md bg-[#F5ECD8] font-display text-lg font-extrabold text-[#3A2410] shadow">
                      {ch}
                    </span>
                  ))}
                </span>
              </div>
            ) : (
              <p className="rounded-xl bg-ink-2 px-3 py-2 text-sm leading-snug">
                <span className="mr-1.5 font-bold text-gold">{keeper}:</span>
                {trial.prompt}
              </p>
            )}
            <div className="h-2 overflow-hidden rounded bg-line" role="timer" aria-label={`${Math.ceil(answerLeft)} seconds left`}>
              <div className={`h-full ${share < 0.3 ? "bg-danger" : "bg-gold"}`} style={{ width: `${share * 100}%` }} />
            </div>
          </>
        )}
        <div className={`grid grid-cols-2 gap-2 ${memorising ? "invisible" : ""}`}>
          {trial.choices.map((choice, i) => (
            <button
              key={i}
              type="button"
              disabled={sent !== null || memorising}
              onClick={() => choose(i)}
              className={`min-h-11 rounded-xl border-2 px-2 py-1 font-bold ${/^\p{Extended_Pictographic}/u.test(choice) ? "text-3xl" : "text-sm"} ${
                sent === i ? "border-gold bg-gold text-ink" : "border-line bg-ink text-paper"
              } disabled:cursor-default`}
            >
              {choice}
            </button>
          ))}
        </div>
        <p className="text-center text-[11px] text-muted">{memorising ? "Look closely…" : `${Math.ceil(answerLeft)} s left · a wrong answer or the time running out throws you 2 km away`}</p>
      </div>
    );
  }
  return (
    <div className="pointer-events-auto fixed inset-0 z-20 flex items-center justify-center bg-ink/80 p-4">
      <div role="dialog" aria-label="Key Trial" className="flex w-full max-w-lg flex-col gap-4 rounded-3xl bg-ink-2 p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-extrabold text-gold">Key Trial · Key {trial.key}</h2>
          <span className="text-sm text-muted">
            Question {trial.index + 1} of {trial.count}
          </span>
        </div>
        {rival && (
          <p className="loota-wonder-banner rounded-xl bg-danger/20 px-3 py-2 text-center text-sm font-extrabold text-paper ring-1 ring-danger" aria-label="Showdown">
            ⚔️ Showdown! {rival} is in this trial too: finish first for +50
          </p>
        )}
        {memorising ? (
          <div className="flex flex-col items-center gap-3 py-2" aria-label="Memorise">
            <p className="text-sm font-extrabold uppercase tracking-widest text-gold">Memorise!</p>
            <p className="loota-count text-center font-display text-4xl font-extrabold leading-snug tracking-wide">{trial.show}</p>
            <p className="text-sm text-muted">Hidden in {Math.ceil(left - trial.seconds)}…</p>
          </div>
        ) : (
          <>
            <div className="h-2 overflow-hidden rounded bg-line" role="timer" aria-label={`${Math.ceil(answerLeft)} seconds left`}>
              <div className={`h-full ${share < 0.3 ? "bg-danger" : "bg-gold"}`} style={{ width: `${share * 100}%` }} />
            </div>
            {trial.show && !memorise && <p className="text-center text-3xl leading-relaxed tracking-wide" aria-label="Count these">{trial.show}</p>}
            {scramble ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm font-bold text-muted">Unscramble:</p>
                <div className="flex flex-wrap justify-center gap-1.5" aria-label={`Letters: ${scramble.join(" ")}`}>
                  {scramble.map((ch, i) => (
                    <span key={i} className="flex size-10 items-center justify-center rounded-lg bg-[#F5ECD8] font-display text-xl font-extrabold text-[#3A2410] shadow">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center font-display text-2xl font-extrabold leading-snug">{trial.prompt}</p>
            )}
          </>
        )}
        <div className={`grid grid-cols-2 gap-3 ${memorising ? "invisible" : ""}`}>
          {trial.choices.map((choice, i) => (
            <button
              key={i}
              type="button"
              disabled={sent !== null || memorising}
              onClick={() => choose(i)}
              className={`min-h-14 rounded-2xl border-2 px-3 py-2 font-bold ${/^\p{Extended_Pictographic}/u.test(choice) ? "text-4xl" : "text-base"} ${
                sent === i ? "border-gold bg-gold text-ink" : "border-line bg-ink text-paper hover:border-gold"
              } disabled:cursor-default`}
            >
              {choice}
            </button>
          ))}
        </div>
        <p className="text-center text-xs text-muted">
          {memorising ? "Look closely…" : `${Math.ceil(answerLeft)} s left · one wrong answer or running out of time throws you 2 km away`}
        </p>
      </div>
    </div>
  );
}

/** What a key earned on top: first to it, golden minutes, a showdown won. */
function Bonuses({ bonuses }: { bonuses: Bonus[] }) {
  if (!bonuses.length) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-2xl bg-[#3B2F0A] p-3 text-sm font-bold text-gold" aria-label="Bonuses">
      {bonuses.map((b) => (
        <li key={b.kind} className="loota-wonder-banner">
          {BONUS_TEXT[b.kind]}
          {b.kind === "showdown" && b.rival ? ` against ${b.rival}` : ""}: +{b.coins} coins
        </li>
      ))}
    </ul>
  );
}

/** The player's hunt in one card: place, each key's time, medals, bonus coins; shareable. */
function RecapCard({ recap, onClose }: { recap: HuntRecap; onClose: () => void }) {
  const total = recap.finishedAt ? Math.round((Date.parse(recap.finishedAt) - Date.parse(recap.joinedAt)) / 60000) : null;
  const medalIcon = { first: "🥇", golden: "✨", showdown: "⚔️" } as const;
  const lines = [
    `🗝 ${recap.title}`,
    recap.place ? `I finished ${ordinal(recap.place)} of ${recap.hunters} hunters${total != null ? ` in ${total} min` : ""}!` : `${recap.keysHeld} of ${recap.keys} keys so far.`,
    ...recap.perKey.map((k) => `Key ${k.key}: ${k.minutes} min${k.tries > 1 ? ` (${k.tries} tries)` : ""}`),
    recap.medals.length ? `Medals: ${recap.medals.map((m) => medalIcon[m.kind]).join(" ")}` : "",
    "Play Loota.",
  ].filter(Boolean);
  async function share() {
    const text = lines.join("\n");
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
    } catch {
      // cancelled
    }
  }
  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-ink/85 p-5">
      <div role="dialog" aria-label="Your hunt" className="loota-wonder-banner flex w-full max-w-sm flex-col gap-3 rounded-3xl bg-[#F5ECD8] p-6 text-[#3A2410]">
        <LootaLogo height={52} tone="dark" />
        <p className="text-xs font-extrabold uppercase tracking-widest text-[#8A5A00]">{recap.title}</p>
        <p className="font-display text-5xl font-extrabold leading-none">{recap.place ? ordinal(recap.place) : `${recap.keysHeld}/${recap.keys}`}</p>
        <p className="text-sm">
          {recap.place ? `of ${recap.hunters} hunters` : "keys so far"}
          {total != null ? ` · ${total} minutes` : ""}
          {recap.place != null && recap.place <= recap.winners ? " · a winner!" : ""}
        </p>
        <ol className="flex flex-col gap-1 border-t border-[#3A2410]/20 pt-2 text-sm">
          {recap.perKey.map((k) => (
            <li key={k.key} className="flex justify-between">
              <span>🗝 Key {k.key}</span>
              <span className="font-bold">
                {k.minutes} min{k.tries > 1 ? ` · ${k.tries} tries` : ""}
              </span>
            </li>
          ))}
        </ol>
        {recap.medals.length > 0 && (
          <p className="text-sm" aria-label="Medals">
            {recap.medals.map((m, i) => (
              <span key={i} className="mr-2">
                {medalIcon[m.kind]} Key {m.key}
              </span>
            ))}
            <b>+{recap.bonusCoins} coins</b>
          </p>
        )}
        {recap.roadEvents > 0 && <p className="text-xs text-[#5A4020]">{recap.roadEvents} adventures on the road</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => void share()} className="h-11 flex-1 rounded-2xl bg-[#3A2410] font-bold text-[#F5ECD8]">
            Share
          </button>
          <button type="button" onClick={onClose} className="h-11 flex-1 rounded-2xl border-[1.5px] border-[#3A2410] font-bold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

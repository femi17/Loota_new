"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { LootaLogo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";
import {
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
  type RiddleClock,
  type TrialView,
  huntResumesAt,
} from "@/game/hunt";
import type { LngLat } from "@/game/geo";
import type { Place } from "@/game/places";
import { PlaceSearch } from "./PlaceSearch";
import { toast } from "./NewsToasts"; // hunt news shows on the map's news strip
import { PuzzleTrial } from "./puzzles/PuzzleTrial";
import { cue } from "@/game/sound";
import { Confetti } from "./Confetti";
import { StoryScene } from "./StoryScene";
import { defaultBeat, taunt, type StoryBeat, type StoryLine } from "@/game/story";

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
  /** Hold the hunter still until they've named the riddle's place (the riddle clock). */
  setHold: (hold: boolean) => void;
  /** Plan the way to a place (the journey planner, as the directions button does). */
  goTo: (place: Place) => void;
  /** Where the hunter is. */
  where: () => LngLat;
};

const ANSWER_MS = 15_000;
const CYCLE_MS = 75_000; // 15 s to answer, then a 60 s wait

/** The riddle clock now, from the server's times: answering (s left), waiting (s left), locked or ready. */
function clockNow(c: (RiddleClock & { skew: number; at: number }) | null, now: number) {
  if (!c) return null;
  if (c.phase !== "answer" && c.phase !== "wait") return { phase: c.phase, left: 0 };
  const start = c.phase === "answer" ? Date.parse(c.endsAt) - ANSWER_MS : Date.parse(c.until) - CYCLE_MS;
  // The card's clock ticks once a second and can lag while the map loads: never older than the server's answer.
  const since = Math.max(0, Math.max(now, c.at) + c.skew - start);
  const e = since % CYCLE_MS;
  return e < ANSWER_MS ? { phase: "answer" as const, left: Math.ceil((ANSWER_MS - e) / 1000) } : { phase: "wait" as const, left: Math.ceil((CYCLE_MS - e) / 1000) };
}

const FEED_MS = 6000;
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
  // The story (owner, 24 Oct 2026: the Masquerade): a beat at the start, after each key, at a relay, at the finish.
  const [story, setStory] = useState<{ lines: StoryLine[]; mood: "sly" | "cross" | "beaten" } | null>(null);
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [feed, setFeed] = useState<HuntFeed | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [revealed, setRevealed] = useState<string | null>(null); // the riddle being revealed (the start of the hunt)
  const [clock, setClock] = useState<(RiddleClock & { skew: number; at: number }) | null>(null);
  const [locking, setLocking] = useState(false);
  const feedSince = useRef<string | null>(null);
  const [tip, setTip] = useState<HuntFeed["tip"]>(null);
  const [rival, setRival] = useState<string | null>(null); // a showdown: someone else in this key's trial
  const [recap, setRecap] = useState<HuntRecap | null>(null);
  const recentTrials = useRef<{ who: string; key: number; at: number }[]>([]);
  const wasGolden = useRef(false);
  const skew = useRef(0); // the server's clock minus this device's
  const lastRank = useRef<number | null>(null);

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
      if (!shown) {
        setRevealed(next.riddle);
        void tellStory("start"); // the Masquerade first, then the riddle
      }
    }
    if (next.phase === "live" && next.joined && !next.finishedAt) void loadClock();
    else setClock(null);
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
    // 🏆 on the map's right: the leaderboard, on the card.
    const showBoard = () => void boardRef.current();
    window.addEventListener("loota:board", showBoard);
    // The map may be waiting to open a chest: after this render's effects, once searchRef holds the search.
    const ready = window.setTimeout(() => window.dispatchEvent(new Event("loota:hunt-ready")), 0);
    return () => {
      window.clearTimeout(ready);
      window.clearTimeout(timer);
      window.clearInterval(timer);
      window.removeEventListener("loota:hunt-changed", changed);
      window.removeEventListener("loota:hunt-search", openChest);
      window.removeEventListener("loota:board", showBoard);
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
          const quip = taunt(e.kind, e.who); // the Masquerade has his say, now and then
          if (quip) window.setTimeout(() => toast(quip), 1800);
          if (e.kind === "key" || e.kind === "relay" || e.kind === "finished") keys = true;
        }
        if (keys) {
          void refreshRef.current();
          window.dispatchEvent(new Event("loota:key-news")); // the 🏆 on the map lights up
        }
      }
      window.dispatchEvent(new CustomEvent("loota:golden", { detail: f.golden ? Date.parse(f.golden) - skew.current : null }));
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

  // The riddle clock: it starts when the hunter can see the riddle (nothing in front of it); they stand still until
  // they've named a place; the last seconds tick; reaching a wrong place opens a new 15 seconds.
  const tick = clockNow(clock, now);
  const canStart = !!racing && !!state?.riddle && clock?.phase === "ready" && !trial && !ending && !story && !revealed && !go && !scene;
  useEffect(() => {
    if (!canStart) return;
    void (async () => {
      const { data } = await supabase.rpc("start_riddle", { p_hunt: huntId });
      clockFrom(data);
      setOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once each time it becomes startable
  }, [canStart]);
  const holding = !!racing && (tick?.phase === "answer" || tick?.phase === "wait");
  useEffect(() => {
    actions.current?.setHold(holding);
  }, [holding, actions]);
  useEffect(() => () => actions.current?.setHold(false), [actions]);
  const answerLeft = tick?.phase === "answer" ? tick.left : null;
  useEffect(() => {
    if (answerLeft !== null && answerLeft <= 5) cue("tick");
  }, [answerLeft]);
  useEffect(() => {
    const wrong = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      cue("wrong");
      setOpen(true);
      setFeedback({ text: `🚫 Nothing here: the key isn't at ${name}. Quick, 15 seconds to name another place!`, hot: false });
      void loadClock();
    };
    window.addEventListener("loota:wrong-place", wrong);
    return () => window.removeEventListener("loota:wrong-place", wrong);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadClock reads the latest hunt
  }, [huntId]);

  const trialKeyRef = useRef<number | null>(null);
  useEffect(() => {
    trialKeyRef.current = trial?.key ?? null;
  });

  const searchRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    searchRef.current = search;
  });
  /** Open the card on its leaderboard (from 🏆 on the map's right). */
  const boardRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    boardRef.current = async () => {
      setOpen(true);
      if (!board) await toggleBoard();
    };
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
      } else if (r.reason === "answer_first") {
        setFeedback({ text: "Name the place first: type it in the box under the riddle.", hot: false });
        void loadClock();
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

  /** The riddle clock from the server (riddle_state, start_riddle and lock_guess all answer with it). */
  function clockFrom(data: unknown) {
    const r = data as (RiddleClock & { ok?: boolean; now?: string }) | null;
    if (!r || !("phase" in r)) {
      setClock(null);
      return;
    }
    const at = Date.now();
    setClock({ ...r, skew: r.now ? Date.parse(r.now) - at : 0, at });
  }
  async function loadClock() {
    const { data } = await supabase.rpc("riddle_state", { p_hunt: huntId });
    clockFrom(data);
  }

  /** Lock in a place for the riddle; then the way there is planned. */
  async function lockPlace(place: Place) {
    if (locking) return;
    setLocking(true);
    try {
      const { data } = await supabase.rpc("lock_guess", { p_hunt: huntId, p_lng: place.lng, p_lat: place.lat, p_name: place.name });
      const r = data as { ok: boolean; reason?: string } | null;
      clockFrom(data);
      if (r?.ok) {
        cue("go");
        setFeedback({ text: `📍 Locked in: ${place.name}. Go! Nobody knows if it's right until they get there.`, hot: false });
        actions.current?.goTo(place);
      } else if (r?.reason === "too_late") {
        cue("wrong");
        setFeedback({ text: "⏳ Too late! Wait for your next chance.", hot: false });
      }
    } finally {
      setLocking(false);
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

  /** Tell a beat of the story, once per device: the hunt's own lines, or the default. */
  async function tellStory(beat: StoryBeat) {
    const seen = `loota:story:${huntId}:${beat}`;
    try {
      if (localStorage.getItem(seen) === "1") return;
      localStorage.setItem(seen, "1");
    } catch {
      // Private browsing: it may be told again.
    }
    const { data } = await supabase.rpc("hunt_story_beat", { p_hunt: huntId, p_beat: beat });
    const r = data as { ok: boolean; lines: StoryLine[] | null; keys: number } | null;
    if (!r?.ok) return;
    const lines = r.lines?.length ? r.lines : defaultBeat(beat, huntId, r.keys);
    setStory({ lines, mood: beat === "finish" ? "beaten" : beat.startsWith("key:") ? "cross" : "sly" });
  }

  function closeEnding() {
    const was = ending;
    setEnding(null);
    actions.current?.setFrozen(false);
    if (was?.kind === "key") void tellStory(`key:${was.keysHeld}`);
    else if (was?.kind === "relay") void tellStory(`relay:${was.key}`);
    else if (was?.kind === "finished") void tellStory("finish");
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
                : state.phase === "paused" && !done
                  ? `${state.title} · back at 9 am`
                  : state.phase === "ended" && !done
                  ? `${state.title} · ended`
                  : done
                    ? `Finished ${ordinal(state.place ?? 0)}`
                    : `Key ${next} of ${state.keys}${state.trail ? " · the trail" : ""}`}
            </span>
            <span className="ml-auto text-muted" aria-hidden="true">{open ? "▴" : "▾"}</span>
          </button>
          {state.phase === "live" && !done && inArea && (!clock || clock.phase === "locked" || clock.phase === "ready") && (
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
            onClick={() => void toggleBoard()}
            aria-label="Leaderboard"
            aria-pressed={!!board}
            title="Leaderboard"
            className={`flex h-8 shrink-0 items-center gap-1 rounded-lg px-1.5 text-xs font-extrabold ${board ? "bg-gold text-ink" : "text-gold hover:bg-ink-2"}`}
          >
            <span aria-hidden="true">🏆</span>
            {racing && feed?.rank != null && <span>{ordinal(feed.rank)}</span>}
          </button>
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

        {/* 🏆: only the leaderboard (owner, 25 Oct 2026: "Clicking on the leaderboard. I am still getting the quiz question and all") */}
        {open && board && (
          <div className="flex flex-col gap-1 text-sm">
            <p className="px-2 text-xs font-extrabold uppercase tracking-wider text-gold">Leaderboard</p>
            <ol className="flex flex-col gap-1" aria-label="The leaderboard">
              {board.length === 0 && <li className="px-2 text-muted">No hunters yet.</li>}
              {board.map((row) => (
                <li key={row.rank} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${row.me ? "bg-ink-2 font-bold" : ""}`}>
                  <span className="min-w-0 flex-1 truncate">{row.username}</span>
                  <span className="shrink-0 font-bold text-gold" aria-label={`${row.keysHeld} key${row.keysHeld === 1 ? "" : "s"}`}>
                    🗝 {row.keysHeld}
                  </span>
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => setBoard(null)} className="mt-1 h-9 rounded-xl bg-ink-2 text-xs font-bold text-paper">
              Back to the riddle
            </button>
          </div>
        )}
        {open && !board && (
          <div className="flex flex-col gap-2 text-sm">
            {state.phase === "paused" && !done && (() => {
              const s = Math.max(0, Math.round((huntResumesAt(now) - now) / 1000));
              const two = (n: number) => String(n).padStart(2, "0");
              return (
                <div className="flex flex-col gap-1 rounded-xl bg-[#0B1630] p-3 text-[#C9D6FF]" role="status" aria-label="The hunt is resting">
                  <span className="font-bold">🌙 The hunt rests from 9 pm to 9 am (Lagos time).</span>
                  <span className="text-xs">Roam freely meanwhile: your keys and your place are kept.</span>
                  <span className="font-display text-xl font-extrabold tabular-nums text-paper">
                    Back in {two(Math.floor(s / 3600))}:{two(Math.floor((s % 3600) / 60))}:{two(s % 60)}
                  </span>
                </div>
              );
            })()}
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
                {tick?.phase === "answer" && (
                  <div className="flex flex-col gap-2 rounded-xl bg-ink-2 p-2.5 ring-1 ring-gold" aria-label="Name the place">
                    <div className="flex items-center justify-between text-xs font-extrabold">
                      <span className="text-gold">Where is it? Name the place</span>
                      <span className={`tabular-nums ${tick.left <= 5 ? "loota-pulse text-danger-text" : "text-paper"}`}>⏱ {tick.left}s</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink" aria-hidden="true">
                      <div
                        className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${tick.left <= 5 ? "bg-danger" : "bg-gold"}`}
                        style={{ width: `${(tick.left / 15) * 100}%` }}
                      />
                    </div>
                    <PlaceSearch
                      inline
                      autoFocus
                      placeholder="Type the place…"
                      near={() => actions.current?.where() ?? { lng: 0, lat: 0 }}
                      onPick={(place) => void lockPlace(place)}
                    />
                  </div>
                )}
                {tick?.phase === "wait" && (
                  <div className="flex flex-col gap-1.5 rounded-xl bg-[#3A1A1A] p-2.5 ring-1 ring-danger" role="status" aria-label="Waiting">
                    <span className="text-xs font-extrabold text-danger-text">⏳ Too slow! Others are already on their way.</span>
                    <span className="text-xs text-paper">
                      Your next chance to answer in <b className="tabular-nums">{tick.left}s</b>. Think it through…
                    </span>
                  </div>
                )}
                {clock?.phase === "locked" && (
                  <div className="flex items-center gap-2 rounded-xl bg-ink-2 p-2 text-xs" aria-label="Your answer">
                    <span aria-hidden="true">📍</span>
                    <span className="min-w-0 flex-1">
                      Your answer: <b className="text-paper">{clock.guess.name}</b>
                    </span>
                    <button
                      type="button"
                      onClick={() => actions.current?.goTo({ name: clock.guess.name, detail: "", lng: clock.guess.lng, lat: clock.guess.lat })}
                      className="shrink-0 rounded-lg border border-gold px-2 py-1 font-bold text-gold"
                    >
                      Show the way
                    </button>
                  </div>
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
          </div>
        )}
      </section>

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
      {story && <StoryScene key={story.lines[0]?.text} lines={story.lines} mood={story.mood} onDone={() => setStory(null)} />}
      {revealed && !go && !story && (
        <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-ink/85 p-5">
          <div role="dialog" aria-label="The first riddle" className="loota-wonder-banner flex w-full max-w-md flex-col gap-4 rounded-3xl bg-[#F5ECD8] p-6 text-center text-[#3A2410]">
            <LootaLogo height={64} tone="dark" className="mx-auto" />
            <p className="text-xs font-extrabold uppercase tracking-widest text-[#8A5A00]">The hunt is on · Key 1 of {state.keys}</p>
            <p className="font-display text-2xl font-extrabold leading-snug">The first riddle is sealed.</p>
            <p className="text-sm text-[#5A4020]">
              When you open it, you have <b>15 seconds</b> to name the place it points to. Miss it and you wait a minute while the
              others set off. Nobody knows if they&apos;re right until they get there.
            </p>
            <button type="button" onClick={() => setRevealed(null)} className="h-12 rounded-2xl bg-[#3A2410] font-bold text-[#F5ECD8]">
              Open the riddle
            </button>
          </div>
        </div>
      )}

      {trial &&
        (trial.kind === "puzzle" ? (
          <PuzzleTrial key={trial.attempt} huntId={huntId} trial={trial} rival={rival} world={scene} keeper={keeper} onResult={settle} />
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
                  The chest held a torn map, not Key {ending.key}. Someone moved it. A new riddle points to where it is now:
                  you&apos;ll have 15 seconds to name the place.
                </p>
              </>
            )}
            {ending.kind === "key" && (
              <>
                <Confetti />
                <p className="loota-key-spin text-6xl" aria-hidden="true">🗝️</p>
                <h2 className="font-display text-3xl font-extrabold text-gold">Key {ending.keysHeld} earned!</h2>
                <p className="text-muted">
                  {ending.keysHeld} of {ending.keys} keys. Your next riddle is ready: you&apos;ll have 15 seconds to name the place.
                </p>
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

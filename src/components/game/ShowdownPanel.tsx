"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PUZZLE_NAMES, type PuzzleKind } from "@/game/puzzles/names";
import { PuzzleBoard } from "./puzzles/PuzzleTrial";
import { cue } from "@/game/sound";

/**
 * Showdowns (owner, 14 Nov 2026: "if you have a key now… there as to be a relic, that shows people your location. and
 * when they are close to you. It will be like a showdown… the thief challenges you, you have a category… you pick one,
 * then the puzzle is shown, if you get it right you win, if you lose… the thief steals your key"). The Tracker's card,
 * the challenge button near a key holder, and the showdown itself: the target picks the kind of puzzle or runs; both
 * race on the same puzzle; the first right answer wins.
 */

export type ShowdownView = {
  id: number;
  role: "thief" | "target";
  thief: { id: string; name: string };
  target: { id: string; name: string };
  keyN: number;
  stake: number;
  status: "challenged" | "running" | "fight" | "stolen" | "defended" | "escaped" | "cancelled";
  offered: string[];
  kind: string | null;
  createdAt: string;
  runUntil: string | null;
  startsAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  winner: string | null;
  myTries: number;
  theirProgress: number;
  gap: number | null;
  thrown: { lng: number; lat: number } | null;
  now: string;
};
export type TrackedHolder = { id: string; name: string; keys: number; metres: number; bearing: number; band: string; lng: number | null; lat: number | null };
export type ShowdownTarget = { id: string; name: string; keys: number; metres: number; blocked: string | null; safeUntil: string | null };

export type ShowdownApi = {
  challenge: (id: string) => Promise<string | null>;
  reply: (choice: string) => Promise<void>;
  puzzle: () => Promise<{ kind: string; puzzle: unknown } | null>;
  solve: (answer: unknown) => Promise<{ result?: string; triesLeft?: number; rightOf?: { right: number; of: number } | null; reason?: string } | null>;
  progress: (share: number) => void;
  dismiss: () => void;
};

export const KIND_ICON: Record<string, string> = { flags: "🏳️", brands: "🏷️", grammar: "✍️", algebra: "➗", countries: "🌍", vowels: "🔤" };
const kindName = (k: string) => PUZZLE_NAMES[k as PuzzleKind]?.name ?? k;
const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

const BLOCKED: Record<string, string> = {
  fresh_key: "just won that key: safe for a few minutes",
  shielded: "shielded after a showdown",
  done: "you've had your showdown with them",
  busy: "busy right now",
  offline: "not playing right now",
};

/** Key holders within 50 m: the challenge. */
export function ChallengeBar({ targets, stake, busy, onChallenge }: { targets: ShowdownTarget[]; stake: number; busy: boolean; onChallenge: (id: string) => void }) {
  if (!targets.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[132px] z-20 flex flex-col items-center gap-1.5 px-3" data-challenge-bar>
      {targets.slice(0, 3).map((t) =>
        t.blocked ? (
          <span key={t.id} className="rounded-full bg-ink/90 px-3 py-1 text-xs font-bold text-paper/80 ring-1 ring-line">
            🛡 {t.name} · {BLOCKED[t.blocked] ?? "can't be challenged now"}
          </span>
        ) : (
          <button
            key={t.id}
            type="button"
            disabled={busy}
            onClick={() => onChallenge(t.id)}
            className="pointer-events-auto flex h-11 items-center gap-2 rounded-2xl bg-[#B4232A] px-4 text-sm font-extrabold text-white shadow-xl ring-2 ring-gold active:scale-95 disabled:opacity-50"
            aria-label={`Challenge ${t.name} to a showdown for a key`}
            data-challenge={t.id}
          >
            ⚔️ Challenge {t.name} · 🗝 {t.keys} <span className="font-bold text-white/80">· {stake} coins at stake</span>
          </button>
        ),
      )}
    </div>
  );
}

/** The Tracker: which way and how far each key holder is. */
export function TrackerCard({ holders, until, mapBearing }: { holders: TrackedHolder[]; until: number; mapBearing: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = secs(until - now);
  return (
    <div className="pointer-events-none absolute right-3 top-[176px] z-20 w-56 rounded-2xl bg-ink/92 p-2.5 text-paper shadow-xl ring-2 ring-[#FF4D6D]" role="status" aria-label="Tracker" data-tracker={holders.length}>
      <p className="flex items-center justify-between text-xs font-extrabold uppercase tracking-widest text-[#FF8FA3]">
        <span>🎯 Tracker</span>
        <span className="tabular-nums text-paper/70">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </span>
      </p>
      {holders.length === 0 ? (
        <p className="mt-1.5 text-xs text-paper/75">No key holders about right now.</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1">
          {holders.slice(0, 5).map((h) => (
            <li key={h.id} className="flex items-center gap-2 text-sm">
              <span className="inline-block text-base text-gold" style={{ transform: `rotate(${h.bearing - mapBearing}deg)` }} aria-hidden="true">
                ↑
              </span>
              <span className="min-w-0 flex-1 truncate font-bold">{h.name}</span>
              <span className="text-xs text-gold">🗝 {h.keys}</span>
              <span className="w-14 text-right text-xs tabular-nums text-paper/80">{h.metres <= 300 ? `${h.metres} m` : h.band}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The showdown: challenged, running, the race, the end. */
export function ShowdownPanel({ view, skew, api }: { view: ShowdownView; skew: number; api: ShowdownApi }) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + skew), 200);
    return () => window.clearInterval(t);
  }, [skew]);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<{ kind: string; puzzle: unknown } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const loading = useRef(false);
  const me = view.role === "thief" ? view.thief : view.target;
  const them = view.role === "thief" ? view.target : view.thief;
  const starts = view.startsAt ? Date.parse(view.startsAt) : 0;
  const ends = view.endsAt ? Date.parse(view.endsAt) : 0;
  const live = view.status === "fight" && now >= starts;

  // The puzzle, once the fight is on
  useEffect(() => {
    if (view.status !== "fight" || board || loading.current) return;
    loading.current = true;
    void api.puzzle().then((p) => {
      loading.current = false;
      if (p) setBoard(p);
    });
  }, [view.status, board, api]);
  const lastBeat = useRef(-1);
  useEffect(() => {
    if (view.status === "fight" && starts && now < starts) {
      const n = secs(starts - now);
      if (n !== lastBeat.current) {
        lastBeat.current = n;
        cue("tap");
      }
    }
  }, [now, starts, view.status]);
  const ended = view.status === "stolen" || view.status === "defended" || view.status === "escaped" || view.status === "cancelled";
  const wasEnded = useRef(ended);
  useEffect(() => {
    if (ended && !wasEnded.current) cue(view.winner === me.id || (view.status === "escaped" && view.role === "target") ? "solved" : "wrong");
    wasEnded.current = ended;
  }, [ended, view.winner, me.id, view.status, view.role]);

  const pick = async (choice: string) => {
    if (busy) return;
    setBusy(true);
    await api.reply(choice);
    setBusy(false);
  };
  const done = useCallback(
    async (answer: unknown) => {
      if (busy) return;
      setBusy(true);
      const r = await api.solve(answer);
      setBusy(false);
      if (r?.result === "wrong")
        setNote(
          r.triesLeft
            ? `Not quite${r.rightOf ? ` (${r.rightOf.right} of ${r.rightOf.of} right)` : ""}: one more try!`
            : "Out of tries: now it's down to them…",
        );
      else if (r?.reason === "tries") setNote("Out of tries: now it's down to them…");
    },
    [api, busy],
  );

  let body: React.ReactNode;
  if (view.status === "challenged") {
    const left = secs(Date.parse(view.createdAt) + 20_000 - now);
    body =
      view.role === "target" ? (
        <>
          <h2 className="font-display text-2xl font-extrabold">⚔️ {them.name} challenges you!</h2>
          <p className="text-sm text-paper/85">
            They want your Key {view.keyN}. Pick your battle: you both get the same puzzle, and the first right answer wins. Lose, and they take the key.
          </p>
          <div className="grid w-full gap-2">
            {view.offered.map((k) => (
              <button key={k} type="button" disabled={busy} onClick={() => void pick(k)} className="flex h-12 items-center gap-3 rounded-xl bg-gold px-4 text-left text-base font-extrabold text-ink active:scale-95 disabled:opacity-50" data-showdown-pick={k}>
                <span aria-hidden="true">{KIND_ICON[k] ?? "🧩"}</span> {kindName(k)}
              </button>
            ))}
            <button type="button" disabled={busy} onClick={() => void pick("run")} className="h-12 rounded-xl border-[1.5px] border-paper/40 px-4 text-base font-bold text-paper active:scale-95 disabled:opacity-50" data-showdown-run>
              🏃 Run: get 300 m away in 30 s
            </button>
          </div>
          <p className="text-xs font-bold text-gold">{left}s to choose, or one is picked for you</p>
        </>
      ) : (
        <>
          <h2 className="font-display text-2xl font-extrabold">⚔️ You challenged {them.name}</h2>
          <p className="text-sm text-paper/85">
            {`For their Key ${view.keyN}, with ${view.stake} coins at stake. They're choosing the battle… (or they'll run)`}
          </p>
          <p className="text-xs font-bold text-gold">{left}s</p>
        </>
      );
  } else if (view.status === "running") {
    const left = secs(Date.parse(view.runUntil ?? view.now) - now);
    body =
      view.role === "target" ? (
        <>
          <h2 className="font-display text-2xl font-extrabold">🏃 Run!</h2>
          <p className="text-sm text-paper/85">{`Get 300 m away from ${them.name} before the time's up, or the showdown is on.`}</p>
          <p className="text-3xl font-extrabold tabular-nums text-gold">{view.gap ?? "?"} m · {left}s</p>
        </>
      ) : (
        <>
          <h2 className="font-display text-2xl font-extrabold">🏃 {them.name} is running!</h2>
          <p className="text-sm text-paper/85">Stay within 300 m of them for {left}s and the showdown is on.</p>
          <p className="text-3xl font-extrabold tabular-nums text-gold">{view.gap ?? "?"} m</p>
        </>
      );
  } else if (view.status === "fight") {
    const toGo = secs(starts - now);
    const left = secs(ends - now);
    body = (
      <>
        <div className="flex w-full items-center justify-between gap-2 text-sm font-extrabold">
          <span className="truncate text-gold">{me.name} (you)</span>
          <span className="text-paper/60">vs</span>
          <span className="truncate text-[#FF8FA3]">{them.name}</span>
        </div>
        <div className="flex w-full items-center gap-2" aria-label={`${them.name}'s progress`}>
          <span className="text-xs text-paper/70">{them.name}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-2">
            <div className="h-full rounded-full bg-[#FF4D6D] transition-[width] duration-500" style={{ width: `${Math.round(view.theirProgress * 100)}%` }} />
          </div>
        </div>
        {!live ? (
          <p className="py-6 text-6xl font-extrabold tabular-nums text-gold" data-showdown-countdown>
            {toGo || "GO!"}
          </p>
        ) : (
          <>
            <p className="flex w-full items-center justify-between text-xs font-bold">
              <span>
                {KIND_ICON[view.kind ?? ""] ?? "🧩"} {kindName(view.kind ?? "")} · {PUZZLE_NAMES[view.kind as PuzzleKind]?.rule}
              </span>
              <span className={`tabular-nums ${left <= 10 ? "text-danger-text" : "text-gold"}`}>{left}s</span>
            </p>
            {note && <p className="text-xs font-bold text-gold">{note}</p>}
            <div className="w-full" data-showdown-board={view.kind ?? ""}>
              {board ? (
                <PuzzleBoard kind={board.kind} puzzle={board.puzzle} warn={false} disabled={busy || view.myTries >= 2} onDone={(a) => void done(a)} onProgress={api.progress} />
              ) : (
                <p className="text-sm text-paper/70">…</p>
              )}
            </div>
            <p className="text-[11px] text-paper/60">{2 - view.myTries} {2 - view.myTries === 1 ? "try" : "tries"} left</p>
          </>
        )}
      </>
    );
  } else {
    const won = view.winner === me.id;
    const text =
      view.status === "escaped"
        ? view.role === "target"
          ? `You got away from ${them.name}! Your key is safe.`
          : `${them.name} got away. Your ${view.stake} coins are back.`
        : view.status === "stolen"
          ? view.role === "thief"
            ? `You won! Key ${view.keyN} is yours: on to your next key.`
            : `${them.name} won and took your Key ${view.keyN}. Go back and win it again: its place is on your map.`
          : view.role === "target"
            ? `You won! Your key stays with you, and ${them.name}'s ${view.stake} coins are yours.`
            : `${them.name} won and kept the key. You lost your ${view.stake} coins and were thrown 2 km away.`;
    body = (
      <>
        <h2 className="font-display text-3xl font-extrabold">{view.status === "escaped" ? "🏃" : won ? "🏆" : "💀"} {view.status === "escaped" ? "Got away" : won ? "You win!" : "You lose"}</h2>
        <p className="text-base text-paper/90" data-showdown-result={view.status}>
          {text}
        </p>
        <button type="button" onClick={api.dismiss} className="h-11 w-full rounded-xl bg-gold text-base font-extrabold text-ink">
          OK
        </button>
      </>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-ink/60 sm:items-center" role="dialog" aria-label="Showdown" data-showdown={view.status}>
      <div className="flex max-h-[92dvh] w-full flex-col items-center gap-3 overflow-y-auto rounded-t-3xl bg-ink p-4 text-center text-paper ring-2 ring-[#FF4D6D] sm:max-w-md sm:rounded-3xl" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <p className="text-xs font-extrabold uppercase tracking-[0.25em] text-[#FF8FA3]">⚔️ Showdown · Key {view.keyN}</p>
        {body}
      </div>
    </div>
  );
}

/** A showdown as the broadcast's viewers see it: who against whom, for which key, both their progress, how it ended. */
export type BroadcastShowdownData = {
  id: number;
  thief: string;
  target: string;
  thiefName: string;
  targetName: string;
  keyN: number;
  status: ShowdownView["status"];
  kind: string | null;
  createdAt: string;
  runUntil: string | null;
  startsAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  winner: string | null;
  thiefProgress: number;
  targetProgress: number;
  thiefTries: number;
  targetTries: number;
};
export function BroadcastShowdown({ sd, skew }: { sd: BroadcastShowdownData; skew: number }) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + skew), 250);
    return () => window.clearInterval(t);
  }, [skew]);
  const starts = sd.startsAt ? Date.parse(sd.startsAt) : 0;
  const ends = sd.endsAt ? Date.parse(sd.endsAt) : 0;
  const line =
    sd.status === "challenged"
      ? `${sd.targetName} is choosing the battle… or will they run? ${secs(Date.parse(sd.createdAt) + 20_000 - now)}s`
      : sd.status === "running"
        ? `🏃 ${sd.targetName} is running! 300 m away in ${secs(Date.parse(sd.runUntil ?? sd.createdAt) - now)}s, or the showdown is on`
        : sd.status === "fight"
          ? now < starts
            ? `${KIND_ICON[sd.kind ?? ""] ?? "🧩"} ${kindName(sd.kind ?? "")}: starting in ${secs(starts - now)}…`
            : `${KIND_ICON[sd.kind ?? ""] ?? "🧩"} ${kindName(sd.kind ?? "")} · the same puzzle for both · ${secs(ends - now)}s left`
          : sd.status === "stolen"
            ? `🗝️ ${sd.thiefName} wins and steals Key ${sd.keyN} from ${sd.targetName}!`
            : sd.status === "defended"
              ? `🛡️ ${sd.targetName} wins and keeps the key! ${sd.thiefName} is thrown 2 km away`
              : sd.status === "escaped"
                ? `🏃 ${sd.targetName} got away!`
                : "";
  const bar = (name: string, share: number, tries: number, colour: string, won: boolean) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <p className={`truncate text-base font-extrabold ${won ? "text-gold" : ""}`}>
        {won ? "🏆 " : ""}
        {name}
      </p>
      {sd.status === "fight" || sd.endedAt ? (
        <>
          <div className="h-3 overflow-hidden rounded-full bg-ink-2">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.round(share * 100)}%`, background: colour }} />
          </div>
          <p className="text-xs text-paper/60">{tries ? `${tries} wrong` : " "}</p>
        </>
      ) : null}
    </div>
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-16 z-30 w-[min(92vw,40rem)] -translate-x-1/2" role="status" aria-label="Showdown" data-showdown-shown={sd.status}>
      <div className="flex flex-col gap-2 rounded-2xl bg-ink/95 px-5 py-3 text-paper shadow-2xl ring-2 ring-[#FF4D6D]">
        <p className="text-center text-sm font-extrabold uppercase tracking-[0.3em] text-[#FF8FA3]">⚔️ Showdown · Key {sd.keyN}</p>
        <div className="flex items-center gap-4">
          {bar(`${sd.thiefName} (thief)`, sd.status === "stolen" ? 1 : sd.thiefProgress, sd.thiefTries, "#FF4D6D", sd.winner === sd.thief)}
          <span className="text-lg font-extrabold text-paper/50">vs</span>
          {bar(`${sd.targetName} (key holder)`, sd.status === "defended" && sd.winner === sd.target && sd.targetProgress > 0 ? 1 : sd.targetProgress, sd.targetTries, "#F4B41A", sd.winner === sd.target)}
        </div>
        <p className="text-center text-sm font-bold text-gold" data-showdown-line>
          {line}
        </p>
      </div>
    </div>
  );
}

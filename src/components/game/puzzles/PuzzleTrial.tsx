"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnswerResult, PuzzleTrialView } from "@/game/hunt";
import { PUZZLE_NAMES } from "@/game/puzzles/names";
import { SentriesBoard } from "./SentriesBoard";
import { RouteBoard } from "./RouteBoard";
import { AdireBoard } from "./AdireBoard";
import { TornMapBoard } from "./TornMapBoard";
import { checkTornMap, type TornMapPuzzle } from "@/game/puzzles/tornmap";

type SentriesP = { n: number; regions: number[] };
type RouteP = { n: number; numbers: Record<number, number>; walls: [number, number][] };
type AdireP = { n: number; given: Record<number, 0 | 1>; signs: { cell: number; dir: "r" | "d"; same: boolean }[] };

/**
 * A Key Trial puzzle (owner, 24 Oct 2026: "a task, like solve a puzzle"). The puzzle comes from the game's server when
 * this opens (its clock starts then); the board checks itself the moment it's complete (the server judges). Early keys
 * warn when a rule is broken; later keys don't, and a wrong answer costs one of two lives. The clock or the lives
 * running out throws the hunter 2 km away.
 */
export function PuzzleTrial({
  trial,
  rival,
  world = false,
  keeper = "The Keeper",
  onResult,
}: {
  trial: PuzzleTrialView;
  rival: string | null;
  world?: boolean;
  keeper?: string;
  /** The server's verdict: the key, finished, or failed (a wrong answer with lives left is handled here). */
  onResult: (r: AnswerResult | null) => void;
}) {
  const [view, setView] = useState<PuzzleTrialView>(trial);
  const [left, setLeft] = useState<number | null>(trial.secondsLeft);
  const [sending, setSending] = useState(false);
  const [shake, setShake] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [showRule, setShowRule] = useState(true);
  const [solved, setSolved] = useState(false); // right: a moment to see the finished board before the result
  const done = useRef(false);
  const resultRef = useRef(onResult);
  useEffect(() => {
    resultRef.current = onResult;
  });

  // The puzzle (and the clock) from the game's server.
  useEffect(() => {
    if (view.puzzle) return;
    let gone = false;
    void fetch("/api/trial/puzzle", { method: "POST" })
      .then((r) => (r.ok ? (r.json() as Promise<PuzzleTrialView>) : null))
      .then((v) => {
        if (gone) return;
        if (!v?.puzzle) {
          resultRef.current(null);
          return;
        }
        setView(v);
        setLeft(v.secondsLeft);
      });
    return () => {
      gone = true;
    };
  }, [view.puzzle]);

  async function send(answer: unknown) {
    if (done.current || sending) return;
    setSending(true);
    const res = await fetch("/api/trial/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attempt: view.attempt, answer }),
    }).catch(() => null);
    const r = (res?.ok ? await res.json() : null) as AnswerResult | null;
    setSending(false);
    if (r?.ok && r.result === "wrong") {
      setView((v) => ({ ...v, lives: r.lives }));
      setShake((s) => s + 1);
      setNote(`Not right! ${r.lives === 1 ? "One life left." : `${r.lives} lives left.`} Look again.`);
      navigator.vibrate?.([80, 60, 80]);
      return;
    }
    done.current = true;
    if (r?.ok && (r.result === "key" || r.result === "finished" || r.result === "relay")) {
      setSolved(true);
      navigator.vibrate?.(60);
      window.setTimeout(() => resultRef.current(r), 1300);
      return;
    }
    resultRef.current(r);
  }

  // The clock: at nought, the trial is lost (the server agrees: it keeps the same clock).
  const deadline = useRef<number | null>(null);
  useEffect(() => {
    if (view.secondsLeft === null) return;
    deadline.current = performance.now() + view.secondsLeft * 1000;
    const timer = window.setInterval(() => {
      const s = Math.max(0, ((deadline.current ?? 0) - performance.now()) / 1000);
      setLeft(s);
      if (s <= 0 && !done.current) void send(null);
    }, 200);
    return () => window.clearInterval(timer);
    // send is stable enough here: it reads the latest state through refs and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.secondsLeft]);

  const warn = view.level <= 1;
  const info = PUZZLE_NAMES[view.puzzleKind];
  const share = left === null ? 1 : left / view.seconds;
  const urgent = left !== null && left <= 15;

  const wrap = world
    ? "pointer-events-auto fixed inset-x-0 bottom-0 z-20 flex max-h-[86dvh] flex-col gap-2 overflow-y-auto rounded-t-3xl bg-ink/95 p-3 backdrop-blur-sm sm:inset-x-auto sm:left-1/2 sm:w-[30rem] sm:-translate-x-1/2"
    : "pointer-events-auto fixed inset-0 z-20 flex flex-col items-center justify-center bg-ink/85 p-3";
  const card = world ? "contents" : "flex max-h-full w-full max-w-md flex-col gap-2 overflow-y-auto rounded-3xl bg-ink-2 p-4";

  return (
    <div data-scene-strip={world ? "" : undefined} className={wrap} style={world ? { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" } : undefined}>
      <div role="dialog" aria-label="Key Trial" className={card}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display text-sm font-extrabold text-gold">Key Trial · Key {view.key}</p>
            <p className="font-display text-xl font-extrabold leading-tight">{info.name}</p>
          </div>
          <div className="flex items-center gap-1 text-lg" aria-label={`${view.lives} ${view.lives === 1 ? "life" : "lives"} left`}>
            {[0, 1].map((i) => (
              <span key={i} className={i < view.lives ? "" : "opacity-25 grayscale"} aria-hidden="true">
                ❤️
              </span>
            ))}
          </div>
        </div>
        {rival && (
          <p className="loota-wonder-banner rounded-lg bg-danger/20 px-2 py-1 text-center text-xs font-extrabold text-paper ring-1 ring-danger" aria-label="Showdown">
            ⚔️ Showdown! {rival} is in this trial too: finish first for +50
          </p>
        )}
        <div className="h-2.5 overflow-hidden rounded-full bg-line" role="timer" aria-label={left === null ? "Starting" : `${Math.ceil(left)} seconds left`}>
          <div className={`h-full rounded-full transition-[width] duration-200 ${urgent ? "loota-pulse bg-danger" : share < 0.4 ? "bg-[#F28C28]" : "bg-gold"}`} style={{ width: `${share * 100}%` }} />
        </div>
        <button type="button" onClick={() => setShowRule((s) => !s)} className="text-left text-xs leading-snug text-paper/80">
          <span className="mr-1 font-bold text-gold">{keeper}:</span>
          {showRule ? info.rule : "Tap to see the rules."}
          {!warn && showRule && <span className="text-muted"> No warnings at this key: a wrong answer costs a life.</span>}
        </button>

        <div key={shake} className={`relative mx-auto w-full max-w-[min(100%,26rem)] ${shake ? "loota-shake" : ""}`}>
          {solved && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex aspect-square items-center justify-center rounded-xl ring-4 ring-gold" aria-live="polite">
              <span className="loota-wonder-banner rounded-2xl bg-ink px-5 py-2 font-display text-3xl font-extrabold text-gold shadow-lg ring-2 ring-gold">Solved!</span>
            </div>
          )}
          {!view.puzzle ? (
            <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-ink-2 text-sm text-muted">The chest creaks open…</div>
          ) : view.puzzleKind === "sentries" ? (
            <SentriesPlay p={view.puzzle as SentriesP} warn={warn} disabled={sending || solved || left === 0} onDone={send} />
          ) : view.puzzleKind === "route" ? (
            <RoutePlay p={view.puzzle as RouteP} disabled={sending || solved || left === 0} onDone={send} />
          ) : view.puzzleKind === "tornmap" ? (
            <TornMapPlay p={view.puzzle as TornMapPuzzle} disabled={sending || solved || left === 0} onDone={send} />
          ) : (
            <AdirePlay p={view.puzzle as AdireP} warn={warn} disabled={sending || solved || left === 0} onDone={send} />
          )}
        </div>
        {note && (
          <p role="status" className="rounded-lg bg-danger/20 px-2 py-1 text-center text-sm font-bold text-paper">
            {note}
          </p>
        )}
        <p className={`text-center text-[11px] ${urgent ? "font-bold text-danger" : "text-muted"}`}>
          {left === null ? "Opening the chest…" : `${Math.ceil(left)} s left · time running out throws you 2 km away`}
          {sending ? " · checking…" : ""}
        </p>
      </div>
    </div>
  );
}

/** Sentries: tap to mark; complete (a sentry in every row) sends it. */
function SentriesPlay({ p, warn, disabled, onDone }: { p: SentriesP; warn: boolean; disabled: boolean; onDone: (a: unknown) => void }) {
  const [marks, setMarks] = useState<number[]>(() => new Array(p.n * p.n).fill(0));
  const placed = marks.flatMap((m, i) => (m === 2 ? [[Math.floor(i / p.n), i % p.n]] : []));
  const complete = placed.length === p.n;
  const sentFor = useRef("");
  useEffect(() => {
    const key = JSON.stringify(placed);
    if (complete && sentFor.current !== key) {
      sentFor.current = key;
      onDone(placed);
    }
  });
  return (
    <div className="flex flex-col gap-2">
      <SentriesBoard n={p.n} regions={p.regions} marks={marks} warn={warn} disabled={disabled} onTap={(i) => setMarks((m) => m.map((v, k) => (k === i ? (v + 1) % 3 : v)))} />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {placed.length} of {p.n} sentries posted
        </span>
        <button type="button" disabled={disabled} onClick={() => setMarks(new Array(p.n * p.n).fill(0))} className="font-bold text-gold disabled:opacity-40">
          Clear
        </button>
      </div>
    </div>
  );
}

/** Route: draw it; complete (every square, ending on the last number) sends it. */
function RoutePlay({ p, disabled, onDone }: { p: RouteP; disabled: boolean; onDone: (a: unknown) => void }) {
  const [path, setPath] = useState<number[]>([]);
  const last = useMemo(() => Math.max(...Object.values(p.numbers)), [p.numbers]);
  const complete = path.length === p.n * p.n && p.numbers[path[path.length - 1]] === last;
  const sentFor = useRef("");
  useEffect(() => {
    const key = path.join(",");
    if (complete && sentFor.current !== key) {
      sentFor.current = key;
      onDone(path);
    }
  });
  return (
    <div className="flex flex-col gap-2">
      <RouteBoard n={p.n} numbers={p.numbers} walls={p.walls ?? []} path={path} disabled={disabled} onPath={setPath} />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {path.length} of {p.n * p.n} squares
        </span>
        <span className="flex gap-3">
          <button type="button" disabled={disabled || path.length === 0} onClick={() => setPath((x) => x.slice(0, -1))} className="font-bold text-gold disabled:opacity-40">
            Undo
          </button>
          <button type="button" disabled={disabled || path.length === 0} onClick={() => setPath([])} className="font-bold text-gold disabled:opacity-40">
            Clear
          </button>
        </span>
      </div>
    </div>
  );
}

/** Torn Map: tap two squares to swap their pieces (tap a chosen one again to turn it, when pieces turn); whole sends it. */
function TornMapPlay({ p, disabled, onDone }: { p: TornMapPuzzle; disabled: boolean; onDone: (a: unknown) => void }) {
  const [placed, setPlaced] = useState<[number, number][]>(() => p.start.map(([piece, q]) => [piece, q]));
  const [selected, setSelected] = useState<number | null>(null);
  const whole = useMemo(() => checkTornMap(p, placed), [p, placed]);
  const sentFor = useRef("");
  useEffect(() => {
    const key = JSON.stringify(placed);
    if (whole && sentFor.current !== key) {
      sentFor.current = key;
      onDone(placed);
    }
  });
  const tap = (square: number) => {
    if (selected === null) setSelected(square);
    else if (selected === square) {
      if (p.rotate) setPlaced((x) => x.map((pq, i) => (i === square ? [pq[0], (pq[1] + 1) % 4] : pq)));
      else setSelected(null);
    } else {
      setPlaced((x) => x.map((pq, i) => (i === square ? x[selected] : i === selected ? x[square] : pq)));
      setSelected(null);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <TornMapBoard drawing={p} n={p.n} placed={placed} selected={whole ? null : selected} disabled={disabled} whole={whole} onTap={tap} />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{whole ? "The map is whole!" : p.rotate ? "Tap two pieces to swap; tap a chosen piece again to turn it" : "Tap two pieces to swap them"}</span>
        <button type="button" disabled={disabled || selected === null} onClick={() => setSelected(null)} className="font-bold text-gold disabled:opacity-40">
          Let go
        </button>
      </div>
    </div>
  );
}

/**
 * Adire: tap to dye; "Check" sends it once every square is dyed (not by itself: a square passes through indigo on its
 * way to white, which would send a half-finished cloth).
 */
function AdirePlay({ p, warn, disabled, onDone }: { p: AdireP; warn: boolean; disabled: boolean; onDone: (a: unknown) => void }) {
  const fresh = () => [...Array(p.n * p.n).keys()].map((i) => (p.given[i] !== undefined ? p.given[i] : -1));
  const [cloth, setCloth] = useState<number[]>(fresh);
  const complete = cloth.every((v) => v >= 0);
  return (
    <div className="flex flex-col gap-2">
      <AdireBoard
        n={p.n}
        given={p.given}
        signs={p.signs}
        cloth={cloth}
        warn={warn}
        disabled={disabled}
        onTap={(i) => setCloth((c) => c.map((v, k) => (k === i ? (v === -1 ? 1 : v === 1 ? 0 : -1) : v)))}
      />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {cloth.filter((v) => v >= 0).length} of {p.n * p.n} squares dyed
        </span>
        <button type="button" disabled={disabled} onClick={() => setCloth(fresh())} className="font-bold text-gold disabled:opacity-40">
          Clear
        </button>
      </div>
      <button
        type="button"
        disabled={disabled || !complete}
        onClick={() => onDone(cloth)}
        className="h-12 rounded-xl bg-gold font-display text-base font-extrabold text-ink disabled:opacity-35"
      >
        {complete ? "Check the cloth ✓" : "Dye every square, then check"}
      </button>
    </div>
  );
}

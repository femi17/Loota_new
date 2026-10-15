"use client";

import { useEffect, useState } from "react";
import { RELICS, type RelicId } from "@/game/items";

/** A Detour (design doc 7.5): an offer everyone in the area shares. Times are on this device's clock (ms). */
export type LampDetour = {
  id: string;
  kind: "flash" | "rush" | "flash_rush";
  title: string;
  story: string;
  place: string;
  lng: number;
  lat: number;
  metres: number;
  endsAt: number;
  capacity: number | null;
  claimed: number;
  coins: number;
  relic: RelicId | null;
  /** How the player's own try went, if they've tried. */
  mine: "asked" | "won" | "wrong" | "late" | "full" | null;
};

/** A whisper: a lead to a hidden find nearby (sometimes a lie); it fades after a while. */
export type LampWhisper = { id: string; lng: number; lat: number; metres: number; direction: string; endsAt: number };

/** The Lockdown Orb, when it's lying somewhere in the world. */
export type LampOrb = { id: string; lng: number; lat: number; metres: number; endsAt: number };

/** The lamp holds one thing at a time (owner's call, 15 Oct 2026). */
export type LampItem = ({ type: "detour" } & LampDetour) | ({ type: "whisper" } & LampWhisper) | ({ type: "orb" } & LampOrb);
export type LampState = { current: LampItem | null };

export type LampQuestion = { detourId: string; title: string; question: string; options: string[]; seconds: number; endsAt: number };
export type LampResult = { outcome: "won" | "wrong" | "late" | "full"; answer: string; coins: number; relic: RelicId | null };

export type LampActions = {
  refresh: () => Promise<LampState>;
  start: (detour: LampDetour) => Promise<LampQuestion | string>;
  answer: (detourId: string, choice: number) => Promise<LampResult | string>;
  /** Draw the way there (only now: the lamp keeps routes hidden until asked). */
  showWay: (to: { lng: number; lat: number; name: string }) => void;
  /** Pass on this one: the lamp moves on to the next. */
  dismiss: (item: LampItem) => Promise<LampState>;
};

/** Close enough to claim (start_detour allows 40 m). */
export const DETOUR_REACH_M = 35;

const distance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`);
const countdown = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m}:${String(s % 60).padStart(2, "0")}`;
};
const KIND = {
  flash: "⚡ Flash: gone when the time runs out",
  rush: "🏃 Rush: only the first to arrive",
  flash_rush: "🔥 Flash rush: the first few, before time runs out",
} as const;
const rewardText = (coins: number, relic: RelicId | null) => (relic ? `${RELICS[relic].name} (${RELICS[relic].rarity.toLowerCase()} relic)` : `${coins} coins`);

/** The lamp (design doc 7.4): one thing at a time (a Detour, a whisper or the Orb), with the way there on request. */
export function LampPanel({
  actions,
  quiz: firstQuiz,
  onClose,
}: {
  actions: LampActions;
  /** Opened by the Claim button at a Detour's place: the question already asked. */
  quiz: LampQuestion | string | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<LampState | null>(null);
  const [quiz, setQuiz] = useState<LampQuestion | null>(typeof firstQuiz === "object" ? firstQuiz : null);
  const [message, setMessage] = useState<string | null>(typeof firstQuiz === "string" ? firstQuiz : null);
  const [result, setResult] = useState<LampResult | null>(null);
  const [working, setWorking] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let live = true;
    void actions.refresh().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [actions]);

  // Countdowns.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, []);

  const claim = async (d: LampDetour) => {
    setWorking(true);
    setMessage(null);
    const q = await actions.start(d);
    setWorking(false);
    if (typeof q === "string") setMessage(q);
    else {
      setResult(null);
      setQuiz(q);
    }
  };

  const choose = async (choice: number) => {
    if (!quiz || working) return;
    setWorking(true);
    const r = await actions.answer(quiz.detourId, choice);
    setWorking(false);
    if (typeof r === "string") setMessage(r);
    else setResult(r);
  };

  const way = (to: { lng: number; lat: number; name: string }) => {
    actions.showWay(to);
    onClose();
  };

  const letGo = async (item: LampItem) => {
    setWorking(true);
    setState(await actions.dismiss(item));
    setWorking(false);
  };

  const button = "h-10 rounded-xl px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";
  const left = quiz ? Math.max(0, Math.ceil((quiz.endsAt - now) / 1000)) : 0;
  const item = state?.current ?? null;
  const ends = item && now > 0 ? (
    <span className="text-xs font-bold text-paper/80" aria-label="Time left">
      ⏳ {item.endsAt > now ? countdown(item.endsAt - now) : "over"}
    </span>
  ) : null;
  const letGoButton = item && (
    <button type="button" disabled={working} onClick={() => void letGo(item)} className="self-start text-xs font-bold text-muted underline disabled:opacity-40">
      Let it go
    </button>
  );

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/60 sm:items-center" onClick={quiz && !result ? undefined : onClose}>
      <div
        role="dialog"
        aria-label="The lamp"
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-ink p-5 sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold">{quiz ? quiz.title : "🪔 The lamp"}</h2>
            <p className="text-sm text-muted">{quiz ? "Answer before the time runs out." : "One thing at a time: chase it, or let it go."}</p>
          </div>
          {(!quiz || result) && (
            <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>

        {message && <p className="mb-3 rounded-xl bg-ink-2 p-3 text-sm ring-1 ring-gold">{message}</p>}

        {quiz ? (
          result ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4">
              <p className={`text-lg font-bold ${result.outcome === "won" ? "text-[#3DD68C]" : "text-danger"}`}>
                {result.outcome === "won"
                  ? `✓ It's yours: ${rewardText(result.coins, result.relic)}!`
                  : result.outcome === "full"
                    ? "✗ Right, but too slow: others got there first."
                    : result.outcome === "late"
                      ? "✗ Too late"
                      : "✗ Not quite"}
              </p>
              {result.outcome !== "won" && result.outcome !== "full" && (
                <p className="text-sm">
                  The answer: <b>{result.answer}</b>
                </p>
              )}
              {result.relic && <p className="text-sm text-muted">It&apos;s in your bag for 7 days.</p>}
              <button type="button" onClick={onClose} className={`${button} self-start bg-gold text-ink`}>
                Done
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="h-2 overflow-hidden rounded bg-line">
                <div className="h-full bg-gold transition-[width] duration-200" style={{ width: `${(left / quiz.seconds) * 100}%` }} />
              </div>
              <p className="text-lg font-bold">{quiz.question}</p>
              <ul className="flex flex-col gap-2">
                {quiz.options.map((option, i) => (
                  <li key={option}>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void choose(i)}
                      className="w-full rounded-xl bg-ink-2 px-4 py-3 text-left text-sm font-bold ring-1 ring-line hover:ring-gold disabled:opacity-50"
                    >
                      {option}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">{left} s left</p>
            </div>
          )
        ) : !state ? (
          <p className="text-sm text-muted">The lamp flickers…</p>
        ) : !item ? (
          <p className="rounded-2xl bg-ink-2 p-4 text-sm text-muted">The lamp is quiet. Keep roaming: it glows when something stirs nearby.</p>
        ) : item.type === "orb" ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-[#2A1747] p-4 ring-2 ring-[#9B5DE5]">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold">🔮 The Lockdown Orb has surfaced</p>
              {ends}
            </div>
            <p className="text-sm text-paper/85">
              One in the world, and only one hand can hold it. It raises a dome over a key that nobody outside can enter. It lies {distance(item.metres)} from
              you.
            </p>
            <button type="button" onClick={() => way({ lng: item.lng, lat: item.lat, name: "the Lockdown Orb" })} className={`${button} self-start bg-[#9B5DE5] text-paper`}>
              Show me the way
            </button>
            {letGoButton}
          </div>
        ) : item.type === "whisper" ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-ink-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold">🌬 A whisper</p>
              {ends}
            </div>
            <p className="text-sm text-paper/85">
              &ldquo;Something lies hidden about {distance(item.metres)} {item.direction} of here…&rdquo; Whispers are sometimes lies, and they fade.
            </p>
            <button type="button" onClick={() => way({ lng: item.lng, lat: item.lat, name: "the whisper" })} className={`${button} self-start border-[1.5px] border-gold text-paper`}>
              Show me the way
            </button>
            {letGoButton}
          </div>
        ) : (
          (() => {
            const d = item;
            const here = d.metres <= DETOUR_REACH_M;
            const full = d.capacity !== null && d.claimed >= d.capacity;
            return (
              <div className={`flex flex-col gap-2 rounded-2xl bg-ink-2 p-4 ${here ? "ring-2 ring-gold" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-md bg-gold/15 px-2 py-0.5 text-xs font-bold text-gold">{KIND[d.kind]}</span>
                  {ends}
                </div>
                <p className="font-bold">{d.title}</p>
                <p className="text-sm text-paper/85">{d.story}</p>
                <p className="text-xs text-muted">
                  {d.place} · {here ? "you're here" : distance(d.metres)} · <span className="font-bold text-gold">{rewardText(d.coins, d.relic)}</span>
                  {d.capacity !== null && (
                    <>
                      {" "}
                      · <b className={full ? "text-danger" : "text-paper"}>{d.claimed} / {d.capacity} claimed</b>
                    </>
                  )}
                </p>
                {here ? (
                  <button type="button" disabled={working || full} onClick={() => void claim(d)} className={`${button} self-start bg-gold text-ink`}>
                    Claim it
                  </button>
                ) : (
                  <button type="button" onClick={() => way({ lng: d.lng, lat: d.lat, name: d.place })} className={`${button} self-start border-[1.5px] border-gold text-paper`}>
                    Show me the way
                  </button>
                )}
                {letGoButton}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

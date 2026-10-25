"use client";

import { useEffect, useState } from "react";

/** A landmark near the player, as landmarks_near sends it. */
export type Landmark = {
  id: number;
  name: string;
  city: string;
  lng: number;
  lat: number;
  radiusM: number;
  tier: 1 | 2 | 3;
  metres: number;
  visited: boolean;
  reward: number;
  nextAt: string | null;
  /** False when it was tried in the last day. */
  canTry: boolean;
};

/** A check-in question (the answer stays on the server). */
export type CheckinQuestion = { checkinId: string; landmark: string; question: string; options: string[]; seconds: number; endsAt: number /* this device's clock, ms */ };

export type CheckinResult = { correct: boolean; late: boolean; answer: string; fact: string; reward: number; first: boolean; lead: boolean };

export type LandmarkActions = {
  near: () => Promise<Landmark[]>;
  /** The landmark the player is at, or a message why they can't check in. */
  start: (landmark: Landmark) => Promise<CheckinQuestion | string>;
  answer: (checkinId: string, choice: number) => Promise<CheckinResult | string>;
  directionsTo: (landmark: Landmark) => void;
};

const distance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`);
const TIER = { 1: "City sight", 2: "Major landmark", 3: "Iconic" } as const;

/** Visit famous places and answer a question about each, for coins and intel (design doc 9). */
export function LandmarkPanel({
  actions,
  onClose,
  quiz: firstQuiz,
  message: firstMessage,
}: {
  actions: LandmarkActions;
  onClose: () => void;
  /** Opened by the Check in button: the question already asked. */
  quiz: CheckinQuestion | null;
  message: string | null;
}) {
  const [list, setList] = useState<Landmark[] | null>(null);
  const [quiz, setQuiz] = useState<CheckinQuestion | null>(firstQuiz);
  const [left, setLeft] = useState(0);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [message, setMessage] = useState<string | null>(firstMessage);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let live = true;
    void actions.near().then((found) => live && setList(found));
    return () => {
      live = false;
    };
  }, [actions]);

  const checkIn = async (lm: Landmark) => {
    setWorking(true);
    setMessage(null);
    const q = await actions.start(lm);
    setWorking(false);
    if (typeof q === "string") setMessage(q);
    else {
      setResult(null);
      setQuiz(q);
    }
  };

  // The countdown.
  useEffect(() => {
    if (!quiz || result) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((quiz.endsAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [quiz, result]);

  const choose = async (choice: number) => {
    if (!quiz || working) return;
    setWorking(true);
    const r = await actions.answer(quiz.checkinId, choice);
    setWorking(false);
    if (typeof r === "string") setMessage(r);
    else setResult(r);
  };

  const button = "h-11 rounded-xl px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/60 sm:items-center" onClick={quiz && !result ? undefined : onClose}>
      <div
        role="dialog"
        aria-label="Landmarks"
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-ink p-5 sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold">{quiz ? quiz.landmark : "Landmarks"}</h2>
            <p className="text-sm text-muted">{quiz ? "Answer before the time runs out." : "Visit famous places and answer a question about each for coins and intel."}</p>
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
            // ---- How it went.
            <div className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4">
              <p className={`text-lg font-bold ${result.correct ? "text-[#3DD68C]" : "text-danger"}`}>
                {result.correct ? `✓ Right! +${result.reward} coins` : result.late ? "✗ Too late" : "✗ Not quite"}
              </p>
              {!result.correct && <p className="text-sm">The answer: <b>{result.answer}</b></p>}
              <p className="text-sm text-muted">{result.fact}</p>
              {result.lead && <p className="text-sm text-gold">🔎 Intel: a whisper about a hidden find nearby. It&apos;s in your lamp.</p>}
              {!result.correct && <p className="text-xs text-muted">You can try this landmark again tomorrow.</p>}
              <button type="button" onClick={onClose} className={`${button} self-start bg-gold text-ink`}>
                Done
              </button>
            </div>
          ) : (
            // ---- The question.
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
        ) : !list ? (
          <p className="text-sm text-muted">Looking for landmarks…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((lm) => {
              const here = lm.metres <= lm.radiusM;
              const wait = !lm.canTry;
              return (
                <li key={lm.id} className={`flex items-center justify-between gap-3 rounded-2xl bg-ink-2 p-4 ${here ? "ring-2 ring-gold" : ""}`}>
                  <span
                    className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-xl ${lm.tier >= 2 ? "bg-gold/20 ring-1 ring-gold/60" : "bg-ink"}`}
                    aria-hidden="true"
                  >
                    {lm.visited ? "✅" : "🏛"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold leading-snug">{lm.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                      <span className="text-muted">
                        {lm.city} · {TIER[lm.tier]} · {here ? "you're here" : distance(lm.metres)}
                      </span>
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 font-bold text-gold">+{lm.reward} coins</span>
                      {wait && <span className="text-muted">try again tomorrow</span>}
                    </p>
                  </div>
                  {here ? (
                    <button type="button" disabled={working || !!wait} onClick={() => void checkIn(lm)} className={`${button} shrink-0 bg-gold text-ink`}>
                      Check in
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        actions.directionsTo(lm);
                        onClose();
                      }}
                      className={`${button} shrink-0 border-[1.5px] border-gold text-paper`}
                    >
                      Directions
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

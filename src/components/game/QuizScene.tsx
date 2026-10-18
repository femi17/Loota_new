"use client";

import { useEffect, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine, type SceneMoment } from "./EventScene";
import type { AvatarLook } from "@/lib/avatar";

/** A question asked at a place, against the clock: a landmark's check-in, or a Detour from the Lamp. */
export type QuizQuestion = { question: string; options: string[]; seconds: number; endsAt: number /* this device's clock, ms */ };

export type QuizOffer = {
  /** Who asks: the guide at a landmark, the Lamp's messenger at a Detour. */
  host: { name: string; look: AvatarLook };
  title: string;
  sign: string;
  /** What the host says first (the clock starts only when you're ready). */
  intro: string;
};

export type QuizActions = {
  /** Ask for the question (the server starts the clock); a message if it can't be asked. */
  start: () => Promise<QuizQuestion | string>;
  /** Answer it: how it went, in the host's words (`good`: right in time). */
  answer: (choice: number) => Promise<{ good: boolean; line: string } | string>;
};

/** At a landmark or a Detour's place on the map: the host greets you, asks when you're ready, and the clock runs. */
export function QuizScene({
  offer,
  you,
  actions,
  world = false,
  onMoment,
  onClose,
}: {
  offer: QuizOffer;
  you: AvatarLook;
  actions: QuizActions;
  world?: boolean;
  onMoment?: (m: SceneMoment) => void;
  onClose: () => void;
}) {
  type Step = "intro" | "ask" | "done";
  const [step, setStep] = useState<Step>("intro");
  const [busy, setBusy] = useState(false);
  const [quiz, setQuiz] = useState<QuizQuestion | null>(null);
  const [left, setLeft] = useState(0);
  const [lines, setLines] = useState<SceneLine[]>([{ who: "them", text: offer.intro }]);
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);

  // The clock.
  useEffect(() => {
    if (!quiz || step !== "ask") return;
    const tick = () => setLeft(Math.max(0, Math.ceil((quiz.endsAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [quiz, step]);

  async function ready() {
    setBusy(true);
    const q = await actions.start();
    setBusy(false);
    say({ who: "you", text: "I'm ready!" });
    if (typeof q === "string") {
      say({ who: "them", text: q });
      setStep("done");
      return;
    }
    setQuiz(q);
    setLeft(q.seconds);
    say({ who: "them", text: q.question });
    setStep("ask");
  }

  async function answer(i: number) {
    if (!quiz) return;
    setBusy(true);
    const r = await actions.answer(i);
    setBusy(false);
    say({ who: "you", text: quiz.options[i] });
    if (typeof r === "string") say({ who: "them", text: r });
    else {
      if (r.good) onMoment?.({ type: "won" });
      say({ who: "them", text: r.line });
    }
    setStep("done");
  }

  let choices: SceneChoice[];
  if (step === "intro") {
    choices = [
      { label: "I'm ready!", primary: true, onPick: () => void ready() },
      { label: "Not now", onPick: onClose },
    ];
  } else if (step === "ask" && quiz) {
    choices = quiz.options.map((o, i) => ({ label: o, primary: true, onPick: () => void answer(i) }));
  } else {
    choices = [{ label: "Thank you!", primary: true, onPick: onClose }];
  }

  return (
    <EventScene
      stage="roadside"
      title={offer.title}
      sign={offer.sign}
      them={offer.host}
      you={you}
      lines={lines}
      choices={choices}
      busy={busy}
      countdown={step === "ask" && quiz ? { left, total: quiz.seconds } : null}
      world={world}
      onClose={onClose}
    />
  );
}

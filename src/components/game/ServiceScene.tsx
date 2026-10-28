"use client";

import { useEffect, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine, type SceneMoment } from "./EventScene";
import { keeperLook, type AvatarLook } from "@/lib/avatar";
import { local, words } from "@/game/locale";

/**
 * At a mechanic's with a motorbike or car whose engine is worn (or broken down, in the pocket): the job, the price,
 * and how long it takes (owner, 19 Oct 2026: "servicing… was not a scene and it was fast; some time should be spent").
 */
export type ServiceOffer = { place: string; mechanic: string; kind: "motorbike" | "car"; engine: number; broken: boolean; price: number; seconds: number };

export type ServiceActions = {
  /** The job done (the server charges then, and the engine is like new): true if it went through. */
  service: () => Promise<boolean>;
};

/** The mechanic looks it over, names the job, works on the engine for a while (you watch), and it's done. */
export function ServiceScene({
  offer,
  you,
  actions,
  world = false,
  onMoment,
  onClose,
}: {
  offer: ServiceOffer;
  you: AvatarLook;
  actions: ServiceActions;
  world?: boolean;
  onMoment?: (m: SceneMoment) => void;
  onClose: () => void;
}) {
  type Step = "greet" | "working" | "done" | "bye";
  const name = offer.kind === "car" ? "car" : words().okada;
  const [step, setStep] = useState<Step>("greet");
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState(0);
  const [left, setLeft] = useState(offer.seconds);
  const [lines, setLines] = useState<SceneLine[]>([
    {
      who: "them",
      text: offer.broken
        ? `${local(`Ah, your ${name} don break down!`, `Ah, your ${name} has broken down!`)} I'll open the engine and fix it, then service it: ${offer.price} coins, about ${offer.seconds} seconds.`
        : `Your ${name}'s engine is at ${Math.round(offer.engine)}%. Oil change, plugs, a good tune: ${offer.price} coins, about ${offer.seconds} seconds and it runs like new.`,
    },
  ]);
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);

  // The work: the bar fills for the job's seconds (the mechanic at the engine), then the server does it (and charges).
  useEffect(() => {
    if (step !== "working") return;
    const timer = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (s > 0) return;
      window.clearInterval(timer);
      setBusy(true);
      void actions.service().then((ok) => {
        setBusy(false);
        onMoment?.({ type: "filled" });
        say({
          who: "them",
          text: ok
            ? `Done! Fresh oil, clean plugs, everything tight. Your ${name} runs like new: ride well!`
            : `Ah, you don't have up to ${offer.price} coins. I've done the work, but bring the money next time, o.`,
        });
        setStep("done");
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [step, until, actions, offer.price, onMoment, name]);

  let choices: SceneChoice[];
  if (step === "greet") {
    choices = [
      {
        label: `Go ahead · ${offer.price} coins`,
        primary: true,
        onPick: () => {
          say({ who: "you", text: "Go ahead." }, { who: "them", text: offer.broken ? "Pass me that spanner… let me see what's wrong." : "Okay, let me drain the old oil first…" });
          onMoment?.({ type: "pumping" });
          setUntil(Date.now() + offer.seconds * 1000);
          setLeft(offer.seconds);
          setStep("working");
        },
      },
      {
        label: "Not now",
        onPick: () => {
          say({ who: "you", text: "Not now, thanks." }, { who: "them", text: local("No wahala. Don't let that engine knock o.", "No problem. Don't let that engine knock.") });
          setStep("bye");
        },
      },
    ];
  } else if (step === "working") {
    choices = [];
  } else if (step === "done") {
    choices = [{ label: `Thank you! ${offer.kind === "car" ? "🚗" : "🏍"}`, primary: true, onPick: onClose }];
  } else {
    choices = [{ label: "Bye", onPick: onClose }];
  }

  return (
    <EventScene
      stage="workshop"
      title={`Servicing at ${offer.place}`}
      sign={offer.place}
      them={{ name: offer.mechanic, look: { ...keeperLook(offer.mechanic), topColour: "#2F4A6E", extra: "cap" } }}
      you={you}
      vehicle={{ kind: offer.kind, fixed: step === "done" }}
      lines={lines}
      choices={choices}
      busy={busy}
      work={step === "working" || step === "done" ? { left: step === "done" ? 0 : left, total: offer.seconds } : null}
      world={world}
      onClose={onClose}
    />
  );
}

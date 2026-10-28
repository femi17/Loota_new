"use client";

import { useEffect, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine, type SceneMoment } from "./EventScene";
import { keeperLook, type AvatarLook } from "@/lib/avatar";
import { local } from "@/game/locale";

/** At a vulcanizer's (or a petrol station's air): soft tyres pumped, or a flat patched and pumped. */
export type PumpOffer = { place: string; keeper: string; flat: boolean; price: number; seconds: number };

export type PumpActions = {
  /** The job done (the server charges then, and the tyres are full): true if it went through. */
  pump: () => Promise<boolean>;
};

/** The vulcanizer looks at the tyre, names the job, works on it for a while (you watch), and it's done. */
export function PumpScene({
  offer,
  you,
  actions,
  world = false,
  onMoment,
  onClose,
}: {
  offer: PumpOffer;
  you: AvatarLook;
  actions: PumpActions;
  world?: boolean;
  onMoment?: (m: SceneMoment) => void;
  onClose: () => void;
}) {
  type Step = "greet" | "working" | "done" | "bye";
  const [step, setStep] = useState<Step>("greet");
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState(0);
  const [left, setLeft] = useState(offer.seconds);
  const [lines, setLines] = useState<SceneLine[]>([
    {
      who: "them",
      text: offer.flat
        ? `Ah, this tyre is flat! I'll find the hole in the water, patch the tube and pump it: ${offer.price} coins, about ${offer.seconds} seconds.`
        : `Your tyres are soft${local(" o", "")}. Let me pump them for you: ${offer.price} coins, about ${offer.seconds} seconds.`,
    },
  ]);
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);

  // The work: the bar fills for the job's seconds, then the server does it (and charges).
  useEffect(() => {
    if (step !== "working") return;
    const timer = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (s > 0) return;
      window.clearInterval(timer);
      setBusy(true);
      void actions.pump().then((ok) => {
        setBusy(false);
        onMoment?.({ type: "filled" });
        say({
          who: "them",
          text: ok
            ? offer.flat
              ? "Done! The patch is strong and the tyre is hard as rock. Safe journey!"
              : "Done! Hard as rock. Safe journey!"
            : `Ah, you don't have up to ${offer.price} coins. I'll let it go this time, but come back when you do.`,
        });
        setStep("done");
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [step, until, actions, offer.flat, offer.price, onMoment]);

  let choices: SceneChoice[];
  if (step === "greet") {
    choices = [
      {
        label: `Go ahead · ${offer.price} coins`,
        primary: true,
        onPick: () => {
          say({ who: "you", text: "Go ahead." }, { who: "them", text: offer.flat ? "Wait small, let me find the hole…" : "Okay, the machine is on…" });
          onMoment?.({ type: "pumping" });
          setUntil(Date.now() + offer.seconds * 1000);
          setLeft(offer.seconds);
          setStep("working");
        },
      },
      {
        label: "No thanks",
        onPick: () => {
          say({ who: "you", text: "No thanks." }, { who: "them", text: local("No wahala. Ride well.", "No problem. Ride safe.") });
          setStep("bye");
        },
      },
    ];
  } else if (step === "working") {
    choices = [];
  } else if (step === "done") {
    choices = [{ label: "Thank you! 🚲", primary: true, onPick: onClose }];
  } else {
    choices = [{ label: "Bye", onPick: onClose }];
  }

  return (
    <EventScene
      stage="workshop"
      title={`Tyres at ${offer.place}`}
      sign={offer.place}
      them={{ name: offer.keeper, look: { ...keeperLook(offer.keeper), topColour: "#5B4636", extra: "cap" } }}
      you={you}
      vehicle={{ kind: "bicycle", fixed: step === "done" }}
      lines={lines}
      choices={choices}
      busy={busy}
      work={step === "working" || step === "done" ? { left: step === "done" ? 0 : left, total: offer.seconds } : null}
      world={world}
      onClose={onClose}
    />
  );
}

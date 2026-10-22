"use client";

import { useEffect, useRef, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine } from "./EventScene";
import { keeperLook, type AvatarLook } from "@/lib/avatar";
import { FLAT_FIX_PRICE, FLAT_FIX_SECONDS, type VehicleKind } from "@/game/economy";

/** A flat by the roadside (owner, 22 Oct 2026): the vehicle, a roadside mechanic, and whether you have a jack. */
export type FlatOffer = { kind: "motorbike" | "car"; mechanic: string; jack: boolean };

export type FlatActions = {
  /** Start changing it: with the jack (free) or by the mechanic (paid when done). */
  start: (how: "jack" | "mechanic") => Promise<{ ok: boolean; reason?: string; seconds?: number }>;
  /** The work done: the tyre changed and, with fuel in the tank, back on the vehicle. */
  finish: () => Promise<{ ok: boolean; reason?: string; remounted?: boolean }>;
};

/** A roadside mechanic sees the flat; you change it with your jack, or they do it for a fee, while you wait. */
export function FlatScene({
  offer,
  you,
  actions,
  world = false,
  onClose,
}: {
  offer: FlatOffer;
  you: AvatarLook;
  actions: FlatActions;
  world?: boolean;
  onClose: () => void;
}) {
  type Step = "greet" | "working" | "done" | "bye";
  const [step, setStep] = useState<Step>("greet");
  const [busy, setBusy] = useState(false);
  const [how, setHow] = useState<"jack" | "mechanic">("mechanic");
  const [until, setUntil] = useState(0);
  const [left, setLeft] = useState(0);
  const total = FLAT_FIX_SECONDS[how];
  const name = offer.kind === "car" ? "car" : "motorbike";
  const [lines, setLines] = useState<SceneLine[]>([
    {
      who: "them",
      text: `Wahala! Your ${name}'s tyre is flat flat. I fit change am for you: ${FLAT_FIX_PRICE} coins, about ${FLAT_FIX_SECONDS.mechanic} seconds.${
        offer.jack ? " Or you get your own jack? Do am yourself, I go show you." : ""
      }`,
    },
  ]);
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);

  // The work: the bar fills for the job's seconds, then the server finishes it (and charges for the mechanic).
  const finishing = useRef(false);
  useEffect(() => {
    if (step !== "working") return;
    const timer = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (s > 0 || finishing.current) return;
      finishing.current = true;
      setBusy(true);
      void actions.finish().then((r) => {
        setBusy(false);
        if (!r.ok && r.reason === "wait") {
          finishing.current = false; // the server's clock is a moment behind: try again shortly
          setUntil(Date.now() + 1500);
          return;
        }
        window.clearInterval(timer);
        say({
          who: "them",
          text: !r.ok
            ? r.reason === "coins"
              ? `Ah, you don't have up to ${FLAT_FIX_PRICE} coins. I'll leave am like this: come back when you do.`
              : "Eh, something no correct. Try again."
            : r.remounted
              ? how === "jack"
                ? "See am! The spare is on, nuts tight tight. You sabi this thing. Safe journey!"
                : "Done! The spare is on, tight tight. Safe journey!"
              : `The tyre is fixed, but your tank is empty o. Bring fuel in a jerry can, then you can go.`,
        });
        setStep("done");
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [step, until, actions, how]);

  function begin(choice: "jack" | "mechanic") {
    setBusy(true);
    void actions.start(choice).then((r) => {
      setBusy(false);
      if (!r.ok) {
        say({
          who: "them",
          text:
            r.reason === "coins"
              ? `Ah, you don't have up to ${FLAT_FIX_PRICE} coins o.${offer.jack ? " Use your jack." : " Sorry."}`
              : r.reason === "far"
                ? `Your ${name} is back there o: walk to it first.`
                : r.reason === "no_jack"
                  ? "You don't have a jack. Buy one in the vehicle panel, or let me do it."
                  : "Eh, something no correct. Try again.",
        });
        return;
      }
      const secs = r.seconds ?? FLAT_FIX_SECONDS[choice];
      setHow(choice);
      say(
        choice === "jack"
          ? { who: "you", text: "I have my jack. I'll do it." }
          : { who: "you", text: "Please change it for me." },
        {
          who: "them",
          text: choice === "jack" ? "Oya: loosen the nuts first, then jack it up small small…" : "No problem. Hold my torch, let me jack it up…",
        },
      );
      setUntil(Date.now() + secs * 1000);
      setLeft(secs);
      setStep("working");
    });
  }

  let choices: SceneChoice[];
  if (step === "greet") {
    choices = [
      ...(offer.jack ? [{ label: `Change it myself (jack) · free, ${FLAT_FIX_SECONDS.jack} s`, primary: true, onPick: () => begin("jack") }] : []),
      { label: `Let the mechanic do it · ${FLAT_FIX_PRICE} coins`, primary: !offer.jack, onPick: () => begin("mechanic") },
      {
        label: "Not now",
        onPick: () => {
          say({ who: "you", text: "Not now, thanks." }, { who: "them", text: "No wahala. I dey here if you need me." });
          setStep("bye");
        },
      },
    ];
  } else if (step === "working") {
    choices = [];
  } else if (step === "done") {
    choices = [{ label: "Thank you! 🛞", primary: true, onPick: onClose }];
  } else {
    choices = [{ label: "Bye", onPick: onClose }];
  }

  return (
    <EventScene
      stage="roadside"
      title={`A flat ${name} tyre`}
      sign="Flat tyre"
      them={{ name: offer.mechanic, look: { ...keeperLook(offer.mechanic), topColour: "#4A5A3A", extra: "cap" } }}
      you={you}
      vehicle={{ kind: offer.kind as VehicleKind, fixed: step === "done" }}
      lines={lines}
      choices={choices}
      busy={busy}
      work={step === "working" || step === "done" ? { left: step === "done" ? 0 : left, total } : null}
      world={world}
      leaveLabel="Walk away"
      onClose={onClose}
    />
  );
}

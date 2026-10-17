"use client";

import { useState } from "react";
import { EventScene, type SceneChoice, type SceneLine } from "./EventScene";
import { keeperLook, keeperWrap, type AvatarLook } from "@/lib/avatar";

/** The renter waiting at the bus stop with a bicycle or an okada (a motorbike). */
export type RentalOffer = { kind: "bicycle" | "motorbike"; renter: string; stop: string; rate: number };

export type RentalActions = {
  /** "Deal!": ride off on it (the meter starts). Why not, if not: "coins", or anything else. */
  rent: () => Promise<"ok" | "coins" | "error">;
  /** Changed your mind: the renter goes back. */
  cancel: () => void;
};

/** Meeting the renter: they show you the ride, you ask the price, and it's a deal (or not). */
export function RentalScene({ offer, you, actions, onClose }: { offer: RentalOffer; you: AvatarLook; actions: RentalActions; onClose: () => void }) {
  const bike = offer.kind === "bicycle";
  const ride = bike ? "bicycle" : "okada";
  type Step = "greet" | "price" | "rented" | "short" | "declined";
  const [step, setStep] = useState<Step>("greet");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<SceneLine[]>([
    {
      who: "them",
      text: bike
        ? `Hello! You called for a bicycle? Here she is: oiled, pumped and ready to go.`
        : `You called for an okada? Here it is: full tank, and the engine is sweet.`,
    },
  ]);
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);

  async function deal() {
    setBusy(true);
    const r = await actions.rent();
    setBusy(false);
    if (r === "ok") {
      say({ who: "you", text: "Deal!" }, { who: "them", text: `Safe journey! Ride well, and bring my ${ride} back in one piece, o.` });
      setStep("rented");
    } else if (r === "coins") {
      say({ who: "you", text: "Deal!" }, { who: "them", text: `Eh, you don't have ${offer.rate} coins for the first minute. Come back when you do.` });
      setStep("short");
    } else {
      say({ who: "them", text: "Hold on, something's not right. Try me again." });
    }
  }

  function decline(text: string) {
    say({ who: "you", text }, { who: "them", text: "No wahala. I'll take it back then. Call me any time." });
    setStep("declined");
  }

  let choices: SceneChoice[];
  if (step === "greet") {
    choices = [
      {
        label: "How much is it?",
        primary: true,
        onPick: () => {
          say(
            { who: "you", text: "How much is it?" },
            {
              who: "them",
              text: `${offer.rate} coins a minute. The meter starts when you ride off, and every minute you start counts. When you're done, just get off: I'll come for it.${bike ? "" : " Helmet dey for seat!"}`,
            },
          );
          setStep("price");
        },
      },
      { label: "I've changed my mind", onPick: () => decline("Sorry, I've changed my mind.") },
    ];
  } else if (step === "price") {
    choices = [
      { label: `Deal! · ${offer.rate} coins a minute`, primary: true, onPick: () => void deal() },
      { label: "That's too much for me", onPick: () => decline("That's too much for me.") },
    ];
  } else if (step === "rented") {
    choices = [{ label: `Thanks! Let's go ${bike ? "🚲" : "🏍"}`, primary: true, onPick: onClose }];
  } else if (step === "declined") {
    choices = [
      {
        label: "Bye",
        onPick: () => {
          actions.cancel();
          onClose();
        },
      },
    ];
  } else {
    choices = [{ label: "OK", onPick: onClose }];
  }

  return (
    <EventScene
      stage="bike_hire"
      title={`${bike ? "Bicycle" : "Okada"} hire at ${offer.stop}`}
      sign={`${bike ? "Bicycle" : "Okada"} hire`}
      them={{ name: offer.renter, look: keeperLook(offer.renter), wrap: keeperWrap(offer.renter) }}
      you={you}
      vehicle={{ kind: offer.kind, fixed: true, sparkle: step === "rented" }}
      lines={lines}
      choices={choices}
      busy={busy}
      onClose={onClose}
    />
  );
}

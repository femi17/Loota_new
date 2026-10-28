"use client";

import { useEffect, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine, type SceneMoment } from "./EventScene";
import { keeperLook, type AvatarLook } from "@/lib/avatar";
import { clock, gateFor, type TransitDestination, type TransitStop } from "@/game/transit";
import { local } from "@/game/locale";
import type { TransitQuote } from "./TransitPanel";

/**
 * At a railway station's ticket office or an airport's check-in desk (owner, 18 Oct 2026: "for trains, the user
 * must go and purchase the ticket; at the airport, the user must go and check in"). `quote`: a trip already chosen
 * in the travel panel; otherwise the clerk asks where to.
 */
export type TicketOffer = { stop: TransitStop; clerk: string; quote: TransitQuote | null };

export type TicketActions = {
  destinations: (stop: TransitStop) => Promise<TransitDestination[]>;
  quoteTo: (stop: TransitStop, to: TransitDestination) => Promise<TransitQuote | string>;
  /** Pay (and for a flight, check in): the trip begins; a message if it didn't. */
  board: (quote: TransitQuote) => Promise<string | null>;
  /** Somewhere not on the clerk's list: the travel panel (flights anywhere in the world). */
  elsewhere: () => void;
};

const partOfDay = () => {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 16 ? "afternoon" : "evening";
};

export function TicketScene({
  offer,
  you,
  actions,
  world = false,
  onMoment,
  onClose,
}: {
  offer: TicketOffer;
  you: AvatarLook;
  actions: TicketActions;
  /** In the hall on the map (EventScene's world mode). */
  world?: boolean;
  onMoment?: (m: SceneMoment) => void;
  onClose: () => void;
}) {
  const plane = offer.stop.kind === "plane";
  const place = plane ? `${offer.stop.name}${offer.stop.code ? ` (${offer.stop.code})` : ""}` : `${offer.stop.name} station`;
  type Step = "where" | "quote" | "id" | "bag" | "done" | "short" | "bye";
  const quoteLine = (q: TransitQuote) =>
    plane
      ? `${q.label}: ${q.fare} coins, and boarding starts in about ${clock(q.waitSeconds)}. Shall I check you in?`
      : `${q.label}: that's ${q.fare} coins. The next train leaves in about ${clock(q.waitSeconds)}, and the ride takes about ${clock(q.seconds - q.waitSeconds)}.`;
  const ask = (q: TransitQuote) => (plane ? `I'm flying to ${q.label}.` : `One ticket to ${q.label}, please.`);
  const [quote, setQuote] = useState<TransitQuote | null>(offer.quote);
  const [step, setStep] = useState<Step>(offer.quote ? "quote" : "where");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<TransitDestination[] | null>(null);
  const greet = plane
    ? `Good ${partOfDay()}! Welcome to ${place}. Where are you flying to today?`
    : `Good ${partOfDay()}! Welcome to ${place}. Where are you travelling to?`;
  const [lines, setLines] = useState<SceneLine[]>(() =>
    offer.quote ? [{ who: "them", text: greet }, { who: "you", text: ask(offer.quote) }, { who: "them", text: quoteLine(offer.quote) }] : [{ who: "them", text: greet }],
  );
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);

  // Where this line or airport goes (when nothing was chosen in the travel panel).
  useEffect(() => {
    if (offer.quote) return;
    let live = true;
    void actions.destinations(offer.stop).then((d) => live && setList(d));
    return () => {
      live = false;
    };
  }, [actions, offer]);

  async function choose(d: TransitDestination) {
    setBusy(true);
    const q = await actions.quoteTo(offer.stop, d);
    setBusy(false);
    if (typeof q === "string") {
      say({ who: "you", text: `${d.name}, please.` }, { who: "them", text: `Sorry, I can't sell that one just now. ${q}` });
      return;
    }
    setQuote(q);
    say({ who: "you", text: ask(q) }, { who: "them", text: quoteLine(q) });
    setStep("quote");
  }

  async function pay() {
    if (!quote) return;
    setBusy(true);
    const problem = await actions.board(quote);
    setBusy(false);
    if (problem) {
      say({ who: "you", text: plane ? "Yes, check me in." : "Here you are." }, { who: "them", text: `Hmm. ${problem}` });
      setStep("short");
      return;
    }
    if (plane) {
      say({ who: "you", text: "Yes, check me in." }, { who: "them", text: "Lovely. Your ID, please?" });
      setStep("id");
    } else {
      onMoment?.({ type: "ticket" });
      say(
        { who: "you", text: `Here you are: ${quote.fare} coins.` },
        { who: "them", text: `Thank you. Here's your ticket to ${quote.label}. Platform 1, through the gate: the train will be in shortly. Safe journey!` },
      );
      setStep("done");
    }
  }

  let choices: SceneChoice[];
  if (step === "where") {
    const options = (list ?? []).slice(0, 4);
    choices = [
      ...options.map((d, i) => ({ label: `${d.name}${d.code ? ` (${d.code})` : ""} · ${d.fare}`, primary: i === 0, onPick: () => void choose(d) })),
      ...(list ? [{ label: plane ? "Somewhere else in the world…" : "Somewhere else…", onPick: actions.elsewhere }] : []),
      {
        label: "Not today",
        onPick: () => {
          say({ who: "you", text: "Not today, thanks." }, { who: "them", text: "No problem. Come back any time." });
          setStep("bye");
        },
      },
    ];
  } else if (step === "quote" && quote) {
    choices = [
      { label: plane ? `Yes, check me in · ${quote.fare} coins` : `Pay · ${quote.fare} coins`, primary: true, onPick: () => void pay() },
      {
        label: "That's too much for me",
        onPick: () => {
          say({ who: "you", text: "That's too much for me." }, { who: "them", text: local("No wahala. Another time.", "No problem. Another time.") });
          setStep("bye");
        },
      },
    ];
  } else if (step === "id") {
    choices = [
      {
        label: "Here you go 🪪",
        primary: true,
        onPick: () => {
          say({ who: "you", text: "Here you go." }, { who: "them", text: "Thank you. Any bags? Put them on the scale for me." });
          setStep("bag");
        },
      },
    ];
  } else if (step === "bag") {
    choices = [
      {
        label: "Put my bag on the scale 🧳",
        primary: true,
        onPick: () => {
          onMoment?.({ type: "bag" });
          say(
            { who: "you", text: "Here's my bag." },
            { who: "them", text: `All checked in: here's your boarding pass to ${quote?.label}. Gate ${gateFor(quote?.to.name ?? "")}, and boarding starts soon. Have a lovely flight!` },
          );
          setStep("done");
        },
      },
    ];
  } else if (step === "done") {
    choices = [{ label: plane ? "Thanks! To the lounge 🛋️" : "Thanks! To the platform 🚆", primary: true, onPick: onClose }];
  } else {
    choices = [{ label: "Bye", onPick: onClose }];
  }

  return (
    <EventScene
      stage="checkpoint"
      title={plane ? `Check-in at ${place}` : `Ticket office at ${place}`}
      sign={plane ? `${place} · Check-in` : `${place} · Tickets`}
      them={{
        name: offer.clerk,
        look: { ...keeperLook(offer.clerk), topColour: plane ? "#2F6FEB" : "#1E9E62", extra: "none" },
      }}
      you={you}
      lines={lines}
      choices={choices}
      busy={busy || (step === "where" && !list)}
      world={world}
      onClose={onClose}
    />
  );
}

"use client";

import { useState } from "react";
import { EventScene, type SceneChoice, type SceneLine } from "./EventScene";
import { keeperLook, keeperWrap, lookForId, type AvatarLook } from "@/lib/avatar";
import { PAPER_FINE, PAPER_NAME, type AddonId, type VehicleKind } from "@/game/economy";

/** Something on the road during a hunt (road_event_roll): the question comes without its answer. */
export type RoadEvent = {
  id: number;
  kind: "checkpoint" | "traveller" | "seller";
  npc: string;
  prompt: string | null;
  choices: string[] | null;
  /** At a checkpoint: the gear and papers the officer finds missing (a fine each). */
  missing?: AddonId[];
};

export type RoadEventResult = {
  outcome: "passed" | "fined" | "helped" | "declined" | "won" | "lost";
  correct: string | null;
  fine: number;
  reward: number;
  hint: { direction: string; band: string; key: number } | null;
};

export type RoadEventActions = {
  /** checkpoint: a choice, or −2 to pay the fine; traveller: 1 to help, 0 not; seller: a choice, or −1 no thanks. */
  answer: (event: RoadEvent, choice: number) => Promise<RoadEventResult | null>;
  /** The scene is over: the hunter may move again (unless held). */
  close: () => void;
};

/** A police officer in uniform and cap. */
export const OFFICER: AvatarLook = { skin: "#6B3E1F", hair: "short", hairColour: "#1B120C", top: "tee", topColour: "#1E3A6E", bottomsColour: "#1A1A1A", extra: "cap" };

/** Being stopped on the road: the officer's question, a stranded traveller, a seller's riddle. */
export function RoadEventScene({
  event,
  you,
  vehicle,
  actions,
  world = false,
  onClose,
}: {
  event: RoadEvent;
  you: AvatarLook;
  vehicle: VehicleKind | null;
  actions: RoadEventActions;
  /** On the road on the map, where you were stopped (EventScene's world mode). */
  world?: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [lines, setLines] = useState<SceneLine[]>(() => {
    if (event.kind === "checkpoint") {
      const missing = event.missing ?? [];
      if (missing.length) {
        const list = missing.map((m) => PAPER_NAME[m]);
        const named = list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list.at(-1)}` : list[0];
        return [
          {
            who: "them",
            text: missing.includes("light")
              ? `Stop there! Riding in the dark with no light? You can't be seen, it's dangerous. That's a ${PAPER_FINE}-coin fine.`
              : `Good evening! Police checkpoint: your papers, please… No ${named}? That's ${PAPER_FINE * missing.length} coins: ${PAPER_FINE} for each. Sort them out before you ride again.`,
          },
        ];
      }
      return [{ who: "them", text: `Good evening! Police checkpoint: your papers, please… Licence, registration, all in order. Before you go, a quick question: ${event.prompt}` }];
    }
    if (event.kind === "seller") return [{ who: "them", text: `Customer! Wait small: answer my riddle and I'll give you 25 coins. ${event.prompt}` }];
    return [{ who: "them", text: "Please, please! My phone died and I'm lost. Can you help me? I'll make it worth your while." }];
  });
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);

  async function answer(choice: number, said: string) {
    setBusy(true);
    const r = await actions.answer(event, choice);
    setBusy(false);
    setDone(true);
    if (!r) {
      say({ who: "you", text: said }, { who: "them", text: "Eh, never mind. Go on." });
      return;
    }
    const mine = { who: "you" as const, text: said };
    if (r.outcome === "passed") say(mine, { who: "them", text: "Correct! Everything is in order. Drive safely." });
    else if (r.outcome === "fined" && (event.missing ?? []).length)
      say(mine, { who: "them", text: `Fine paid: ${r.fine} coins. Get your papers sorted at the vehicle panel before I see you again, o.` });
    else if (r.outcome === "fined" && choice === -2) say(mine, { who: "them", text: `Fine paid: ${r.fine} coins. Wait here while I write your receipt.` });
    else if (r.outcome === "fined") say(mine, { who: "them", text: `Wrong! It's "${r.correct}". That's a ${r.fine}-coin fine, and wait here while I write it.` });
    else if (r.outcome === "won") say(mine, { who: "them", text: "Correct! You're sharp o. Take your 25 coins." });
    else if (r.outcome === "lost") say(mine, { who: "them", text: `Ah no! It was "${r.correct}". Better luck next time.` });
    else if (r.outcome === "helped")
      say(mine, {
        who: "them",
        text: r.hint
          ? `Thank you, God bless you! Listen: I passed a crowd of treasure hunters to the ${r.hint.direction} of here, ${r.hint.band} away. That's where Key ${r.hint.key} is, I'm sure of it.`
          : r.reward
            ? `Thank you, God bless you! Take these ${r.reward} coins for your trouble. Safe journey.`
            : "Thank you, God bless you! Safe journey.",
      });
    else say(mine, { who: "them", text: event.kind === "traveller" ? "No wahala. Safe journey." : "Okay o. Another time." });
  }

  let choices: SceneChoice[];
  if (done) choices = [{ label: "Go on", primary: true, onPick: onClose }];
  else if (event.kind === "traveller")
    choices = [
      { label: "Of course, let me help (15 s)", primary: true, onPick: () => void answer(1, "Of course, let me help you.") },
      { label: "Sorry, I'm in a hurry", onPick: () => void answer(0, "Sorry, I'm in a hurry.") },
    ];
  else if (event.kind === "checkpoint" && (event.missing ?? []).length)
    choices = [{ label: `Pay the fine · ${PAPER_FINE * (event.missing ?? []).length} coins`, primary: true, onPick: () => void answer(-2, "Sorry, officer. Here's the fine.") }];
  else
    choices = [
      ...(event.choices ?? []).map((c, i) => ({ label: c, primary: true, onPick: () => void answer(i, c) })),
      event.kind === "checkpoint"
        ? { label: "Just pay the fine · 20 coins", onPick: () => void answer(-2, "I'll just pay the fine.") }
        : { label: "No thanks", onPick: () => void answer(-1, "No thanks, I'm in a hurry.") },
    ];

  return (
    <EventScene
      stage={event.kind === "checkpoint" ? "checkpoint" : event.kind === "seller" ? "stall" : "roadside"}
      title={event.kind === "checkpoint" ? "Police checkpoint" : event.kind === "seller" ? `${event.npc}'s stall` : "A stranded traveller"}
      sign={event.kind === "checkpoint" ? "Police checkpoint" : event.kind === "seller" ? `${event.npc}'s snacks` : ""}
      them={{
        name: event.npc,
        look: event.kind === "checkpoint" ? OFFICER : event.kind === "seller" ? keeperLook(event.npc) : lookForId(`traveller:${event.npc}`),
        wrap: event.kind === "seller" ? keeperWrap(event.npc) : undefined,
      }}
      you={you}
      vehicle={event.kind === "checkpoint" && vehicle ? { kind: vehicle, fixed: true, sparkle: false } : null}
      lines={lines}
      choices={choices}
      busy={busy}
      world={world}
      leaveLabel={vehicle ? "Ride on" : "Walk on"}
      onClose={onClose}
    />
  );
}

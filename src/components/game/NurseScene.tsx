"use client";

import { useState } from "react";
import { EventScene, type SceneChoice, type SceneLine } from "./EventScene";
import { keeperLook, type AvatarLook } from "@/lib/avatar";
import type { VehicleKind } from "@/game/economy";

/** Out of hospital (or treated where they fell, when no hospital was near): who looked after them, and the bill. */
export type Discharge = { hospital: string | null; nurse: string; bill: number; energy: number; damaged: VehicleKind | null };

const VEHICLE: Record<VehicleKind, string> = { bicycle: "bicycle", motorbike: "motorbike", car: "car" };

/** The nurse at the door (or the paramedic by the road): what happened, the bill, and some advice for the road. */
export function NurseScene({ discharge, you, onClose }: { discharge: Discharge; you: AvatarLook; onClose: () => void }) {
  const ward = !!discharge.hospital;
  const hospital = discharge.hospital === "Hospital" ? "the hospital" : discharge.hospital; // unnamed on the map
  const [asked, setAsked] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [lines, setLines] = useState<SceneLine[]>([
    {
      who: "them",
      text: ward
        ? `Ah, you're up! You fainted from exhaustion and the ambulance brought you to ${hospital}. The doctor has checked you: you're fine now, with ${discharge.energy} energy.`
        : `Easy, easy. You fainted from exhaustion, so we treated you right here by the road. You're fine now, with ${discharge.energy} energy.`,
    },
  ]);
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);
  const ask = (key: string, question: string, answer: string) => {
    setAsked((a) => [...a, key]);
    say({ who: "you", text: question }, { who: "them", text: answer });
  };

  const choices: SceneChoice[] = leaving
    ? [{ label: "Bye", primary: true, onPick: onClose }]
    : [
        ...(asked.includes("bill")
          ? []
          : [
              {
                label: "How much do I owe?",
                onPick: () =>
                  ask("bill", "How much do I owe?", `${discharge.bill} coins, and it's already paid. ${ward ? "The ambulance is part of it." : "Our call-out is part of it."}`),
              },
            ]),
        ...(discharge.damaged && !asked.includes("vehicle")
          ? [
              {
                label: `What about my ${VEHICLE[discharge.damaged]}?`,
                onPick: () =>
                  ask(
                    "vehicle",
                    `What about my ${VEHICLE[discharge.damaged!]}?`,
                    `It got damaged when you fell. There's a repair shop not far from here: follow the blue line on your map and they'll fix it.`,
                  ),
              },
            ]
          : []),
        ...(asked.includes("why")
          ? []
          : [
              {
                label: "How do I stop it happening?",
                onPick: () =>
                  ask(
                    "why",
                    "How do I stop it happening again?",
                    "Watch your energy. When you get tired, sit down at a park or a place to eat, or have a meal. Walking and cycling use it up; buses and taxis don't.",
                  ),
              },
            ]),
        {
          label: ward ? "Thank you, nurse" : "Thank you",
          primary: true,
          onPick: () => {
            say({ who: "you", text: ward ? "Thank you, nurse." : "Thank you." }, { who: "them", text: "You're welcome. Take care of yourself out there, and good luck with the hunt!" });
            setLeaving(true);
          },
        },
      ];

  return (
    <EventScene
      stage={ward ? "hospital" : "roadside"}
      title={ward ? `Leaving ${hospital}` : "The paramedics"}
      sign={discharge.hospital ?? ""}
      them={{
        name: discharge.nurse,
        look: ward
          ? { ...keeperLook(discharge.nurse), hair: "bun", topColour: "#F4F1EA", bottomsColour: "#F4F1EA", extra: "none" }
          : { ...keeperLook(discharge.nurse), topColour: "#1E9E62", bottomsColour: "#1E9E62", extra: "cap" },
      }}
      you={you}
      lines={lines}
      choices={choices}
      onClose={onClose}
    />
  );
}

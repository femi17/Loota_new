"use client";

import { useEffect, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine } from "./EventScene";
import { keeperLook, type AvatarLook } from "@/lib/avatar";
import type { VehicleKind } from "@/game/economy";

/** Out of hospital (or treated where they fell, when no hospital was near): who looked after them, and the bill. */
export type Discharge = { hospital: string | null; nurse: string; bill: number; energy: number; damaged: VehicleKind | null };

const VEHICLE: Record<VehicleKind, string> = { bicycle: "bicycle", motorbike: "motorbike", car: "car" };

/** Being treated: where (null: by the road), who, the bill, and when it's over (this device's clock, ms). */
export type Treatment = { hospital: string | null; nurse: string; bill: number; until: number; total: number };

/**
 * On the bed being treated, from the moment the ambulance arrives (owner, 2 Nov 2026: "immediately the ambulance stops
 * there, the scene should appear, you lying on the bed receiving treatments"); or on the ground with the paramedics.
 * No leaving until it's over: then the nurse's goodbye (NurseScene).
 */
export function TreatmentScene({ treatment, you }: { treatment: Treatment; you: AvatarLook }) {
  const ward = !!treatment.hospital;
  const hospital = treatment.hospital === "Hospital" ? "the hospital" : treatment.hospital;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((treatment.until - now) / 1000));
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const [asked, setAsked] = useState<string[]>([]);
  const [lines, setLines] = useState<SceneLine[]>([
    {
      who: "them",
      text: ward
        ? `Lie still, you're safe now. You fainted from exhaustion and the ambulance brought you to ${hospital}. I'm putting up a drip to get your strength back.`
        : "Stay down, stay still. You fainted from exhaustion, so we're treating you right here: a drip and some water, and you'll be up soon.",
    },
  ]);
  const ask = (key: string, question: string, answer: string) => {
    setAsked((a) => [...a, key]);
    setLines((l) => [...l, { who: "you", text: question }, { who: "them", text: answer }]);
  };
  const choices: SceneChoice[] = [
    ...(asked.includes("long")
      ? []
      : [{ label: "How long will I be here?", onPick: () => ask("long", "How long will I be here?", `Not long: about ${clock} more. Rest, and you'll be back on your feet.`) }]),
    ...(asked.includes("bill")
      ? []
      : [
          {
            label: "How much is this?",
            onPick: () => ask("bill", "How much is this?", `${treatment.bill} coins, and it's already paid. ${ward ? "The ambulance is part of it." : "Our call-out is part of it."}`),
          },
        ]),
  ];
  return (
    <EventScene
      stage={ward ? "hospital" : "roadside"}
      title={ward ? `At ${hospital}` : "The paramedics"}
      sign={treatment.hospital ?? "The paramedics"}
      them={{
        name: treatment.nurse,
        look: ward
          ? { ...keeperLook(treatment.nurse), hair: "bun", topColour: "#F4F1EA", bottomsColour: "#F4F1EA", extra: "none" }
          : { ...keeperLook(treatment.nurse), topColour: "#1E9E62", bottomsColour: "#1E9E62", extra: "cap" },
      }}
      you={you}
      lines={lines}
      choices={choices}
      work={{ left, total: treatment.total }}
      workText={{ going: "Back on your feet in", done: "Nearly done…", label: "Being treated" }}
      world
      leaveLabel={null}
      onClose={() => {}}
    />
  );
}

/** The nurse at the door (or the paramedic by the road): what happened, the bill, and some advice for the road. */
export function NurseScene({
  discharge,
  you,
  world = false,
  onClose,
}: {
  discharge: Discharge;
  you: AvatarLook;
  /** On the ward on the map (EventScene's world mode): you wake on the bed there. */
  world?: boolean;
  onClose: () => void;
}) {
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
                    "Watch your energy. When you get tired, sit down at a park or a place to eat, or have a meal. Walking and cycling use it up fastest; riding or driving a long time tires you too. Buses and taxis don't.",
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
      world={world}
      onClose={onClose}
    />
  );
}

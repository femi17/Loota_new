"use client";

import { useEffect, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine } from "./EventScene";
import { keeperLook, keeperWrap, type AvatarLook } from "@/lib/avatar";
import type { VehicleKind } from "@/game/economy";

/** A broken-down vehicle's repair shop (repair_shop in the database). `readyAt` is on this device's clock (ms). */
export type RepairJob = {
  id: number;
  kind: VehicleKind;
  shop: string;
  keeper: string;
  lng: number;
  lat: number;
  price: number;
  waitS: number;
  readyAt: number | null;
};

export type RepairActions = {
  /** Pay and hand it over: the job with its ready time, or why not ("coins", "far"). */
  agree: (job: RepairJob) => Promise<RepairJob | "coins" | "far" | "error">;
  /** Take it back, repaired. */
  collect: (job: RepairJob) => Promise<boolean>;
};

const NAME: Record<VehicleKind, string> = { bicycle: "bicycle", motorbike: "motorbike", car: "car" };

/** Walking into a repair shop: the keeper greets you, looks at the vehicle, names the price and the wait. */
export function RepairScene({ job: initial, you, actions, onClose }: { job: RepairJob; you: AvatarLook; actions: RepairActions; onClose: () => void }) {
  const [job, setJob] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const vehicle = NAME[job.kind];
  const minutes = Math.round(job.waitS / 60);
  const bike = job.kind === "bicycle";

  // Where the conversation is.
  type Step = "greet" | "quote" | "working" | "short" | "declined" | "far";
  const [step, setStep] = useState<Step>(initial.readyAt ? "working" : "greet");
  const [lines, setLines] = useState<SceneLine[]>(() =>
    initial.readyAt
      ? [{ who: "them", text: `Welcome back! ${initial.readyAt <= Date.now() ? `Your ${vehicle} is ready.` : "Not yet o, give me small time. I'm still on it."}` }]
      : [{ who: "them", text: `Hello! Welcome to ${initial.shop}. How can I help you today?` }],
  );
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);

  useEffect(() => {
    if (!job.readyAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.readyAt]);
  const left = job.readyAt ? Math.max(0, Math.ceil((job.readyAt - now) / 1000)) : 0;
  const ready = !!job.readyAt && left === 0;

  // The keeper announces it the moment it's done.
  const told = lines.some((l) => l.who === "them" && /is ready|All done/.test(l.text));
  const shown: SceneLine[] = step === "working" && ready && !told ? [...lines, { who: "them", text: `All done! Your ${vehicle} is as good as new. Safe journey!` }] : lines;

  async function agree() {
    setBusy(true);
    const r = await actions.agree(job);
    setBusy(false);
    if (r === "coins") {
      say({ who: "you", text: "That's OK." }, { who: "them", text: `Hmm, you don't have ${job.price} coins on you. Come back when you do, my friend.` });
      setStep("short");
    } else if (r === "far") {
      say({ who: "them", text: "Bring it inside the shop first. Come closer!" });
      setStep("far");
    } else if (r === "error") {
      say({ who: "them", text: "Eh, my phone is not connecting. Try me again." });
    } else {
      setJob(r);
      setNow(Date.now());
      say({ who: "you", text: "That's OK, go ahead." }, { who: "them", text: "Sit down, rest small. I'm on it!" });
      setStep("working");
    }
  }

  async function collect() {
    setBusy(true);
    const ok = await actions.collect(job);
    setBusy(false);
    if (ok) onClose();
    else say({ who: "them", text: "Almost! Just tightening the last bolt." });
  }

  let choices: SceneChoice[] = [];
  if (step === "greet") {
    choices = [
      {
        label: `Please repair my ${vehicle}`,
        primary: true,
        onPick: () => {
          say(
            { who: "you", text: `Please repair my ${vehicle}.` },
            {
              who: "them",
              text: bike
                ? `Ah, this one fell hard! The wheel is bent and the tyre is flat. I can fix it: ${job.price} coins, and about ${minutes} minutes.`
                : `Let me look under it… The engine has given up. I can fix it: ${job.price} coins, and about ${minutes} minutes.`,
            },
          );
          setStep("quote");
        },
      },
      { label: "Just looking, thanks", onPick: onClose },
    ];
  } else if (step === "quote" || step === "far") {
    choices = [
      { label: `That's OK · ${job.price} coins`, primary: true, onPick: () => void agree() },
      {
        label: "That's too much for me",
        onPick: () => {
          say({ who: "you", text: "That's too much for me." }, { who: "them", text: "No wahala. Come back any time." });
          setStep("declined");
        },
      },
    ];
  } else if (step === "working") {
    choices = ready
      ? [{ label: "Thank you!", primary: true, onPick: () => void collect() }]
      : [{ label: "I'll come back later", onPick: onClose }];
  } else {
    choices = [{ label: "OK, bye", onPick: onClose }];
  }

  return (
    <EventScene
      stage={bike ? "bicycle_shop" : "workshop"}
      title={job.shop}
      sign={job.shop}
      them={{ name: job.keeper, look: keeperLook(job.keeper), wrap: keeperWrap(job.keeper) }}
      you={you}
      vehicle={{ kind: job.kind, fixed: ready }}
      lines={shown}
      choices={choices}
      busy={busy}
      work={job.readyAt ? { left, total: job.waitS } : null}
      onClose={onClose}
    />
  );
}

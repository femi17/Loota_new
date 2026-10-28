"use client";

import { useEffect, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine, type SceneMoment } from "./EventScene";
import { keeperLook, keeperWrap, type AvatarLook } from "@/lib/avatar";
import { local } from "@/game/locale";

/** At a place to eat: the cook and the day's menu (every dish is one meal: the same price, the same energy). */
export type MealOffer = { place: string; cook: string; id: number; price: number; energy: number };

export type MealActions = {
  eat: () => Promise<{ ok: true; energy: number } | { ok: false; reason: string }>;
};

/** A dish: its name, a short one for the menu board, and the colours on the plate. */
type Dish = { name: string; board: string; base: string; side: string };
const DISHES: Dish[] = [
  { name: "Jollof rice and chicken", board: "JOLLOF", base: "#D9531E", side: "#C98A4B" },
  { name: "Amala and ewedu", board: "AMALA", base: "#5A3B2A", side: "#4E8A2E" },
  { name: "Pounded yam and egusi", board: "IYAN", base: "#F2EEE3", side: "#E0B23A" },
  { name: "Beans and dodo", board: "BEANS", base: "#8A5A36", side: "#F2A43A" },
  { name: "Fried rice and turkey", board: "FRIED RICE", base: "#E8C25A", side: "#A8643A" },
  { name: "Eba and okra soup", board: "EBA", base: "#F3D98A", side: "#5E8C2A" },
  { name: "Ofada rice and ayamase", board: "OFADA", base: "#EFE6D0", side: "#4F6B2A" },
  { name: "Yam and egg sauce", board: "YAM", base: "#F4E7C1", side: "#F2C230" },
];

/** Today's three dishes at this place (the same all day). */
export function todaysMenu(id: number) {
  const day = Math.floor(Date.now() / 86_400_000);
  const start = (id * 7 + day) % DISHES.length;
  return [0, 3, 5].map((k) => DISHES[(start + k) % DISHES.length]);
}

/** Sitting down to eat: the cook greets you, you pick from the day's menu, the plate comes and you clear it. */
export function MealScene({
  offer,
  you,
  actions,
  world = false,
  onMoment,
  onClose,
}: {
  offer: MealOffer;
  you: AvatarLook;
  actions: MealActions;
  /** At the buka on the map (EventScene's world mode): the plate comes to your table there. */
  world?: boolean;
  onMoment?: (m: SceneMoment) => void;
  onClose: () => void;
}) {
  const [dishes] = useState(() => todaysMenu(offer.id));
  const named = offer.place !== "Place to eat"; // unnamed on the map
  type Step = "greet" | "eating" | "done" | "short" | "bye";
  const [step, setStep] = useState<Step>("greet");
  const [busy, setBusy] = useState(false);
  const [dish, setDish] = useState<Dish | null>(null);
  const [plate, setPlate] = useState<"full" | "half" | "empty" | null>(null);
  const [gained, setGained] = useState(offer.energy);
  const [lines, setLines] = useState<SceneLine[]>([
    {
      who: "them",
      text: `Welcome, my dear! Sit down, rest your legs. Today we have ${dishes[0].name.toLowerCase()}, ${dishes[1].name.toLowerCase()}, or ${dishes[2].name.toLowerCase()}. What will you chop?`,
    },
  ]);
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);

  // The plate comes, and goes down bite by bite.
  useEffect(() => {
    if (step !== "eating") return;
    const timer = window.setTimeout(() => {
      if (plate === "full") {
        setPlate("half");
        onMoment?.({ type: "plate", state: "half" });
      } else {
        setPlate("empty");
        onMoment?.({ type: "plate", state: "empty" });
        say({ who: "them", text: `${local("Ehen! You cleaned the plate. That one go give you power", "There you go, a clean plate! That'll keep you going")}: +${gained} energy. Come back any time!` });
        setStep("done");
      }
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [step, plate, gained, onMoment]);

  async function order(d: Dish) {
    setBusy(true);
    const r = await actions.eat();
    setBusy(false);
    say({ who: "you", text: `${d.name}, please.` });
    if (r.ok) {
      setDish(d);
      setGained(r.energy);
      setPlate("full");
      onMoment?.({ type: "served", base: d.base, side: d.side });
      say({ who: "them", text: "Coming right up! Hot hot, straight from the pot." });
      setStep("eating");
    } else if (r.reason === "coins") {
      say({ who: "them", text: `Ah, it's ${offer.price} coins, my dear. You can still sit on the bench and rest for free.` });
      setStep("short");
    } else {
      say({ who: "them", text: "Wait small, the pot is not ready. Try me again." });
    }
  }

  let choices: SceneChoice[];
  if (step === "greet") {
    choices = [
      ...dishes.map((d, i) => ({ label: `${d.name} · ${offer.price} coins`, primary: i === 0, onPick: () => void order(d) })),
      {
        label: "I'm not hungry",
        onPick: () => {
          say({ who: "you", text: "I'm not hungry, thanks." }, { who: "them", text: "No problem. When hunger catch you, you know where to find me!" });
          setStep("bye");
        },
      },
    ];
  } else if (step === "done") {
    choices = [{ label: "Thank you, the food was sweet!", primary: true, onPick: onClose }];
  } else if (step === "eating") {
    choices = [];
  } else {
    choices = [{ label: "Bye", onPick: onClose }];
  }

  // The day's dishes on the menu board, and the plate on the table.
  const overlay = (
    <g fontFamily="system-ui, sans-serif">
      <text x="194" y="73" textAnchor="middle" fontSize="6" fontWeight="800" fill="#F4F1EA">
        TODAY
      </text>
      {dishes.map((d, i) => (
        <text key={d.board} x="194" y={83 + i * 8} textAnchor="middle" fontSize="5.5" fill="#E8E2C8">
          {d.board} · {offer.price}
        </text>
      ))}
      {plate && dish && (
        <g transform="translate(182 126)">
          <ellipse cx="0" cy="0" rx="16" ry="4.5" fill="#FFFFFF" stroke="#C9CED6" strokeWidth="0.8" />
          {plate !== "empty" && (
            <>
              <ellipse cx="-4" cy="-2" rx={plate === "full" ? 9 : 5} ry={plate === "full" ? 4 : 2.4} fill={dish.base} />
              <ellipse cx="7" cy="-1.5" rx={plate === "full" ? 5 : 3} ry={plate === "full" ? 2.6 : 1.6} fill={dish.side} />
            </>
          )}
          {plate === "full" && <path className="loota-steam" d="M-6 -8q-3 -4 0 -8M2 -8q-3 -4 0 -8" stroke="#FFFFFF" strokeWidth="1.4" fill="none" strokeLinecap="round" />}
        </g>
      )}
    </g>
  );

  return (
    <EventScene
      stage="buka"
      title={named ? `Eating at ${offer.place}` : "Eating at a buka"}
      sign={named ? offer.place : "Buka"}
      them={{ name: offer.cook, look: keeperLook(offer.cook), wrap: keeperWrap(offer.cook) }}
      you={you}
      lines={lines}
      choices={choices}
      busy={busy}
      overlay={overlay}
      world={world}
      onClose={onClose}
    />
  );
}

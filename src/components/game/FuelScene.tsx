"use client";

import { useEffect, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine, type SceneMoment } from "./EventScene";
import { keeperLook, type AvatarLook } from "@/lib/avatar";
import { FUEL_PRICE, KEG_CAPACITY, KEG_PRICE } from "@/game/economy";
import { formatDistance } from "@/game/geo";

/**
 * At a petrol station with a motorbike or car that needs fuel: the one ridden, or one in the pocket; or one that ran
 * dry and stands parked at the roadside `stranded` metres away (then the attendant fills a jerry can to carry to it).
 */
export type FuelOffer = {
  station: string;
  attendant: string;
  kind: "motorbike" | "car";
  fuel: number;
  pocket: boolean;
  hasKeg: boolean;
  /** How much fuel is in the jerry can already (% of a tank). */
  kegFuel?: number;
  stranded?: { metres: number } | null;
};

export type FuelActions = {
  /** Fill the tank (as far as the coins go). */
  fill: () => Promise<{ ok: true; cost: number; fuel: number } | { ok: false; reason: string }>;
  /** A jerry can for the road (25 coins). */
  buyKeg: () => Promise<boolean>;
  /** Fill the jerry can (as far as the coins go). */
  fillKeg: () => Promise<{ ok: true; cost: number; fuel: number } | { ok: false; reason: string }>;
};

/** The pump attendant: "Fill am?", the meter running, and a keg for the road. */
export function FuelScene({
  offer,
  you,
  actions,
  world = false,
  onMoment,
  onClose,
}: {
  offer: FuelOffer;
  you: AvatarLook;
  actions: FuelActions;
  /** At the station on the map (EventScene's world mode): the attendant fills it at the pump there. */
  world?: boolean;
  onMoment?: (m: SceneMoment) => void;
  onClose: () => void;
}) {
  const name = offer.kind === "car" ? "car" : "okada";
  const want = Math.max(0, Math.floor(100 - offer.fuel)) * FUEL_PRICE;
  const canFill = Math.max(0, Math.floor(KEG_CAPACITY - (offer.kegFuel ?? 0))) * FUEL_PRICE; // filling the jerry can
  const away = offer.stranded ? formatDistance(offer.stranded.metres) : "";
  const welcome = offer.station === "Petrol station" ? "Welcome!" : `Welcome to ${offer.station}!`; // unnamed on the map: "Petrol station"
  type Step = "greet" | "pumping" | "filled" | "keg" | "short" | "bye";
  const [step, setStep] = useState<Step>("greet");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<SceneLine[]>([
    {
      who: "them",
      text: offer.stranded
        ? `${welcome} Your ${name} ran dry on the road, ${away} from here? No wahala: I'll fill a jerry can for you to carry back. ${
            offer.hasKeg ? `${canFill} coins fills your can` : `A jerry can is ${KEG_PRICE} coins and ${canFill} fills it`
          }: enough to take your tank to ${KEG_CAPACITY}%. A can can't fill a tank to the top.`
        : offer.pocket
        ? `${welcome} Bring your ${name} out of your pocket, let me fill it. The tank is empty: ${want} coins fills it to the top.`
        : `${welcome} Your ${name} is at ${Math.round(offer.fuel)}%. Fill am? ${want} coins to the top.`,
    },
  ]);
  const say = (...more: SceneLine[]) => setLines((l) => [...l, ...more]);
  // The pump's meter: coins counting up as the fuel goes in.
  const [meter, setMeter] = useState<{ shown: number; to: number; fuel: number; can?: boolean } | null>(null);
  useEffect(() => {
    if (!meter || meter.shown >= meter.to) return;
    const timer = window.setTimeout(() => {
      const next = { ...meter, shown: Math.min(meter.to, meter.shown + Math.max(1, Math.ceil(meter.to / 30))) };
      setMeter(next);
      onMoment?.({ type: "meter", n: next.shown });
      if (next.shown < next.to) return;
      onMoment?.({ type: "filled" });
      if (next.can) {
        // The jerry can is filled: carry it back.
        say({
          who: "them",
          text: `There: ${Math.round(next.fuel)}% of a tank in your can, ${next.to} coins. Carry it to your ${name} (${away} back) and pour it in. Then come and fill up properly!`,
        });
        setStep("filled");
        return;
      }
      // The tank is filled: what it came to.
      say({
        who: "them",
        text: `${next.fuel >= 99 ? "Full tank!" : `That's all your coins could buy: ${Math.round(next.fuel)}%.`} ${next.to} coins, thank you.${
          offer.hasKeg ? " Drive safe!" : ` You want a jerry can for the road? ${KEG_PRICE} coins: it carries enough for ${KEG_CAPACITY}% of a tank, for when you run dry far from a station.`
        }`,
      });
      setStep("filled");
    }, 80);
    return () => window.clearTimeout(timer);
  }, [meter, offer.hasKeg, onMoment, away, name]);
  const pumped = !!meter && meter.shown >= meter.to;

  async function fill() {
    setBusy(true);
    const r = await actions.fill();
    setBusy(false);
    say({ who: "you", text: "Fill it up, please." });
    if (r.ok) {
      onMoment?.({ type: "pumping" });
      setMeter({ shown: 0, to: r.cost, fuel: r.fuel });
      setStep("pumping");
    } else if (r.reason === "coins") {
      say({ who: "them", text: `Ah, you don't have up to ${FUEL_PRICE} coins. Come back when you do.` });
      setStep("short");
    } else if (r.reason === "full") {
      say({ who: "them", text: "Your tank is already full, my friend!" });
      setStep("short");
    } else {
      say({ who: "them", text: "The pump has hung. Try me again." });
    }
  }

  /** A jerry can for a vehicle parked at the roadside: bought if need be, then filled (the meter runs). */
  async function can() {
    setBusy(true);
    say({ who: "you", text: offer.hasKeg ? "Fill my jerry can, please." : "A jerry can, and fill it, please." });
    if (!offer.hasKeg && !(await actions.buyKeg())) {
      setBusy(false);
      say({ who: "them", text: `Ah, a jerry can is ${KEG_PRICE} coins. Come back when you have it.` });
      setStep("short");
      return;
    }
    const r = await actions.fillKeg();
    setBusy(false);
    if (r.ok) {
      onMoment?.({ type: "pumping" });
      setMeter({ shown: 0, to: r.cost, fuel: r.fuel, can: true });
      setStep("pumping");
    } else {
      say({ who: "them", text: r.reason === "coins" ? `You don't have up to ${FUEL_PRICE} coins for fuel. Come back when you do.` : r.reason === "full" ? "Your can is already full!" : "The pump has hung. Try me again." });
      setStep("short");
    }
  }

  async function keg() {
    setBusy(true);
    const ok = await actions.buyKeg();
    setBusy(false);
    say(
      { who: "you", text: "Yes, a jerry can." },
      ok
        ? { who: "them", text: "Here you go. Fill it here any time, and pour it in when the tank runs dry. Drive safe!" }
        : { who: "them", text: "Hmm, it didn't go through. Maybe next time. Drive safe!" },
    );
    setStep("keg");
  }

  let choices: SceneChoice[];
  if (step === "greet" && offer.stranded) {
    choices = [
      { label: offer.hasKeg ? `Fill my jerry can · ${canFill} coins` : `Jerry can and fuel · ${KEG_PRICE + canFill} coins`, primary: true, onPick: () => void can() },
      {
        label: "Not now",
        onPick: () => {
          say({ who: "you", text: "Not now, thanks." }, { who: "them", text: "No wahala. We dey here." });
          setStep("bye");
        },
      },
    ];
  } else if (step === "filled" && offer.stranded) {
    choices = [{ label: "Thanks! I'll carry it back 🛢", primary: true, onPick: onClose }];
  } else if (step === "greet") {
    choices = [
      { label: `Fill it up · ${want} coins`, primary: true, onPick: () => void fill() },
      {
        label: "Not today",
        onPick: () => {
          say({ who: "you", text: "Not today, thanks." }, { who: "them", text: "No wahala. We dey here." });
          setStep("bye");
        },
      },
    ];
  } else if (step === "filled" && !offer.hasKeg) {
    choices = [
      { label: `Yes, a jerry can · ${KEG_PRICE} coins`, onPick: () => void keg() },
      { label: `No, thanks. Let's go ${offer.kind === "car" ? "🚗" : "🏍"}`, primary: true, onPick: onClose },
    ];
  } else if (step === "filled" || step === "keg") {
    choices = [{ label: `Thanks! Let's go ${offer.kind === "car" ? "🚗" : "🏍"}`, primary: true, onPick: onClose }];
  } else if (step === "pumping") {
    choices = [];
  } else {
    choices = [{ label: "Bye", onPick: onClose }];
  }

  // The meter on the pump, and the nozzle in the tank while the fuel goes in.
  const overlay = (
    <g>
      <text x="107" y="108.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#5CF08A" fontFamily="ui-monospace, monospace">
        {String(meter?.shown ?? 0).padStart(4, "0")}
      </text>
      {meter && <path d="M130 126 q14 18 26 18" stroke="#222" strokeWidth="2.4" fill="none" />}
      {step === "pumping" && !pumped && (
        <g className="loota-sparkle" fill="#F4B41A">
          <circle cx="160" cy="136" r="2" />
        </g>
      )}
    </g>
  );

  return (
    <EventScene
      stage="petrol_station"
      title={`Petrol station: ${offer.station}`}
      sign={offer.station}
      them={{ name: offer.attendant, look: { ...keeperLook(offer.attendant), topColour: "#1E9E62", extra: "cap" } }}
      you={you}
      vehicle={offer.stranded ? null : { kind: offer.kind, fixed: true, sparkle: pumped }}
      lines={lines}
      choices={choices}
      busy={busy}
      overlay={overlay}
      world={world}
      onClose={onClose}
    />
  );
}

"use client";

import { useState } from "react";
import { BagIcon, BusIcon, DirectionsIcon, LampIcon, VehicleIcon } from "./HudIcons";
import { LootaLogo } from "@/components/Logo";
import { joinHunt } from "@/app/lobby/actions";
import { ChestArt } from "@/components/ChestArt";
import { Masquerade } from "./Masquerade";

/** How to move, shown rather than told: hold the lower screen, swipe there to turn, SPRINT. */
export function MoveDemo() {
  const tile = "flex flex-1 flex-col items-center gap-2 rounded-2xl bg-ink-2 p-2.5 text-center text-xs font-bold";
  return (
    <div className="flex gap-2" aria-hidden="true">
      <div className={tile}>
        <span className="relative flex h-20 w-12 items-end justify-center overflow-hidden rounded-xl bg-map ring-2 ring-line">
          <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gold/25" />
          <span className="loota-ripple absolute bottom-3 size-7 rounded-full bg-gold/60" />
          <span className="loota-press relative mb-4 size-5 rounded-full bg-gold ring-2 ring-paper" />
        </span>
        Hold low to walk
      </div>
      <div className={tile}>
        <span className="relative flex h-20 w-12 items-end justify-center overflow-hidden rounded-xl bg-map ring-2 ring-line">
          <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gold/25" />
          <span className="loota-swipe relative mb-4 text-lg font-extrabold text-ink">⟷</span>
        </span>
        Swipe to turn
      </div>
      <div className={tile}>
        <span className="flex h-20 items-center justify-center">
          <span className="loota-press flex size-14 items-center justify-center rounded-full bg-ink text-[10px] font-extrabold tracking-wide text-paper ring-[3px] ring-gold">
            SPRINT
          </span>
        </span>
        Hold to run
      </div>
    </div>
  );
}

/** A live hunt the player hasn't joined (the tour's last card, and the invitation on the map). */
export type OpenHunt = { id: string; title: string; keys: number; prize: string };

/**
 * The first time on the map (owner, 20 Oct 2026, a new player's first hour): a few cards: welcome and the coins, how
 * to move, what the buttons are, and what to do first (join the live hunt, or roam). Once per player on this device.
 */
export function WelcomeTour({ username, coins, openHunt, onDone }: { username: string; coins: number; openHunt: OpenHunt | null; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const cards: { title: string; art?: React.ReactNode; body: React.ReactNode }[] = [
    {
      title: `Welcome, ${username}!`,
      art: (
        <div className="relative flex h-32 items-end justify-center overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_50%_100%,#4A3510_0%,#182033_70%)] pb-3" aria-hidden="true">
          <span className="loota-key-spin absolute top-3 text-4xl">🗝️</span>
          <ChestArt size={104} open />
        </div>
      ),
      body: (
        <>
          <p>
            Loota is a treasure hunt on the real map of Nigeria. Crack riddles that point to real places, travel there, and beat the
            puzzle at the chest to win the keys.
          </p>
          <p className="rounded-xl bg-gold/15 p-3 font-bold text-gold">🪙 You have {coins.toLocaleString("en-NG")} coins to start: enough for meals, a rented bike, a tyre pump and a few roadside games.</p>
        </>
      ),
    },
    {
      title: "Getting around",
      art: <MoveDemo />,
      body: (
        <>
          <p>
            <b>Hold the lower part of the screen</b> to walk. Swipe left or right anywhere on the map to turn at the next junction, down (low on the screen) to turn
            back. <b>SPRINT</b> is faster, but tires you.
          </p>
          <p className="text-sm text-muted">Walking uses energy: eat at a buka or rest at a park when it runs low. On a keyboard: ↑ to go, ← → to turn, ↓ to go back.</p>
        </>
      ),
    },
    {
      title: "Your buttons",
      body: (
        <ul className="flex flex-col gap-2.5">
          {[
            [<DirectionsIcon key="d" />, "Directions: search any place, the way is drawn"],
            [<VehicleIcon key="v" kind={null} />, "Walk, rent or buy a bicycle, motorbike or car"],
            [<BusIcon key="b" />, "Taxis, buses, trains and planes"],
            [<LampIcon key="la" />, "The lamp: secrets during a hunt, and the Djinn"],
            [<BagIcon key="i" />, "Inventory (top): gear, papers, relics"],
          ].map(([icon, text], i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink-2 text-paper">{icon}</span>
              <span className="text-sm">{text}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: openHunt ? "A hunt is live!" : "What to do first",
      art: (
        <div className="flex h-36 items-end justify-center gap-4 overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_50%_110%,#7A3A10_0%,#3B1F4F_45%,#140F2E_85%)] pb-3" aria-hidden="true">
          <div className="flex flex-col items-center">
            <span className="loota-bubble relative mb-1 rounded-xl bg-paper px-2.5 py-1 text-[11px] font-bold text-ink">Catch me if you can!</span>
            <Masquerade size={52} />
          </div>
          <ChestArt size={84} />
        </div>
      ),
      body: openHunt ? (
        <>
          <p>
            <b>{openHunt.title}</b>: {openHunt.keys} keys to find. Prize: {openHunt.prize}.
          </p>
          <p className="text-muted">Join it and open the first riddle: you have 15 seconds to name the place. Then get there before the others.</p>
        </>
      ) : (
        <>
          <p>No hunt is running right now. Explore: chase the Lamp&apos;s Detours for coins, meet people on the road, and get yourself a ride.</p>
          <p className="text-muted">When the next hunt goes live it will show on the map and in the lobby.</p>
        </>
      ),
    },
  ];
  const last = step === cards.length - 1;
  const card = cards[step];
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-ink/70 p-3 sm:items-center" role="dialog" aria-label="Welcome to Loota">
      <div className="loota-wonder-banner flex max-h-[calc(100dvh-24px)] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-3xl bg-ink p-5 text-paper ring-1 ring-line">
        <div className="flex items-center justify-between">
          <LootaLogo height={40} />
          <button type="button" onClick={onDone} className="text-sm font-bold text-muted">
            Skip
          </button>
        </div>
        {card.art}
        <h2 className="font-display text-2xl font-extrabold">{card.title}</h2>
        <div className="flex flex-col gap-3 text-[15px] leading-relaxed">{card.body}</div>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {cards.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full ${i === step ? "w-6 bg-gold" : "w-1.5 bg-line"}`} />
          ))}
        </div>
        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="h-12 rounded-2xl border-[1.5px] border-line px-5 font-bold">
              Back
            </button>
          )}
          {last && openHunt ? (
            <form action={joinHunt} className="flex flex-1 gap-2" onSubmit={onDone}>
              <input type="hidden" name="hunt" value={openHunt.id} />
              <button type="submit" className="h-12 flex-1 rounded-2xl bg-gold font-bold text-ink">
                Join the hunt
              </button>
              <button type="button" onClick={onDone} className="h-12 rounded-2xl border-[1.5px] border-line px-4 font-bold">
                Later
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => (last ? onDone() : setStep(step + 1))} className="h-12 flex-1 rounded-2xl bg-gold font-bold text-ink">
              {last ? "Let's go" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** On the map, when a hunt is live and the player isn't in it: the invitation (dismissed for this visit). */
export function HuntInvite({ hunt, onDismiss }: { hunt: OpenHunt; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink p-3 text-paper ring-1 ring-gold" role="status" aria-label="A hunt is live">
      <span className="text-2xl" aria-hidden="true">🔑</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wider text-gold">A hunt is live</p>
        <p className="truncate text-sm font-bold">{hunt.title}</p>
        <p className="text-xs text-muted">
          {hunt.keys} keys · {hunt.prize}
        </p>
      </div>
      <form action={joinHunt}>
        <input type="hidden" name="hunt" value={hunt.id} />
        <button type="submit" className="h-10 rounded-xl bg-gold px-4 text-sm font-bold text-ink">
          Join
        </button>
      </form>
      <button type="button" aria-label="Not now" onClick={onDismiss} className="flex size-8 items-center justify-center rounded-lg text-paper/70">
        ✕
      </button>
    </div>
  );
}

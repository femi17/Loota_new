"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EventScene, type SceneChoice, type SceneLine } from "./EventScene";
import { keeperLook, keeperWrap, lookForId, type AvatarLook } from "@/lib/avatar";
import { PAPER_FINE, PAPER_NAME, type AddonId, type VehicleKind } from "@/game/economy";
import { RoadGameBoard, gameIntro, gameSeconds, timeoutMove, type RoadGame, type RoadGameResult } from "./RoadGames";
import { cue } from "@/game/sound";

/** Something on the road during a hunt (road_event_roll): the question comes without its answer. */
export type RoadEvent = {
  id: number;
  kind: "checkpoint" | "traveller" | "seller";
  npc: string;
  prompt: string | null;
  choices: string[] | null;
  /** At a checkpoint: the gear and papers the officer finds missing (a fine each). */
  missing?: AddonId[];
  /** A passer-by's game (instead of a riddle), or the one a traveller offers once helped. */
  game?: RoadGame | null;
};

export type RoadEventResult = {
  /** "chase": rode past a checkpoint, and the police come after you (owner, 25 Oct 2026). */
  outcome: "passed" | "fined" | "helped" | "declined" | "won" | "lost" | "chase";
  /** The police chase: who comes after you, how fast, from how far behind, and what it takes to lose them. */
  chase?: { chaser: "officer" | "patrol"; kmh: number; gapM: number; loseM: number; seconds: number } | null;
  correct: string | null;
  fine: number;
  reward: number;
  hint: { direction: string; band: string; key: number } | null;
  /** A thank-you from a traveller (owner: "not limited to giving only coins"). */
  gift?:
    | { kind: "coins"; amount: number }
    | { kind: "relic"; relic: "jerry_can" | "second_wind" | "shield" }
    | { kind: "keg"; fresh: boolean }
    | { kind: "item"; item: "tyre_kit" }
    | { kind: "cruise"; tokens: number }
    | null;
};

const RELIC_GIFT: Record<string, string> = { jerry_can: "a Jerry Can relic: a full can of fuel, for when your tank runs dry", second_wind: "a Second Wind relic: 50 energy when you're tired", shield: "a Shield relic: it keeps the rain and traffic off you once" };

export type RoadEventActions = {
  /**
   * checkpoint: a choice, −2 to pay the fine, or −3 to ride on without stopping (a chance of a bigger fine);
   * traveller: 1 to help, 0 not; seller: a choice, or −1 no thanks.
   */
  answer: (event: RoadEvent, choice: number) => Promise<RoadEventResult | null>;
  /** Play tapped: the server starts the game's clock. */
  start: (event: RoadEvent) => Promise<boolean>;
  /** Play the game: one move (a chess move like "g4c8", a cup 0–2, the cards turned), judged by the server. */
  play: (event: RoadEvent, move: string) => Promise<RoadGameResult | null>;
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
  // The game: offered (by a passer-by straight away, by a traveller once helped), being played, and its result.
  const [game, setGame] = useState<"offered" | "playing" | "over" | null>(event.kind === "seller" && event.game ? "offered" : null);
  const [gameResult, setGameResult] = useState<RoadGameResult | null>(null);
  const reward = event.kind === "seller" ? 25 : 20;
  // The clock (owner: "some form of urgency"): it runs once the game can be played; at nought the board locks.
  const [deadline, setDeadline] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const ready = useCallback(() => {
    if (event.game) setDeadline(Date.now() + gameSeconds(event.game) * 1000);
  }, [event.game]);
  useEffect(() => {
    if (deadline === null || game !== "playing") return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && !timeUp) {
        setTimeUp(true);
        void play(timeoutMove(event.game!), true);
      }
    };
    tick();
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
    // play is stable enough for this: it's only called once, at nought
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, game, timeUp]);
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
    if (event.kind === "seller" && event.game)
      return [
        {
          who: "them",
          text:
            event.game.type === "chess"
              ? "Oga, you know chess? Sit down small. Mate in one, White to move: find the checkmate and I'll give you 25 coins."
              : event.game.type === "cups"
                ? "Watch am o! The coin goes under one cup, I shuffle, you find it: 25 coins if your eyes are sharp."
                : `Play with us! ${gameIntro(event.game)}, and we'll give you 25 coins.`,
        },
      ];
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
    cue(r.outcome === "passed" || r.outcome === "won" || r.outcome === "helped" ? "right" : r.outcome === "chase" ? "siren" : r.outcome === "declined" ? "tap" : "wrong");
    if (r.outcome === "chase") {
      // The police give chase: off the scene and onto the road at once.
      say(mine, { who: "them", text: vehicle ? "HEY! STOP! … (Sirens wail. They're coming after you!)" : "Oi! You! STOP there! … (He's running after you!)" });
      window.setTimeout(onClose, 2600);
    } else if (r.outcome === "passed") say(mine, { who: "them", text: "Correct! Everything is in order. Drive safely." });
    else if (r.outcome === "fined" && (event.missing ?? []).length)
      say(mine, { who: "them", text: `Fine paid: ${r.fine} coins. Get your papers sorted at the vehicle panel before I see you again, o.` });
    else if (r.outcome === "fined" && choice === -2) say(mine, { who: "them", text: `Fine paid: ${r.fine} coins. Wait here while I write your receipt.` });
    else if (r.outcome === "fined") say(mine, { who: "them", text: `Wrong! It's "${r.correct}". That's a ${r.fine}-coin fine, and wait here while I write it.` });
    else if (r.outcome === "won") say(mine, { who: "them", text: "Correct! You're sharp o. Take your 25 coins." });
    else if (r.outcome === "lost") say(mine, { who: "them", text: `Ah no! It was "${r.correct}". Better luck next time.` });
    else if (r.outcome === "helped") {
      const g = r.gift ?? null;
      const present = !g
        ? ""
        : g.kind === "relic"
          ? ` Take this: ${RELIC_GIFT[g.relic]}. It's in your inventory.`
          : g.kind === "keg"
            ? g.fresh
              ? " Take my jerry can, it's full of fuel: I don't need it any more."
              : " Let me fill your jerry can for you: it's full now."
            : g.kind === "item"
              ? " Take this tyre kit, pump and patches: fix a flat yourself, anywhere."
              : g.kind === "cruise"
                ? ` Take these ${g.tokens} cruise tokens: let the road carry you a while.`
                : ` Take these ${g.amount} coins for your trouble.`;
      const thanks = r.hint
        ? `Thank you, God bless you! Listen: I passed a crowd of treasure hunters to the ${r.hint.direction} of here, ${r.hint.band} away. That's where Key ${r.hint.key} is, I'm sure of it.${present}`
        : present
          ? `Thank you, God bless you!${present}`
          : r.reward
            ? `Thank you, God bless you! Take these ${r.reward} coins for your trouble.`
            : "Thank you, God bless you!";
      // The traveller has a game to offer, for a little more.
      say(mine, { who: "them", text: event.game ? `${thanks} Before you go, a game? ${gameIntro(event.game)}: 20 coins if you do.` : `${thanks} Safe journey.` });
      if (event.game) setGame("offered");
    }
    else say(mine, { who: "them", text: event.kind === "traveller" ? "No wahala. Safe journey." : "Okay o. Another time." });
  }

  const sent = useRef(false); // one move only (a move and the clock at nought can come together)
  /** `outOfTime`: sent because the clock reached nought (said as such, whatever the server makes of it). */
  async function play(move: string, outOfTime = false) {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    const r = await actions.play(event, move);
    setBusy(false);
    setGame("over");
    setDone(true);
    if (!r) {
      say({ who: "them", text: "Eh, never mind. Go on." });
      return;
    }
    if (outOfTime) r.late = true;
    setGameResult(r);
    cue(r.won && !r.late ? "solved" : "wrong");
    const g = event.game!;
    const cup = ["left", "middle", "right"][Number(r.answer ?? 0)] ?? "other";
    say({
      who: "them",
      text: r.late
        ? g.type === "chess"
          ? `Time! Too slow, my friend. It was ${r.san}.`
          : g.type === "cups"
            ? `Time! Too slow. It was under the ${cup} cup.`
            : "Time! Too slow: the pairs beat you this time."
        : g.type === "chess"
          ? r.won
            ? `Checkmate! ${r.san}. You sabi this game o. Take your ${r.reward} coins.`
            : `Ah no, that's not mate. It was ${r.san}: look at the board.`
          : g.type === "cups"
            ? r.won
              ? `You found it! Sharp eyes. Take your ${r.reward} coins.`
              : `Ha! It was under the ${cup} cup. Better luck next time.`
            : r.won
              ? `All the pairs! You're too good. Take your ${r.reward} coins.`
              : "Too many misses! Next time, next time.",
    });
  }

  // Not stopping at a checkpoint (owner, 22 Oct 2026): usually you get away with it; caught, a bigger fine and a wait.
  const rideOn: SceneChoice = { label: vehicle ? "Ride on without stopping (risky)" : "Walk on without stopping (risky)", onPick: () => void answer(-3, vehicle ? "(You open the throttle and ride straight past.)" : "(You keep walking, eyes front.)") };
  let choices: SceneChoice[];
  if (game === "offered")
    choices = [
      {
        label: `Play · win ${reward}`,
        primary: true,
        onPick: () => {
          setBusy(true);
          void actions.start(event).then(() => {
            setBusy(false);
            setGame("playing");
          });
        },
      },
      event.kind === "seller"
        ? { label: "No thanks", onPick: () => void answer(-1, "No thanks, I'm in a hurry.") }
        : { label: "Go on", onPick: onClose },
    ];
  else if (game === "playing") choices = [];
  else if (done) choices = [{ label: "Go on", primary: true, onPick: onClose }];
  else if (event.kind === "traveller")
    choices = [
      { label: "Of course, let me help (15 s)", primary: true, onPick: () => void answer(1, "Of course, let me help you.") },
      { label: "Sorry, I'm in a hurry", onPick: () => void answer(0, "Sorry, I'm in a hurry.") },
    ];
  else if (event.kind === "checkpoint" && (event.missing ?? []).length)
    choices = [
      { label: `Pay the fine · ${PAPER_FINE * (event.missing ?? []).length} coins`, primary: true, onPick: () => void answer(-2, "Sorry, officer. Here's the fine.") },
      rideOn,
    ];
  else
    choices = [
      ...(event.choices ?? []).map((c, i) => ({ label: c, primary: true, onPick: () => void answer(i, c) })),
      ...(event.kind === "checkpoint"
        ? [{ label: "Just pay the fine · 20 coins", onPick: () => void answer(-2, "I'll just pay the fine.") }, rideOn]
        : [{ label: "No thanks", onPick: () => void answer(-1, "No thanks, I'm in a hurry.") }]),
    ];

  return (
    <EventScene
      stage={event.kind === "checkpoint" ? "checkpoint" : event.kind === "seller" ? "stall" : "roadside"}
      title={
        event.kind === "checkpoint"
          ? "Police checkpoint"
          : event.kind === "seller" && event.game
            ? `${event.npc}: ${event.game.type === "chess" ? "mate in one" : event.game.type === "cups" ? "the three cups" : "pairs"}`
            : event.kind === "seller"
              ? `${event.npc}'s stall`
              : "A stranded traveller"
      }
      sign={
        event.kind === "checkpoint"
          ? "Police checkpoint"
          : event.kind === "seller" && event.game
            ? `${event.game.type === "chess" ? "♟ Mate in one" : event.game.type === "cups" ? "🥤 Find the coin" : "🃏 Pairs"} · ${event.npc}`
            : event.kind === "seller"
              ? `${event.npc}'s snacks`
              : ""
      }
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
      game={
        event.game && (game === "playing" || game === "over") ? (
          <RoadGameBoard game={event.game} result={gameResult} locked={timeUp} onReady={ready} onMove={(m) => void play(m)} />
        ) : null
      }
      countdown={game === "playing" && left !== null && event.game ? { left, total: gameSeconds(event.game) } : null}
      leaveLabel={vehicle ? "Ride on" : "Walk on"}
      onClose={event.kind === "checkpoint" && !done && !busy ? rideOn.onPick : onClose}
    />
  );
}

"use client";

import { useEffect, useState } from "react";
import { wonderOf } from "@/game/wonders";
import type { SceneMoment } from "./EventScene";

/** A seal on the Djinn's map: its verse, and whether favour burned it as a lie. */
export type DjinnSeal = { id: number; verse: string; burned: boolean };
export type DjinnSite = { id: number; name: string; country: string; lng: number; lat: number; verse: string };
export type DjinnGate = {
  /** On this device's clock (ms). */
  deadline: number;
  seconds: number;
  cipher: string;
  floor: { grid: number[][]; riddle: string };
  scales: { weights: number[]; target: number };
};
export type DjinnStage = "summoned" | "gate" | "turned_away" | "seals" | "chosen" | "fooled" | "won" | "over";
/** The Djinn's Wager as the player sees it (djinn_state). Times are on this device's clock (ms). */
export type DjinnState = {
  wager: { id: string; wonder: string; extraWonder: string | null; startsAt: number; endsAt: number; claimedBy: string | null } | null;
  stage: DjinnStage;
  gate: DjinnGate | null;
  retryAt: number | null;
  favour: number;
  riddle: string | null;
  seals: DjinnSeal[] | null;
  chosen: DjinnSite | null;
};
export type Rooms = { cipher: string; floor: { grid: number[][]; riddle: string }; scales: { weights: number[]; target: number } };
export type RoomMarks = { cipher: boolean; floor: boolean; scales: boolean };
export type GateVerdict = { score: number; favour: number; rooms: RoomMarks };
/** In the chamber at the chosen place (djinn_enter_chamber). The deadline is on this device's clock (ms). */
export type DjinnChamber = Rooms & { id: string; place: string; deadline: number; seconds: number };
export type ChamberResult = {
  /** "coin": failed, but a Djinn's Coin stopped the whirlwind (and is spent). */
  outcome: "won" | "empty" | "whirlwind" | "too_late" | "coin";
  rooms: RoomMarks;
  wonder: string;
  extraWonder: string | null;
  dropAt: { name: string; lng: number; lat: number } | null;
};

export type DjinnActions = {
  state: () => Promise<DjinnState>;
  startGate: () => Promise<DjinnState | string>;
  answerGate: (cipher: string, path: number[], weights: number[]) => Promise<GateVerdict | string>;
  choose: (siteId: number) => Promise<DjinnState | string>;
  showWay: (site: DjinnSite) => void;
  /** At the chosen place: the chamber's rooms (the same ones while an attempt is open), or why not. */
  enterChamber: () => Promise<DjinnChamber | string>;
  /** The chamber's answers; a whirlwind carries the player off (the game moves them). */
  answerChamber: (chamberId: string, cipher: string, path: number[], weights: number[]) => Promise<ChamberResult | string>;
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const shiftBack = (text: string, n: number) =>
  text.replace(/[A-Z]/g, (ch) => String.fromCharCode(65 + ((((ch.charCodeAt(0) - 65 - n) % 26) + 26) % 26)));
const countdown = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

/** The old Djinn, rising from the lamp's smoke. */
function DjinnArt({ mood }: { mood: "calm" | "pleased" | "scornful" }) {
  const eye = mood === "scornful" ? "#FF5A5A" : "#FFD24A";
  return (
    <svg viewBox="0 0 200 210" className="loota-djinn-float mx-auto h-44 w-44" aria-hidden="true">
      <defs>
        <linearGradient id="dj-smoke" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#C89BFF" stopOpacity="0.9" />
          <stop offset="1" stopColor="#5B2A9E" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="dj-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4FA3E0" />
          <stop offset="1" stopColor="#2A5FA8" />
        </linearGradient>
      </defs>
      {/* The lamp */}
      <path d="M58 192c0 8 14 12 34 12h18c22 0 34-8 40-20l6-10-14 6c-6 3-10 4-16 4H86c-18 0-28 4-28 8z" fill="#E0A82E" />
      <path d="M84 204l-4 6h44l-4-6" fill="#B8811B" />
      {/* Smoke rising into a body */}
      <path d="M118 180c-4-14 14-18 8-34-5-12-24-10-26-26-1-10 8-16 8-26" stroke="url(#dj-smoke)" strokeWidth="22" fill="none" strokeLinecap="round" />
      {/* Torso and crossed arms */}
      <path d="M64 104c4-18 20-28 36-28s32 10 36 28l4 20c-10 10-26 14-40 14s-30-4-40-14z" fill="url(#dj-skin)" />
      <path d="M58 116c14 8 30 10 42 10s28-2 42-10" stroke="#1E4A86" strokeWidth="12" strokeLinecap="round" fill="none" />
      <circle cx="58" cy="116" r="7" fill="#E0A82E" />
      <circle cx="142" cy="116" r="7" fill="#E0A82E" />
      {/* Head */}
      <ellipse cx="100" cy="58" rx="22" ry="25" fill="url(#dj-skin)" />
      {/* Turban with a jewel */}
      <path d="M74 46c2-22 50-22 52 0-8-6-44-6-52 0z" fill="#7B3FC4" />
      <path d="M76 44c8-5 40-5 48 0" stroke="#E0A82E" strokeWidth="3" fill="none" />
      <circle cx="100" cy="36" r="5" fill="#3DD68C" stroke="#E0A82E" strokeWidth="2" />
      {/* Eyes and brows */}
      <path d={mood === "scornful" ? "M84 52l10 4M116 52l-10 4" : "M84 54l10-2M116 54l-10-2"} stroke="#0F2A50" strokeWidth="3" strokeLinecap="round" />
      <circle cx="91" cy="60" r="3.2" fill={eye} />
      <circle cx="109" cy="60" r="3.2" fill={eye} />
      {/* A long white beard */}
      <path d={mood === "pleased" ? "M84 70c4 6 28 6 32 0 2 14-4 30-16 38-12-8-18-24-16-38z" : "M84 72c6 2 26 2 32 0 0 14-6 30-16 40-10-10-16-26-16-40z"} fill="#F2F0EA" />
      <path d="M92 72c4 3 12 3 16 0" stroke="#0F2A50" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {/* A gold earring */}
      <circle cx="78" cy="66" r="3.5" fill="none" stroke="#E0A82E" strokeWidth="2" />
    </svg>
  );
}

/** Room I: turn the wheel until the words make sense. */
function CipherRoom({ text, value, onChange }: { text: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-paper/80">The door bears strange words. Turn the wheel until they make sense.</p>
      <p className="rounded-xl bg-[#1B0F2E] p-3 text-center font-mono text-xl font-bold tracking-[0.3em] text-[#C89BFF]">{text}</p>
      <div className="flex items-center justify-center gap-3">
        <button type="button" aria-label="Turn the wheel back" onClick={() => onChange((value + 25) % 26)} className="flex size-11 items-center justify-center rounded-full bg-ink-2 text-xl font-bold">
          ⟲
        </button>
        <div className="flex size-20 flex-col items-center justify-center rounded-full border-4 border-gold bg-[#2A1747] font-display" aria-label={`The wheel is at ${value}`}>
          <span className="text-2xl font-extrabold text-gold">{value}</span>
          <span className="text-[10px] text-paper/60">turns</span>
        </div>
        <button type="button" aria-label="Turn the wheel on" onClick={() => onChange((value + 1) % 26)} className="flex size-11 items-center justify-center rounded-full bg-ink-2 text-xl font-bold">
          ⟳
        </button>
      </div>
      <p className="text-center font-mono text-lg font-bold tracking-[0.25em] text-paper" aria-label="What the wheel reads">
        {shiftBack(text, value)}
      </p>
    </div>
  );
}

/** Room II: cross the cursed floor from the bottom row to the top, one row at a time. */
function FloorRoom({ grid, riddle, path, onChange }: { grid: number[][]; riddle: string; path: number[]; onChange: (p: number[]) => void }) {
  const rows = grid.length;
  // path[0] is the bottom row; the next stone must be in the row above, beside or straight ahead.
  const nextRow = path.length;
  const canStep = (row: number, col: number) =>
    row === nextRow && (path.length === 0 || Math.abs(col - path[path.length - 1]) <= 1);
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-xl bg-[#1B0F2E] p-3 text-sm italic text-[#E8D8FF]">&ldquo;{riddle}&rdquo;</p>
      <p className="text-xs text-paper/70">Start on the bottom row. Each step goes up one row, straight or one stone to the side.</p>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${grid[0].length}, minmax(0, 1fr))` }}>
        {grid.map((line, i) => {
          const row = rows - 1 - i; // 0 = bottom
          return line.map((n, col) => {
            const on = path[row] === col;
            const open = canStep(row, col);
            return (
              <button
                key={`${row}-${col}`}
                type="button"
                disabled={!open && !on}
                onClick={() => open && onChange([...path, col])}
                className={`h-11 rounded-lg text-sm font-bold ${on ? "bg-gold text-ink" : open ? "bg-[#3A2460] text-paper ring-1 ring-[#C89BFF]" : "bg-ink-2 text-paper/50"}`}
              >
                {n}
              </button>
            );
          });
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-paper/70">
        <span>
          {path.length} of {rows} rows crossed
        </span>
        <button type="button" onClick={() => onChange([])} className="font-bold text-gold underline">
          Start again
        </button>
      </div>
    </div>
  );
}

/** Room III: put stones on the scales to match the idol's weight. */
function ScalesRoom({ weights, target, picked, onChange }: { weights: number[]; target: number; picked: number[]; onChange: (p: number[]) => void }) {
  const total = picked.reduce((s, i) => s + weights[i], 0);
  const tilt = Math.max(-12, Math.min(12, (total - target) / 2));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-paper/80">
        The golden idol weighs <b className="text-gold">{target}</b>. Put stones on the other pan until the scales balance.
      </p>
      <svg viewBox="0 0 200 70" className="mx-auto w-56" aria-label={`Your stones weigh ${total} of ${target}`}>
        <path d="M100 10v52M80 64h40" stroke="#E0A82E" strokeWidth="4" strokeLinecap="round" />
        <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: "100px 14px", transition: "transform 0.4s" }}>
          <path d="M30 14h140" stroke="#E0A82E" strokeWidth="4" strokeLinecap="round" />
          <path d="M18 34h24M158 34h24" stroke="#E0A82E" strokeWidth="4" strokeLinecap="round" />
          <path d="M30 14l-12 20M30 14l12 20M170 14l-12 20M170 14l12 20" stroke="#E0A82E" strokeWidth="1.5" />
          <text x="30" y="30" textAnchor="middle" fontSize="12" fill="#FFD24A">
            🗿
          </text>
          <text x="170" y="31" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#fff">
            {total}
          </text>
        </g>
      </svg>
      <div className="grid grid-cols-3 gap-2">
        {weights.map((w, i) => {
          const on = picked.includes(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange(on ? picked.filter((x) => x !== i) : [...picked, i])}
              className={`h-12 rounded-xl text-base font-bold ${on ? "bg-gold text-ink" : "bg-ink-2 text-paper ring-1 ring-line"}`}
              aria-pressed={on}
            >
              🪨 {w}
            </button>
          );
        })}
      </div>
      <p className={`text-center text-sm font-bold ${total === target ? "text-[#3DD68C]" : "text-paper/70"}`}>
        {total} of {target}
        {total === target ? ": balanced" : ""}
      </p>
    </div>
  );
}

/** Three rooms against the clock (the gate, or the harder chamber); answered all together. */
function RoomsPuzzle({
  rooms,
  deadline,
  seconds,
  now,
  working,
  speak,
  onSpeak,
  onMoment,
}: {
  rooms: Rooms;
  deadline: number;
  seconds: number;
  now: number;
  working: boolean;
  speak: string;
  onSpeak: (cipher: string, path: number[], weights: number[]) => void;
  /** In the chamber on the map: which room you're in, the wheel, your steps, your stones. */
  onMoment?: (m: SceneMoment) => void;
}) {
  const [room, setRoomState] = useState(0);
  const [shift, setShiftState] = useState(0);
  const [path, setPathState] = useState<number[]>([]);
  const [stones, setStonesState] = useState<number[]>([]);
  const setRoom = (n: number) => {
    setRoomState(n);
    onMoment?.({ type: "room", n });
  };
  const setShift = (n: number) => {
    setShiftState(n);
    onMoment?.({ type: "cipher", shift: n });
  };
  const setPath = (p: number[]) => {
    setPathState(p);
    onMoment?.({ type: "path", path: p });
  };
  const setStones = (p: number[]) => {
    setStonesState(p);
    const total = p.reduce((s, i) => s + rooms.scales.weights[i], 0);
    onMoment?.({ type: "scales", stones: p.length, tilt: Math.max(-12, Math.min(12, (total - rooms.scales.target) / 2)) });
  };
  const left = Math.max(0, deadline - now);
  const button = "h-11 rounded-xl px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded bg-line">
          <div className="h-full bg-[#C89BFF] transition-[width] duration-300" style={{ width: `${(left / 1000 / seconds) * 100}%` }} />
        </div>
        <span className="w-12 text-right text-xs font-bold text-paper/80">{countdown(left)}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="The rooms">
        {["I · Cipher", "II · Floor", "III · Scales"].map((label, i) => {
          const done = i === 0 ? shift > 0 : i === 1 ? path.length === rooms.floor.grid.length : stones.length > 0;
          return (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={room === i}
              onClick={() => setRoom(i)}
              className={`h-10 rounded-lg text-xs font-bold ${room === i ? "bg-[#9B5DE5] text-paper" : "bg-ink-2 text-paper/80"}`}
            >
              {done ? "✓ " : ""}
              {label}
            </button>
          );
        })}
      </div>
      {room === 0 && <CipherRoom text={rooms.cipher} value={shift} onChange={setShift} />}
      {room === 1 && <FloorRoom grid={rooms.floor.grid} riddle={rooms.floor.riddle} path={path} onChange={setPath} />}
      {room === 2 && <ScalesRoom weights={rooms.scales.weights} target={rooms.scales.target} picked={stones} onChange={setStones} />}
      <div className="flex gap-2">
        {room < 2 && (
          <button type="button" onClick={() => setRoom(room + 1)} className={`${button} bg-ink-2 text-paper`}>
            Next room
          </button>
        )}
        <button type="button" disabled={working} onClick={() => onSpeak(shiftBack(rooms.cipher, shift), path, stones)} className={`${button} bg-gold text-ink`}>
          {speak}
        </button>
      </div>
    </div>
  );
}

/** The Djinn's Wager (design doc 7.6): the summons, the gate, the seals, the way, and the chamber. */
export function DjinnPanel({
  actions,
  chamber: chamberStart,
  world = false,
  onMoment,
  onClose,
}: {
  actions: DjinnActions;
  /** Opened at the chosen place by "Enter the chamber": the rooms already asked for, or why not. */
  chamber: DjinnChamber | string | null;
  /**
   * The chamber on the map (owner, 18 Oct 2026: scenes in the world): the vault drawn there with the Djinn hovering
   * by its door; the rooms in a sheet at the bottom, and what you do in them shown in the vault (onMoment).
   */
  world?: boolean;
  onMoment?: (m: SceneMoment) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<DjinnState | null>(null);
  const [now, setNow] = useState(0);
  const [message, setMessage] = useState<string | null>(typeof chamberStart === "string" ? chamberStart : null);
  const [working, setWorking] = useState(false);
  const [verdict, setVerdict] = useState<GateVerdict | null>(null);
  const chamber = typeof chamberStart === "object" ? chamberStart : null;
  const [ending, setEnding] = useState<ChamberResult | null>(null);
  const [breaking, setBreaking] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void actions.state().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [actions]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, []);

  const wonder = state?.wager ? wonderOf(state.wager.wonder) : null;
  const stage = state?.stage;
  const button = "h-11 rounded-xl px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40";

  const faceGate = async () => {
    setWorking(true);
    setMessage(null);
    const r = await actions.startGate();
    setWorking(false);
    if (typeof r === "string") setMessage(r);
    else setState(r);
  };
  const speak = async (cipher: string, path: number[], weights: number[]) => {
    setWorking(true);
    const r = await actions.answerGate(cipher, path, weights);
    setWorking(false);
    if (typeof r === "string") setMessage(r);
    else setVerdict(r);
  };
  const speakInChamber = async (cipher: string, path: number[], weights: number[]) => {
    if (!chamber) return;
    setWorking(true);
    const r = await actions.answerChamber(chamber.id, cipher, path, weights);
    setWorking(false);
    if (typeof r === "string") setMessage(r);
    else {
      setEnding(r);
      if (r.outcome === "won") onMoment?.({ type: "won" });
      if (r.outcome === "whirlwind") {
        onMoment?.({ type: "whirlwind" });
        window.setTimeout(onClose, 2600); // the wind carries them off
      }
    }
  };
  const unroll = async () => {
    setVerdict(null);
    setState(await actions.state());
  };
  const breakSeal = async (id: number) => {
    setWorking(true);
    const r = await actions.choose(id);
    setWorking(false);
    setBreaking(null);
    if (typeof r === "string") setMessage(r);
    else setState(r);
  };

  const mood =
    stage === "turned_away" || stage === "fooled" || (verdict && verdict.score === 0) || ending?.outcome === "empty" || ending?.outcome === "whirlwind" || ending?.outcome === "coin"
      ? "scornful"
      : (verdict && verdict.favour > 0) || ending?.outcome === "won" || stage === "won"
        ? "pleased"
        : "calm";
  const line = (() => {
    if (ending) {
      if (ending.outcome === "won")
        return `Impossible… The chamber is mastered. Take it, then: ${wonderOf(ending.wonder).name} is yours. Use it well, little king, and tell no one.`;
      if (ending.outcome === "empty") return "Hahaha! An empty vault! You trusted the wrong seal, little traveller. My treasure lies elsewhere, and you will never touch it now.";
      if (ending.outcome === "too_late") return "Too slow! Another hand has already taken my treasure. The vault is bare.";
      if (ending.outcome === "coin")
        return "Wrong! Away with y… What is that? MY Coin! It glows, and my wind dies at your feet. It is dust now, thief. The vault stays shut: try my rooms again, if you dare.";
      return "Wrong! The floor gives way to a howling wind… Away with you!";
    }
    if (chamber && !state) return "…";
    if (chamber) return `So you found ${chamber.place}. Three rooms guard my vault, harder than my gate. Fail, and the wind will carry you far away.`;
    if (!state?.wager || !wonder) return "The lamp is cold. The Djinn sleeps.";
    if (verdict) {
      if (verdict.score === 0) return "Pah! A mind as dull as a rusty lamp. Come back when the sand has turned.";
      if (verdict.favour === 2) return "Hah! A sharp one. Two of my lies burn before your eyes.";
      if (verdict.favour === 1) return "Not bad, little traveller. One of my lies burns.";
      return "You scraped through my gate. Find the truth yourself.";
    }
    switch (stage) {
      case "summoned":
        return `Three hundred years I slept in this lamp… and YOU are the one who woke me? Small hands. Yet I know where ${wonder.name} lies hidden: ${wonder.boast}. Prove your mind is sharper than your boots, and I will show you the way.`;
      case "gate":
        return "Three rooms guard my gate. Be quick: the sand is falling.";
      case "turned_away":
        return "Pah! A mind as dull as a rusty lamp. Come back when the sand has turned.";
      case "seals":
        return "Eight seals, one truth. Read my riddle, then break the seal you trust. Choose well: the lamp does not forgive.";
      case "chosen":
        return "So be it. The way is yours. Go, before another hand reaches it first.";
      case "fooled":
        return "You trusted the wrong seal. The vault was empty. Sleep now; I will wake you again.";
      case "won":
        return `You hold ${wonder.name}. Use it well, little king, and tell no one.`;
      default:
        return state.wager.claimedBy
          ? `${state.wager.claimedBy} has taken ${wonder.name}. Sleep, little traveller; I will wake you again.`
          : "The sand has run out. Sleep, little traveller; I will wake you again.";
    }
  })();

  const gate = state?.gate ?? null;

  // In the chamber on the map: a sheet at the bottom, the vault in view above (the Djinn is there, not drawn here).
  const sheet = world && !!chamber;
  return (
    <div className={sheet ? "pointer-events-none absolute inset-0 z-20 flex items-end justify-center" : "absolute inset-0 z-20 flex items-end justify-center bg-[#0B0616]/80 sm:items-center"}>
      <div
        role="dialog"
        aria-label="The Djinn"
        data-scene-strip={sheet ? "" : undefined}
        className={
          sheet
            ? "pointer-events-auto max-h-[48dvh] w-full overflow-y-auto rounded-t-3xl bg-gradient-to-b from-[#2A1747]/95 to-ink/95 p-3 ring-1 ring-[#9B5DE5] sm:max-w-lg"
            : "max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-gradient-to-b from-[#2A1747] to-ink p-5 ring-1 ring-[#9B5DE5] sm:max-w-lg sm:rounded-3xl"
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold text-[#E8D8FF]">{chamber ? `The Chamber of ${chamber.place}` : "The Djinn's Wager"}</h2>
            {state?.wager && wonder && stage !== "over" && (
              <p className="text-xs text-paper/70">
                At stake: {wonder.icon} <b className="text-gold">{wonder.name.replace(/^the /, "The ")}</b> · ⏳ {now ? countdown(state.wager.endsAt - now) : "…"} left
              </p>
            )}
          </div>
          {(chamber ? !!ending && ending.outcome !== "whirlwind" : stage !== "gate") && (
            <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>

        {sheet ? (
          // The Djinn's words in a box (he hovers in the vault above).
          <p className="mt-2 rounded-xl bg-[#F5ECD8] px-3 py-2 text-sm font-semibold leading-snug text-[#3A2410]" role="status">
            <span className="mr-1.5 font-extrabold text-[#7C4DCC]">The Djinn:</span>
            {line}
          </p>
        ) : (chamber ? !!ending || !state : stage !== "gate" || verdict) ? (
          <>
            <DjinnArt mood={mood} />
            <p className="relative rounded-2xl bg-[#F5ECD8] p-4 text-sm font-semibold leading-relaxed text-[#3A2410] shadow-lg" role="status">
              {line}
            </p>
          </>
        ) : null}

        {message && <p className="mt-3 rounded-xl bg-ink-2 p-3 text-sm ring-1 ring-gold">{message}</p>}

        {!state ? (
          <p className="mt-4 text-sm text-paper/70">The lamp stirs…</p>
        ) : verdict ? (
          <div className="mt-4 flex flex-col gap-3">
            <ul className="flex flex-col gap-1 text-sm">
              <li>{verdict.rooms.cipher ? "✓" : "✗"} The cipher wheel</li>
              <li>{verdict.rooms.floor ? "✓" : "✗"} The cursed floor</li>
              <li>{verdict.rooms.scales ? "✓" : "✗"} The idol&apos;s scales</li>
            </ul>
            {verdict.score > 0 ? (
              <button type="button" onClick={() => void unroll()} className={`${button} self-start bg-gold text-ink`}>
                Unroll the map
              </button>
            ) : (
              <button type="button" onClick={onClose} className={`${button} self-start bg-ink-2 text-paper`}>
                Leave
              </button>
            )}
          </div>
        ) : stage === "summoned" ? (
          <div className="mt-4 flex flex-col gap-3">
            {wonder && <p className="rounded-xl bg-ink-2 p-3 text-xs text-paper/80">{wonder.icon} {wonder.effect}</p>}
            <p className="text-xs text-paper/70">
              Three rooms, {gate ? gate.seconds / 60 : 4} minutes. Solve them well and the Djinn burns some of his lies from the map. Fail them all and he
              turns you away for two hours.
            </p>
            <button type="button" disabled={working} onClick={() => void faceGate()} className={`${button} self-start bg-[#9B5DE5] text-paper`}>
              Face the gate
            </button>
          </div>
        ) : chamber ? (
          ending ? (
            <div className={`mt-4 flex flex-col gap-3 ${ending.outcome === "whirlwind" ? "loota-whirlwind" : ""}`}>
              <ul className="flex flex-col gap-1 text-sm">
                <li>{ending.rooms.cipher ? "✓" : "✗"} The cipher wheel</li>
                <li>{ending.rooms.floor ? "✓" : "✗"} The cursed floor</li>
                <li>{ending.rooms.scales ? "✓" : "✗"} The idol&apos;s scales</li>
              </ul>
              {ending.outcome === "won" && (
                <p className="rounded-2xl bg-[#F5ECD8] p-4 text-center font-display text-xl font-extrabold text-[#3A2410]">
                  {wonderOf(ending.wonder).icon} {wonderOf(ending.wonder).name.replace(/^the /, "The ")}
                  {ending.extraWonder ? ` and ${wonderOf(ending.extraWonder).name}` : ""} {ending.extraWonder ? "are" : "is"} yours
                </p>
              )}
              {ending.outcome !== "whirlwind" && (
                <button type="button" onClick={onClose} className={`${button} self-start bg-gold text-ink`}>
                  {ending.outcome === "won" ? "Take it" : "Leave"}
                </button>
              )}
            </div>
          ) : (
            <RoomsPuzzle
              rooms={chamber}
              deadline={chamber.deadline}
              seconds={chamber.seconds}
              now={now}
              working={working}
              speak="Speak the final words"
              onSpeak={(c, p, w) => void speakInChamber(c, p, w)}
              onMoment={onMoment}
            />
          )
        ) : stage === "gate" && gate ? (
          <RoomsPuzzle rooms={gate} deadline={gate.deadline} seconds={gate.seconds} now={now} working={working} speak="Speak to the Djinn" onSpeak={(c, p, w) => void speak(c, p, w)} />
        ) : stage === "won" && wonder ? (
          <p className="mt-4 rounded-2xl bg-[#F5ECD8] p-4 text-center font-display text-lg font-extrabold text-[#3A2410]">
            {wonder.icon} {wonder.name.replace(/^the /, "The ")} is in your bag. Only you know.
          </p>
        ) : stage === "turned_away" ? (
          <p className="mt-4 text-sm text-paper/80">The gate opens again in {state.retryAt && now ? countdown(state.retryAt - now) : "a while"}.</p>
        ) : stage === "seals" && state.seals ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="rounded-xl bg-[#F5ECD8] p-3 text-sm font-bold italic text-[#5A2A10]">&ldquo;{state.riddle}&rdquo;</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {state.seals.map((seal, i) => (
                <li key={seal.id}>
                  <button
                    type="button"
                    disabled={seal.burned || working}
                    onClick={() => setBreaking(seal.id)}
                    className={`flex w-full gap-3 rounded-xl p-3 text-left text-xs ${
                      seal.burned ? "bg-[#1A1210] text-paper/40 line-through" : breaking === seal.id ? "bg-[#F5ECD8] text-[#3A2410] ring-2 ring-gold" : "bg-[#E9DCC0] text-[#3A2410]"
                    }`}
                  >
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold ${seal.burned ? "bg-[#3A2A20] text-paper/40" : "bg-[#9E1B1B] text-[#F5ECD8]"}`}
                      aria-hidden="true"
                    >
                      {seal.burned ? "🔥" : ROMAN[i]}
                    </span>
                    <span>{seal.burned ? "A lie, burned by the Djinn." : seal.verse}</span>
                  </button>
                </li>
              ))}
            </ul>
            {breaking !== null && (
              <div className="flex flex-col gap-2 rounded-xl bg-ink-2 p-3 ring-1 ring-gold">
                <p className="text-sm font-bold">Break seal {ROMAN[state.seals.findIndex((s) => s.id === breaking)]}? Your choice is final.</p>
                <div className="flex gap-2">
                  <button type="button" disabled={working} onClick={() => void breakSeal(breaking)} className={`${button} bg-[#9E1B1B] text-paper`}>
                    Break it
                  </button>
                  <button type="button" onClick={() => setBreaking(null)} className={`${button} bg-ink text-paper`}>
                    Wait
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : stage === "chosen" && state.chosen ? (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[#F5ECD8] p-4 text-[#3A2410]">
            <p className="font-display text-xl font-extrabold">
              {state.chosen.name}, {state.chosen.country}
            </p>
            <p className="text-sm italic">{state.chosen.verse}</p>
            <p className="text-xs">
              Reach it before the Wager ends. Only one seal is true, and only the first to master its chamber takes {wonder?.name ?? "the treasure"}.
            </p>
            <button
              type="button"
              onClick={() => {
                actions.showWay(state.chosen!);
                onClose();
              }}
              className={`${button} self-start bg-[#9E1B1B] text-paper`}
            >
              Show me the way
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

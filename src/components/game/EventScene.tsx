"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { HunterFigure } from "@/components/HunterFigure";
import type { AvatarLook } from "@/lib/avatar";
import type { VehicleKind } from "@/game/economy";

/** Where a scene takes place. */
export type SceneStage = "bicycle_shop" | "workshop" | "bike_hire";
export type SceneLine = { who: "them" | "you"; text: string };
export type SceneChoice = { label: string; primary?: boolean; onPick: () => void };

/**
 * A moment in the game as a little 2D scene (owner, 17 Oct 2026): the place, the person there, and a short
 * conversation with replies to pick. Their newest line types itself out; the replies show once it has.
 */
export function EventScene({
  stage,
  title,
  sign,
  them,
  you,
  vehicle,
  lines,
  choices,
  busy = false,
  work = null,
  onClose,
}: {
  stage: SceneStage;
  title: string;
  /** What the shop's sign says. */
  sign: string;
  them: { name: string; look: AvatarLook; wrap?: string };
  you: AvatarLook;
  /** A vehicle in the middle of the scene: the player's own being repaired (broken until `fixed`), or one for hire. */
  vehicle?: Vehicle | null;
  lines: SceneLine[];
  choices: SceneChoice[];
  busy?: boolean;
  /** Work under way: seconds left of the total (the keeper works, a bar fills). */
  work?: { left: number; total: number } | null;
  onClose: () => void;
}) {
  const last = lines.at(-1);
  const typing = last?.who === "them" ? last.text : null;
  const [typed, setTyped] = useState({ text: "", shown: 0 });
  const shown = typed.text === typing ? typed.shown : 0;
  const done = !typing || shown >= typing.length;
  useEffect(() => {
    if (!typing) return;
    const timer = window.setInterval(() => {
      setTyped((t) => {
        const from = t.text === typing ? t.shown : 0;
        if (from >= typing.length) {
          window.clearInterval(timer);
          return t;
        }
        return { text: typing, shown: Math.min(typing.length, from + 2) };
      });
    }, 30);
    return () => window.clearInterval(timer);
  }, [typing]);

  // Keep the newest line in view.
  const talk = useRef<HTMLDivElement>(null);
  useEffect(() => {
    talk.current?.scrollTo({ top: talk.current.scrollHeight, behavior: "smooth" });
  }, [lines.length, shown]);

  const working = !!work && work.left > 0;
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/70 sm:items-center">
      <div role="dialog" aria-label={title} className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-ink sm:max-w-lg sm:rounded-3xl">
        {/* The place */}
        <div className="relative w-full shrink-0" style={{ aspectRatio: "16 / 9" }}>
          <Stage stage={stage} sign={sign} vehicle={vehicle ?? null} working={working} />
          <div className={`absolute bottom-[6%] left-[8%] w-[17%] [&_svg]:h-auto [&_svg]:w-full ${working ? "loota-npc-work" : "loota-npc-idle"}`} aria-hidden="true">
            <HunterFigure look={them.look} wrap={them.wrap} width={200} />
          </div>
          <div className="absolute bottom-[6%] right-[8%] w-[17%] -scale-x-100 [&_svg]:h-auto [&_svg]:w-full" aria-hidden="true">
            <HunterFigure look={you} width={200} />
          </div>
          <span className="absolute bottom-[1%] left-[8%] rounded-md bg-ink/80 px-1.5 text-[11px] font-bold text-paper">{them.name}</span>
          <span className="absolute bottom-[1%] right-[8%] rounded-md bg-ink/80 px-1.5 text-[11px] font-bold text-paper">You</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Leave"
            className="absolute right-2 top-2 flex size-10 items-center justify-center rounded-xl bg-ink/80 text-paper"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* The conversation */}
        <div ref={talk} className="flex min-h-[140px] flex-1 flex-col gap-2 overflow-y-auto p-4" aria-live="polite">
          {lines.map((l, i) => {
            const text = i === lines.length - 1 && l.who === "them" ? l.text.slice(0, shown) : l.text;
            return (
              <p
                key={i}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  l.who === "them" ? "self-start rounded-bl-md bg-ink-2 text-paper" : "self-end rounded-br-md bg-gold font-semibold text-ink"
                }`}
              >
                {l.who === "them" && <span className="mb-0.5 block text-[11px] font-bold text-gold">{them.name}</span>}
                {text}
                {i === lines.length - 1 && !done && <span className="loota-caret">▍</span>}
              </p>
            );
          })}
          {work && work.total > 0 && (
            <div className="mt-1 flex flex-col gap-1" aria-label="Repair under way">
              <div className="h-2.5 overflow-hidden rounded-full bg-ink-2">
                <div className="h-full rounded-full bg-gold transition-[width] duration-1000" style={{ width: `${Math.round((100 * (work.total - work.left)) / work.total)}%` }} />
              </div>
              <span className="text-xs text-muted">{work.left > 0 ? `Ready in ${Math.floor(work.left / 60)}:${String(work.left % 60).padStart(2, "0")}` : "Ready!"}</span>
            </div>
          )}
        </div>

        {/* Replies */}
        <div className="flex flex-col gap-2 border-t border-line p-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          {done &&
            choices.map((c) => (
              <button
                key={c.label}
                type="button"
                disabled={busy}
                onClick={c.onPick}
                className={`min-h-11 rounded-xl px-4 text-left text-sm font-bold disabled:opacity-50 ${
                  c.primary ? "bg-gold text-ink" : "border-[1.5px] border-line text-paper"
                }`}
              >
                {c.label}
              </button>
            ))}
          {!done && <span className="h-11 text-sm text-muted">…</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The places, drawn flat (viewBox 320 × 180).

type Vehicle = { kind: VehicleKind; fixed: boolean; sparkle?: boolean };

function Stage({ stage, sign, vehicle, working }: { stage: SceneStage; sign: string; vehicle: Vehicle | null; working: boolean }) {
  const shop = stage === "bicycle_shop";
  const hire = stage === "bike_hire";
  return (
    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 size-full" aria-hidden="true">
      <defs>
        <linearGradient id="scene-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7FC1EE" />
          <stop offset="1" stopColor="#D6EEFB" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#scene-sky)" />
      {/* Town behind */}
      <g fill="#B9CBD8">
        <rect x="0" y="34" width="34" height="40" />
        <rect x="40" y="24" width="26" height="50" />
        <rect x="250" y="28" width="30" height="46" />
        <rect x="286" y="38" width="34" height="36" />
      </g>
      {hire ? (
        <BikeHireStop kind={vehicle?.kind === "motorbike" ? "motorbike" : "bicycle"} />
      ) : (
        <>
          {/* The ground: a dusty roadside */}
          <rect y="146" width="320" height="34" fill={shop ? "#D2AE7A" : "#9C8E7C"} />
          <rect y="146" width="320" height="3" fill="#000" opacity="0.08" />
          {!shop && <ellipse cx="160" cy="166" rx="46" ry="6" fill="#3B2F25" opacity="0.35" />}

          {/* The shop: wall, zinc roof, poles */}
          <rect x="10" y="58" width="300" height="90" fill={shop ? "#EAD9B6" : "#C9C3B6"} />
          <rect x="10" y="58" width="300" height="8" fill="#000" opacity="0.08" />
          <polygon points="0,60 320,60 308,40 12,40" fill={shop ? "#A7B1B9" : "#8B5A3C"} />
          <g stroke={shop ? "#8C969E" : "#6E4630"} strokeWidth="1.2">
            {Array.from({ length: 30 }, (_, i) => (
              <line key={i} x1={14 + i * 10} y1="41" x2={11 + i * 10.2} y2="59" />
            ))}
          </g>
          <rect x="14" y="58" width="5" height="90" fill="#7A5230" />
          <rect x="301" y="58" width="5" height="90" fill="#7A5230" />
        </>
      )}

      {/* The hand-painted sign */}
      <line x1="100" y1="38" x2="100" y2={hire ? 62 : 44} stroke="#4A3A2A" strokeWidth="2" />
      <line x1="220" y1="38" x2="220" y2={hire ? 134 : 44} stroke="#4A3A2A" strokeWidth={hire ? 3 : 2} />
      <rect x="64" y="12" width="192" height="26" rx="3" fill={hire ? "#1E9E62" : shop ? "#1E6FB8" : "#B8322A"} stroke="#1B2433" strokeWidth="1.5" />
      <text x="160" y="29" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="800" fontFamily="system-ui, sans-serif" textLength={Math.min(180, sign.length * 7)} lengthAdjust="spacingAndGlyphs">
        {sign.toUpperCase()}
      </text>

      {hire ? null : shop ? <BicycleShopProps /> : <WorkshopProps />}

      {/* The player's own vehicle, in the middle */}
      {vehicle && (
        <g transform="translate(160 166)">
          {vehicle.kind === "bicycle" ? (
            <Bicycle x={0} y={0} scale={1.6} colour={hire ? "#E5484D" : "#5B6475"} lean={vehicle.fixed ? 0 : -8} flat={!vehicle.fixed} />
          ) : vehicle.kind === "motorbike" ? (
            <Motorbike x={0} y={0} scale={1.45} colour={hire ? "#E5484D" : "#2F6FEB"} lean={vehicle.fixed ? 0 : -6} />
          ) : (
            <Car x={0} y={0} scale={1} colour="#E5484D" bonnetUp={!vehicle.fixed} />
          )}
          {working && (
            <g className="loota-spanner" style={{ transformOrigin: "-22px -38px" }}>
              <path d="M-30 -44 l12 12 m-14 -14 a3.5 3.5 0 1 1 5 -5" stroke="#5B6475" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            </g>
          )}
          {vehicle.fixed && (vehicle.sparkle ?? true) && (
            <g fill="#F4B41A" className="loota-sparkle">
              <path d="M-32 -50l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
              <path d="M30 -42l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" />
            </g>
          )}
        </g>
      )}
    </svg>
  );
}

/** A bus stop by the road where the renter waits: the shelter, the yellow BUS STOP sign, more for hire lined up. */
function BikeHireStop({ kind }: { kind: "bicycle" | "motorbike" }) {
  return (
    <g>
      {/* Pavement and road */}
      <rect y="132" width="320" height="22" fill="#C9C2B4" />
      <rect y="132" width="320" height="2" fill="#000" opacity="0.1" />
      <rect y="154" width="320" height="26" fill="#4A4F57" />
      <g fill="#F4F1EA">
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={6 + i * 42} y="168" width="22" height="2.5" />
        ))}
      </g>
      {/* The shelter */}
      <rect x="40" y="62" width="4" height="72" fill="#5B6475" />
      <rect x="132" y="62" width="4" height="72" fill="#5B6475" />
      <rect x="34" y="56" width="108" height="9" rx="2" fill="#1E9E62" />
      <rect x="46" y="68" width="84" height="44" fill="#CFE6F7" opacity="0.6" />
      <rect x="50" y="112" width="76" height="5" rx="2" fill="#7A5230" />
      <rect x="54" y="117" width="3" height="15" fill="#7A5230" />
      <rect x="119" y="117" width="3" height="15" fill="#7A5230" />
      {/* BUS STOP */}
      <rect x="152" y="70" width="3" height="64" fill="#5B6475" />
      <rect x="136" y="58" width="35" height="15" rx="2" fill="#F4D03F" stroke="#1B2433" strokeWidth="1" />
      <text x="153.5" y="68.5" textAnchor="middle" fontSize="5.5" fontWeight="800" fill="#1B2433" fontFamily="system-ui, sans-serif">
        BUS STOP
      </text>
      {/* More for hire, lined up */}
      {kind === "bicycle" ? (
        <>
          <Bicycle x={196} y={140} scale={0.95} colour="#1E9E62" lean={0} />
          <Bicycle x={226} y={140} scale={0.95} colour="#F4B41A" lean={0} />
          <Bicycle x={286} y={140} scale={0.95} colour="#2F6FEB" lean={0} />
        </>
      ) : (
        <>
          <Motorbike x={196} y={140} scale={0.9} colour="#1E9E62" lean={0} />
          <Motorbike x={232} y={140} scale={0.9} colour="#F4B41A" lean={0} />
          <Motorbike x={290} y={140} scale={0.9} colour="#2F6FEB" lean={0} />
        </>
      )}
    </g>
  );
}

function BicycleShopProps() {
  return (
    <g>
      {/* Tyres hanging on the wall, and the tool board */}
      {[56, 78, 100].map((x, i) => (
        <g key={x}>
          <line x1={x} y1="62" x2={x} y2={70 + (i % 2) * 4} stroke="#4A3A2A" strokeWidth="1" />
          <circle cx={x} cy={80 + (i % 2) * 4} r="9" fill="none" stroke="#222" strokeWidth="4" />
        </g>
      ))}
      <rect x="226" y="66" width="62" height="34" rx="2" fill="#6B4A2B" />
      <g stroke="#C9CED6" strokeWidth="2.2" strokeLinecap="round">
        <path d="M236 72v20M246 72l4 20M258 74v18M270 72l-3 20M280 74v16" />
      </g>
      {/* Bicycles waiting, leaning on the wall */}
      <Bicycle x={58} y={146} scale={1.05} colour="#E5484D" lean={0} />
      <Bicycle x={104} y={146} scale={1.05} colour="#1E9E62" lean={0} />
      <Bicycle x={236} y={146} scale={1.05} colour="#F4B41A" lean={0} />
      <Bicycle x={280} y={146} scale={1.05} colour="#2F6FEB" lean={0} />
      {/* A stack of old tyres */}
      <g fill="#2A2A2A">
        <ellipse cx="200" cy="144" rx="13" ry="4" />
        <ellipse cx="200" cy="138" rx="13" ry="4" />
        <ellipse cx="200" cy="132" rx="13" ry="4" />
      </g>
    </g>
  );
}

function WorkshopProps() {
  return (
    <g>
      {/* Oil drums, a tool board, a car and a motorbike in for repair */}
      {[
        [36, "#1E6FB8"],
        [56, "#B8322A"],
      ].map(([x, c]) => (
        <g key={x as number}>
          <rect x={(x as number) - 9} y="118" width="18" height="28" fill={c as string} />
          <ellipse cx={x as number} cy="118" rx="9" ry="3" fill="#00000055" />
          <rect x={(x as number) - 9} y="126" width="18" height="2" fill="#00000033" />
          <rect x={(x as number) - 9} y="136" width="18" height="2" fill="#00000033" />
        </g>
      ))}
      <rect x="92" y="66" width="62" height="34" rx="2" fill="#4A3A2A" />
      <g stroke="#C9CED6" strokeWidth="2.2" strokeLinecap="round">
        <path d="M102 72v20M112 72l4 20M124 74v18M136 72l-3 20M146 74v16" />
      </g>
      <Car x={262} y={146} scale={0.75} colour="#13A3A3" bonnetUp />
      <Motorbike x={208} y={146} scale={0.95} colour="#F07A28" lean={0} />
      <g fill="#2A2A2A">
        <ellipse cx="80" cy="144" rx="12" ry="4" />
        <ellipse cx="80" cy="138" rx="12" ry="4" />
      </g>
    </g>
  );
}

function Wheel({ cx, r, flat = false }: { cx: number; r: number; flat?: boolean }): ReactNode {
  return (
    <g>
      <ellipse cx={cx} cy={-r} rx={r} ry={flat ? r * 0.82 : r} fill="none" stroke="#222" strokeWidth="2.6" />
      <path d={`M${cx - r * 0.7} ${-r}h${r * 1.4}M${cx} ${-r * 1.7}v${r * 1.4}`} stroke="#9AA1AC" strokeWidth="0.8" />
    </g>
  );
}

function Bicycle({ x, y, scale, colour, lean, flat = false }: { x: number; y: number; scale: number; colour: string; lean: number; flat?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${lean}) scale(${scale})`}>
      <Wheel cx={-13} r={9} flat={flat} />
      <Wheel cx={13} r={9} />
      <path d="M-13 -9L-3 -22H9L13 -9M-3 -22L1 -9H-13M1 -9L9 -22" fill="none" stroke={colour} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M9 -22l2 -6h5" fill="none" stroke="#222" strokeWidth="2" strokeLinecap="round" />
      <rect x="-8" y="-27" width="9" height="3" rx="1.5" fill="#222" />
    </g>
  );
}

function Motorbike({ x, y, scale, colour, lean }: { x: number; y: number; scale: number; colour: string; lean: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${lean}) scale(${scale})`}>
      <Wheel cx={-15} r={9} />
      <Wheel cx={15} r={9} />
      <path d="M-15 -9L-6 -20H8L15 -9" fill="none" stroke="#333" strokeWidth="2.4" />
      <path d="M-10 -24h16l4 6h-22z" fill={colour} />
      <rect x="-14" y="-28" width="14" height="4" rx="2" fill="#222" />
      <path d="M10 -20l3 -9h5" fill="none" stroke="#222" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function Car({ x, y, scale, colour, bonnetUp = false }: { x: number; y: number; scale: number; colour: string; bonnetUp?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-40 -10v-12q0 -4 4 -5l12 -3 10 -12h30l12 12 8 2q4 1 4 5v13z" fill={colour} />
      <path d="M-11 -40h24l10 11h-40z" fill="#CFE6F7" />
      {bonnetUp && <path d="M22 -30l18 -14 4 4 -16 12z" fill={colour} stroke="#00000033" />}
      <Wheel cx={-24} r={9} />
      <Wheel cx={24} r={9} />
    </g>
  );
}

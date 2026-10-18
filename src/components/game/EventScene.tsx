"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { HunterFigure } from "@/components/HunterFigure";
import type { AvatarLook } from "@/lib/avatar";
import type { VehicleKind } from "@/game/economy";

/** Where a scene takes place. */
export type SceneStage = "bicycle_shop" | "workshop" | "bike_hire" | "checkpoint" | "roadside" | "stall" | "petrol_station" | "buka" | "hospital";
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
  overlay = null,
  world = false,
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
  /** Drawn over the place, in its 320 × 180 picture (the pump's display, a plate of food). */
  overlay?: ReactNode;
  /**
   * In the world (owner, 18 Oct 2026): the place is drawn on the map itself (an open-roof building, the people
   * inside), so there's no picture here: what they say floats over their heads (`data-bubble`, placed by the map
   * every frame) and the replies sit in a strip at the bottom, leaving the scene in view.
   */
  world?: boolean;
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
  if (world) {
    const lastThem = lines.findLastIndex((l) => l.who === "them");
    const lastYou = lines.findLastIndex((l) => l.who === "you");
    const themText = lastThem >= 0 ? (lastThem === lines.length - 1 ? lines[lastThem].text.slice(0, shown) : lines[lastThem].text) : null;
    // What you said shows until they've answered and a moment more (the newest two lines).
    const youText = lastYou >= 0 && lastYou >= lines.length - 2 ? lines[lastYou].text : null;
    return (
      <div role="dialog" aria-label={title} className="pointer-events-none absolute inset-0 z-20">
        {themText !== null && (
          <div
            data-bubble="them"
            className="loota-bubble absolute left-0 top-0 w-max max-w-[min(78vw,340px)] -translate-x-1/2 -translate-y-full rounded-2xl bg-paper px-3 py-2 text-sm text-ink shadow-lg"
            style={{ visibility: "hidden" }}
            aria-live="polite"
          >
            <span className="mb-0.5 block text-[11px] font-bold text-[#B8322A]">{them.name}</span>
            {themText}
            {lastThem === lines.length - 1 && !done && <span className="loota-caret">▍</span>}
          </div>
        )}
        {youText && (
          <div
            data-bubble="you"
            className="loota-bubble absolute left-0 top-0 w-max max-w-[min(60vw,260px)] -translate-x-1/2 -translate-y-full rounded-2xl bg-gold px-3 py-2 text-sm font-semibold text-ink shadow-lg"
            style={{ visibility: "hidden" }}
          >
            {youText}
          </div>
        )}
        <div
          className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col gap-2 rounded-t-3xl bg-ink/90 p-3 backdrop-blur-sm sm:inset-x-auto sm:left-1/2 sm:w-[28rem] sm:-translate-x-1/2"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-display text-sm font-extrabold text-gold">{sign || title}</span>
            <button type="button" onClick={onClose} aria-label="Leave" className="flex h-8 items-center rounded-lg border border-line px-2.5 text-xs font-bold text-paper">
              Walk out
            </button>
          </div>
          {work && work.total > 0 && (
            <div className="flex items-center gap-2" aria-label="Repair under way">
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink-2">
                <div className="h-full rounded-full bg-gold transition-[width] duration-1000" style={{ width: `${Math.round((100 * (work.total - work.left)) / work.total)}%` }} />
              </div>
              <span className="text-xs text-muted">{work.left > 0 ? `Ready in ${Math.floor(work.left / 60)}:${String(work.left % 60).padStart(2, "0")}` : "Ready!"}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {done &&
              choices.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  disabled={busy}
                  onClick={c.onPick}
                  className={`min-h-11 flex-auto rounded-xl px-4 text-sm font-bold disabled:opacity-50 ${c.primary ? "bg-gold text-ink" : "border-[1.5px] border-line text-paper"}`}
                >
                  {c.label}
                </button>
              ))}
            {!done && <span className="flex h-11 items-center text-sm text-muted">…</span>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/70 sm:items-center">
      <div role="dialog" aria-label={title} className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-ink sm:max-w-lg sm:rounded-3xl">
        {/* The place */}
        {/* At most a third of the screen: on short screens the picture gives way to the replies. */}
        <div className="relative max-h-[34dvh] w-full shrink-0" style={{ aspectRatio: "16 / 9" }}>
          <Stage stage={stage} sign={sign} vehicle={vehicle ?? null} working={working} overlay={overlay} />
          {/* Sized by the picture's height, so they stay whole however wide or short it is. */}
          <div className={`absolute bottom-[6%] left-[8%] h-[56%] [&_svg]:h-full [&_svg]:w-auto ${working ? "loota-npc-work" : "loota-npc-idle"}`} aria-hidden="true">
            <HunterFigure look={them.look} wrap={them.wrap} width={200} />
          </div>
          <div className="absolute bottom-[6%] right-[8%] h-[56%] -scale-x-100 [&_svg]:h-full [&_svg]:w-auto" aria-hidden="true">
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
        <div ref={talk} className="flex min-h-14 flex-auto flex-col gap-2 overflow-y-auto p-4 [@media(max-height:520px)]:p-2" aria-live="polite">
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
        <div
          className="flex shrink-0 flex-col gap-2 border-t border-line p-4 [@media(max-height:520px)]:flex-row [@media(max-height:520px)]:flex-wrap [@media(max-height:520px)]:gap-1.5 [@media(max-height:520px)]:p-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {done &&
            choices.map((c) => (
              <button
                key={c.label}
                type="button"
                disabled={busy}
                onClick={c.onPick}
                className={`min-h-11 rounded-xl px-4 text-left text-sm font-bold disabled:opacity-50 [@media(max-height:520px)]:min-h-9 [@media(max-height:520px)]:flex-1 [@media(max-height:520px)]:text-xs ${
                  c.primary ? "bg-gold text-ink" : "border-[1.5px] border-line text-paper"
                }`}
              >
                {c.label}
              </button>
            ))}
          {!done && <span className="h-11 text-sm text-muted [@media(max-height:520px)]:h-9">…</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The places, drawn flat (viewBox 320 × 180).

type Vehicle = { kind: VehicleKind; fixed: boolean; sparkle?: boolean };

function Stage({ stage, sign, vehicle, working, overlay }: { stage: SceneStage; sign: string; vehicle: Vehicle | null; working: boolean; overlay: ReactNode }) {
  const shop = stage === "bicycle_shop";
  const place = stage === "petrol_station" ? <PetrolStation /> : stage === "buka" ? <Buka /> : stage === "hospital" ? <Hospital /> : null;
  const hire = stage === "bike_hire";
  const street = stage === "checkpoint" || stage === "roadside" || stage === "stall";
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
      ) : street ? (
        <Street stage={stage} />
      ) : place ? (
        place
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

      {/* The hand-painted sign (none by the roadside) */}
      {sign && (
        <>
          <line x1="100" y1="38" x2="100" y2={hire ? 62 : street ? 134 : 44} stroke="#4A3A2A" strokeWidth={street ? 3 : 2} />
          <line x1="220" y1="38" x2="220" y2={hire || street ? 134 : 44} stroke="#4A3A2A" strokeWidth={hire || street ? 3 : 2} />
          <rect
            x="64"
            y="12"
            width="192"
            height="26"
            rx="3"
            fill={
              hire || stage === "petrol_station"
                ? "#1E9E62"
                : stage === "checkpoint"
                  ? "#1E3A6E"
                  : stage === "stall" || stage === "buka"
                    ? "#F07A28"
                    : stage === "hospital"
                      ? "#D62828"
                      : shop
                        ? "#1E6FB8"
                        : "#B8322A"
            }
            stroke="#1B2433"
            strokeWidth="1.5"
          />
          <text x="160" y="29" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="800" fontFamily="system-ui, sans-serif" textLength={Math.min(180, sign.length * 7)} lengthAdjust="spacingAndGlyphs">
            {sign.toUpperCase()}
          </text>
        </>
      )}

      {hire || street || place ? null : shop ? <BicycleShopProps /> : <WorkshopProps />}

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
      {overlay}
    </svg>
  );
}

/**
 * A petrol station: the green canopy, the shop at the back, and the pump by the vehicle (its display is at
 * x 95–119, y 99–111, for the scene to show the meter; the nozzle hangs at about 130, 124).
 */
function PetrolStation() {
  return (
    <g>
      <rect y="146" width="320" height="34" fill="#B9B4AA" />
      <rect y="146" width="320" height="3" fill="#000" opacity="0.08" />
      <g stroke="#A29C90" strokeWidth="1">
        <path d="M0 162h320M60 146l-20 34M140 146l-6 34M220 146l8 34M300 146l22 34" />
      </g>
      {/* The shop at the back */}
      <rect x="188" y="74" width="124" height="72" fill="#F4F1EA" />
      <rect x="188" y="74" width="124" height="8" fill="#1E9E62" />
      <rect x="198" y="90" width="44" height="30" fill="#9FC6E8" />
      <rect x="252" y="92" width="22" height="54" fill="#6B8BA4" />
      <rect x="282" y="90" width="22" height="30" fill="#9FC6E8" />
      {/* The canopy on its columns */}
      <rect x="62" y="52" width="6" height="94" fill="#D8D8D8" />
      <rect x="252" y="52" width="6" height="40" fill="#D8D8D8" />
      <rect x="20" y="42" width="280" height="12" fill="#1E9E62" />
      <rect x="20" y="54" width="280" height="3" fill="#F4F1EA" />
      <rect x="20" y="57" width="280" height="2" fill="#F4B41A" />
      {/* The island and the pump */}
      <rect x="84" y="140" width="52" height="7" rx="2" fill="#8C8C8C" />
      <rect x="92" y="92" width="30" height="50" rx="3" fill="#F4F1EA" stroke="#1B2433" strokeWidth="1" />
      <rect x="92" y="92" width="30" height="5" rx="2" fill="#1E9E62" />
      <rect x="95" y="99" width="24" height="12" rx="1.5" fill="#10141A" />
      <rect x="97" y="116" width="8" height="5" rx="1" fill="#E5484D" />
      <rect x="107" y="116" width="8" height="5" rx="1" fill="#F4B41A" />
      <path d="M122 112 q8 0 8 10" stroke="#222" strokeWidth="2" fill="none" />
      <rect x="126" y="121" width="7" height="5" rx="1" fill="#222" />
      {/* An oil drum and a sand bucket */}
      <rect x="146" y="124" width="12" height="20" fill="#B8322A" />
      <ellipse cx="152" cy="124" rx="6" ry="2" fill="#00000044" />
      <path d="M170 132h12l-2 12h-8z" fill="#D62828" />
    </g>
  );
}

/** A buka (a roadside eatery): pots on the fire, a menu board, a table and a bench. The table top is at y 128. */
function Buka() {
  return (
    <g>
      <rect y="146" width="320" height="34" fill="#C9A27A" />
      <rect y="146" width="320" height="3" fill="#000" opacity="0.08" />
      <rect x="10" y="58" width="300" height="90" fill="#E9C79A" />
      <rect x="10" y="58" width="300" height="8" fill="#000" opacity="0.08" />
      <rect x="10" y="118" width="300" height="30" fill="#D9A877" />
      <polygon points="0,60 320,60 308,40 12,40" fill="#9C6B3F" />
      <g stroke="#7E5230" strokeWidth="1.2">
        {Array.from({ length: 30 }, (_, i) => (
          <line key={i} x1={14 + i * 10} y1="41" x2={11 + i * 10.2} y2="59" />
        ))}
      </g>
      <rect x="14" y="58" width="5" height="90" fill="#7A5230" />
      <rect x="301" y="58" width="5" height="90" fill="#7A5230" />
      {/* The menu board (the scene writes the day's dishes on it: x 166–222, y 70–102) */}
      <rect x="160" y="64" width="68" height="44" rx="2" fill="#2B3A2F" stroke="#7A5230" strokeWidth="3" />
      {/* Pots on the fire, steaming */}
      <g>
        <path d="M96 146l6 -8 6 8M112 146l6 -8 6 8" stroke="#6B4A2B" strokeWidth="3" fill="none" />
        <path d="M102 140q4 -6 8 0q4 -6 8 0" fill="#F07A28" opacity="0.8" />
        <path d="M92 116h40l-4 22h-32z" fill="#3A3A3A" />
        <rect x="90" y="113" width="44" height="4" rx="2" fill="#555" />
        <path className="loota-steam" d="M104 108q-4 -6 0 -12q4 -6 0 -12M120 108q-4 -6 0 -12q4 -6 0 -12" stroke="#FFFFFF" strokeWidth="2" fill="none" opacity="0.7" strokeLinecap="round" />
      </g>
      <g>
        <path d="M60 118h26l-3 18h-20z" fill="#7A2232" />
        <rect x="58" y="115" width="30" height="4" rx="2" fill="#5A1A26" />
      </g>
      {/* The table and the bench */}
      <rect x="138" y="128" width="88" height="6" rx="1" fill="#7A5230" />
      <rect x="144" y="134" width="4" height="13" fill="#7A5230" />
      <rect x="216" y="134" width="4" height="13" fill="#7A5230" />
      <rect x="150" y="140" width="64" height="4" fill="#9C6B3F" />
      {/* A crate of soft drinks */}
      <rect x="236" y="128" width="26" height="18" fill="#F4B41A" />
      <g fill="#1E9E62">
        {[240, 246, 252, 258].map((x) => (
          <rect key={x} x={x - 1.5} y="120" width="3" height="9" rx="1" />
        ))}
      </g>
    </g>
  );
}

/** The front of a hospital: white walls, windows, the glass doors and a red cross. */
function Hospital() {
  return (
    <g>
      <rect y="146" width="320" height="34" fill="#C9C2B4" />
      <rect y="146" width="320" height="3" fill="#000" opacity="0.1" />
      <rect x="6" y="46" width="308" height="100" fill="#F4F6F8" />
      <rect x="6" y="46" width="308" height="5" fill="#D9DEE4" />
      <g fill="#9FC6E8">
        {[22, 54, 86, 214, 246, 278].map((x) => (
          <g key={x}>
            <rect x={x} y="60" width="20" height="16" />
            <rect x={x} y="88" width="20" height="16" />
          </g>
        ))}
      </g>
      {/* The doors under a canopy */}
      <rect x="126" y="92" width="68" height="6" fill="#D62828" />
      <rect x="134" y="98" width="52" height="48" fill="#BFDDF2" stroke="#8FA7B8" strokeWidth="1.5" />
      <line x1="160" y1="98" x2="160" y2="146" stroke="#8FA7B8" strokeWidth="1.5" />
      {/* The red cross */}
      <rect x="148" y="58" width="24" height="24" rx="3" fill="#FFFFFF" stroke="#D62828" strokeWidth="1.5" />
      <path d="M157 62h6v6h6v6h-6v6h-6v-6h-6v-6h6z" fill="#D62828" />
      {/* Plants by the door */}
      {[118, 202].map((x) => (
        <g key={x}>
          <rect x={x - 6} y="134" width="12" height="12" fill="#A0522D" />
          <circle cx={x} cy="128" r="8" fill="#2E7D4F" />
        </g>
      ))}
    </g>
  );
}

/** By the road, for what happens on the way: a police checkpoint, a stranded traveller, a street seller's stall. */
function Street({ stage }: { stage: "checkpoint" | "roadside" | "stall" }) {
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
      {stage === "checkpoint" && (
        <>
          {/* A barrier across the road, cones, the patrol van with its lights */}
          <rect x="22" y="128" width="5" height="30" fill="#5B6475" />
          <rect x="24" y="130" width="128" height="8" fill="#FFFFFF" stroke="#1B2433" strokeWidth="0.8" />
          {Array.from({ length: 7 }, (_, i) => (
            <rect key={i} x={26 + i * 18} y="130" width="9" height="8" fill="#D62828" />
          ))}
          {[172, 192, 212].map((x) => (
            <g key={x}>
              <path d={`M${x - 6} 158 L${x} 140 L${x + 6} 158 Z`} fill="#F07A28" />
              <rect x={x - 3.5} y="148" width="7" height="3" fill="#FFFFFF" />
            </g>
          ))}
          <g transform="translate(236 104)">
            <rect x="0" y="12" width="78" height="30" rx="4" fill="#F4F1EA" stroke="#1B2433" strokeWidth="1" />
            <rect x="0" y="27" width="78" height="5" fill="#1E3A6E" />
            <rect x="8" y="16" width="20" height="9" fill="#9FC6E8" />
            <rect x="32" y="16" width="20" height="9" fill="#9FC6E8" />
            <rect x="30" y="6" width="9" height="6" fill="#D62828" className="loota-sparkle" />
            <rect x="40" y="6" width="9" height="6" fill="#2F6FEB" />
            <circle cx="16" cy="43" r="6" fill="#222" />
            <circle cx="62" cy="43" r="6" fill="#222" />
          </g>
        </>
      )}
      {stage === "roadside" && (
        <>
          {/* A shady tree, a street lamp, the traveller's bag */}
          <rect x="54" y="92" width="9" height="42" fill="#6B4A2B" />
          <circle cx="58" cy="82" r="26" fill="#2E7D4F" />
          <circle cx="38" cy="94" r="17" fill="#2E7D4F" />
          <circle cx="80" cy="94" r="17" fill="#2E7D4F" />
          <rect x="262" y="70" width="4" height="64" fill="#5B6475" />
          <path d="M264 70 q0 -8 12 -8" stroke="#5B6475" strokeWidth="3" fill="none" />
          <ellipse cx="277" cy="64" rx="6" ry="3" fill="#FFD45C" />
          <rect x="118" y="122" width="16" height="12" rx="2" fill="#7A4B22" />
          <rect x="122" y="118" width="8" height="5" rx="2" fill="none" stroke="#7A4B22" strokeWidth="1.5" />
        </>
      )}
      {stage === "stall" && (
        <>
          {/* A striped umbrella over a table of oranges and snacks, a cooler */}
          <rect x="88" y="66" width="3" height="66" fill="#5B6475" />
          <path d="M40 72 Q89 30 138 72 Z" fill="#E5484D" />
          <path d="M64 72 Q89 30 89 72 Z M89 72 Q89 30 114 72 Z" fill="#F4F1EA" />
          <rect x="44" y="110" width="92" height="7" fill="#7A5230" />
          <rect x="48" y="117" width="4" height="17" fill="#7A5230" />
          <rect x="128" y="117" width="4" height="17" fill="#7A5230" />
          {[
            [60, 106], [68, 106], [76, 106], [64, 99], [72, 99], [68, 92],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill="#F28C28" />
          ))}
          <rect x="96" y="98" width="14" height="12" rx="2" fill="#F4B41A" />
          <rect x="114" y="100" width="14" height="10" rx="2" fill="#C89B5A" />
          <rect x="146" y="118" width="22" height="16" rx="3" fill="#2F6FEB" />
          <rect x="146" y="118" width="22" height="4" rx="2" fill="#F4F1EA" />
        </>
      )}
    </g>
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

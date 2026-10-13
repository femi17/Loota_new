"use client";

import { HunterFigure } from "@/components/HunterFigure";
import {
  BOTTOMS_COLOURS,
  EXTRAS,
  HAIR_COLOURS,
  HAIR_STYLES,
  SKIN_TONES,
  TOP_COLOURS,
  TOP_STYLES,
  randomLook,
  type AvatarLook,
} from "@/lib/avatar";

type Swatch = { color: string; label: string };
type Choice = { id: string; label: string };

/** Avatar customiser with a live preview. Controlled: the parent owns `look`. */
export function LookEditor({ look, onChange }: { look: AvatarLook; onChange: (look: AvatarLook) => void }) {
  const set = <K extends keyof AvatarLook>(key: K, value: AvatarLook[K]) => onChange({ ...look, [key]: value });

  return (
    <div className="flex flex-col gap-5">
      <div className="relative flex h-48 items-end justify-center overflow-hidden rounded-2xl bg-map">
        <div aria-hidden="true" className="absolute left-[-20px] top-28 h-5 w-[120%] -rotate-6 bg-white" />
        <div aria-hidden="true" className="absolute bottom-4 h-4 w-28 rounded-[50%] bg-[#cfc6b4]" />
        <div className="relative mb-5">
          <HunterFigure look={look} width={92} label="Your hunter preview" />
        </div>
        <button
          type="button"
          onClick={() => onChange(randomLook())}
          className="absolute right-3 top-3 flex h-11 items-center gap-2 rounded-xl bg-ink px-3 text-sm font-bold text-paper hover:bg-ink-2"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8" cy="8" r="1.2" fill="#F4B41A" />
            <circle cx="16" cy="16" r="1.2" fill="#F4B41A" />
            <circle cx="12" cy="12" r="1.2" fill="#F4B41A" />
          </svg>
          Surprise me
        </button>
      </div>

      <Swatches legend="Skin tone" options={SKIN_TONES} value={look.skin} round onPick={(c) => set("skin", c)} />
      <Chips legend="Hair" options={HAIR_STYLES} value={look.hair} onPick={(id) => set("hair", id as AvatarLook["hair"])} />
      {look.hair !== "bald" && (
        <Swatches legend="Hair colour" options={HAIR_COLOURS} value={look.hairColour} round onPick={(c) => set("hairColour", c)} />
      )}
      <Chips legend="Top" options={TOP_STYLES} value={look.top} onPick={(id) => set("top", id as AvatarLook["top"])} />
      <Swatches legend="Top colour" options={TOP_COLOURS} value={look.topColour} onPick={(c) => set("topColour", c)} />
      <Swatches legend="Trousers" options={BOTTOMS_COLOURS} value={look.bottomsColour} onPick={(c) => set("bottomsColour", c)} />
      <Chips legend="Extra" options={EXTRAS} value={look.extra} onPick={(id) => set("extra", id as AvatarLook["extra"])} />
    </div>
  );
}

function Swatches({
  legend,
  options,
  value,
  round,
  onPick,
}: {
  legend: string;
  options: readonly Swatch[];
  value: string;
  round?: boolean;
  onPick: (color: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2.5">
        {options.map((o) => (
          <button
            key={o.color}
            type="button"
            aria-label={`${legend}: ${o.label}`}
            aria-pressed={value === o.color}
            onClick={() => onPick(o.color)}
            className={`size-11 border-[3px] ${round ? "rounded-full" : "rounded-xl"} ${value === o.color ? "border-gold" : "border-line"}`}
            style={{ background: o.color }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Chips({
  legend,
  options,
  value,
  onPick,
}: {
  legend: string;
  options: readonly Choice[];
  value: string;
  onPick: (id: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onPick(o.id)}
            className={`h-11 rounded-xl border-2 px-4 text-sm font-bold ${
              value === o.id ? "border-gold bg-gold text-ink" : "border-line bg-ink-2 text-paper hover:border-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

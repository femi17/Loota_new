/**
 * A hunter's look. Every part is picked from a fixed palette so the 2D figure
 * and the three.js avatar can both draw it. 8 × 5 × 6 × 3 × 12 × 8 × 4 =
 * 276,480 combinations; on the map, the unique hunter name tag tells
 * look-alikes apart.
 */
export type AvatarLook = {
  skin: string;
  hair: HairStyle;
  hairColour: string;
  top: TopStyle;
  topColour: string;
  bottomsColour: string;
  extra: Extra;
};

export type HairStyle = "short" | "afro" | "braids" | "bun" | "bald";
export type TopStyle = "tee" | "hoodie" | "jersey";
export type Extra = "none" | "cap" | "glasses" | "headphones";

type Swatch = { color: string; label: string };
type Choice<T extends string> = { id: T; label: string };

export const SKIN_TONES: readonly Swatch[] = [
  { color: "#FCD9B8", label: "Very light" },
  { color: "#F1C27D", label: "Light" },
  { color: "#E0AC69", label: "Light medium" },
  { color: "#C68642", label: "Medium" },
  { color: "#A86B3C", label: "Medium deep" },
  { color: "#8D5524", label: "Deep" },
  { color: "#6B3E1F", label: "Very deep" },
  { color: "#4A2A14", label: "Darkest" },
];

export const HAIR_STYLES: readonly Choice<HairStyle>[] = [
  { id: "short", label: "Short" },
  { id: "afro", label: "Afro" },
  { id: "braids", label: "Braids" },
  { id: "bun", label: "Bun" },
  { id: "bald", label: "Bald" },
];

export const HAIR_COLOURS: readonly Swatch[] = [
  { color: "#1B120C", label: "Black" },
  { color: "#3B2416", label: "Dark brown" },
  { color: "#6A4024", label: "Brown" },
  { color: "#D9B26F", label: "Blonde" },
  { color: "#A34A28", label: "Red" },
  { color: "#9A9A9A", label: "Grey" },
];

export const TOP_STYLES: readonly Choice<TopStyle>[] = [
  { id: "tee", label: "T-shirt" },
  { id: "hoodie", label: "Hoodie" },
  { id: "jersey", label: "Jersey" },
];

export const TOP_COLOURS: readonly Swatch[] = [
  { color: "#2F6FEB", label: "Blue" },
  { color: "#E5484D", label: "Red" },
  { color: "#1E9E62", label: "Green" },
  { color: "#F4B41A", label: "Gold" },
  { color: "#7C4DCC", label: "Purple" },
  { color: "#F4F1EA", label: "White" },
  { color: "#222831", label: "Black" },
  { color: "#F07A28", label: "Orange" },
  { color: "#E85D9E", label: "Pink" },
  { color: "#13A3A3", label: "Teal" },
  { color: "#1E3A6E", label: "Navy" },
  { color: "#7A2232", label: "Maroon" },
];

export const BOTTOMS_COLOURS: readonly Swatch[] = [
  { color: "#333A4A", label: "Charcoal" },
  { color: "#3B5B8C", label: "Denim" },
  { color: "#1A1A1A", label: "Black" },
  { color: "#B59B6A", label: "Khaki" },
  { color: "#5B6B3A", label: "Olive" },
  { color: "#E8E4DA", label: "Cream" },
  { color: "#6B4A2F", label: "Brown" },
  { color: "#8C2F2F", label: "Red" },
];

export const EXTRAS: readonly Choice<Extra>[] = [
  { id: "none", label: "None" },
  { id: "cap", label: "Cap" },
  { id: "glasses", label: "Glasses" },
  { id: "headphones", label: "Headphones" },
];

export const DEFAULT_LOOK: AvatarLook = {
  skin: "#8D5524",
  hair: "short",
  hairColour: "#1B120C",
  top: "tee",
  topColour: "#2F6FEB",
  bottomsColour: "#333A4A",
  extra: "none",
};

const hasColour = (list: readonly Swatch[], v: unknown) => list.some((s) => s.color === v);
const hasId = <T extends string>(list: readonly Choice<T>[], v: unknown): v is T => list.some((c) => c.id === v);

/** Accept only looks built from the palettes above. */
export function isValidLook(look: unknown): look is AvatarLook {
  if (!look || typeof look !== "object") return false;
  const l = look as Record<string, unknown>;
  return (
    hasColour(SKIN_TONES, l.skin) &&
    hasId(HAIR_STYLES, l.hair) &&
    hasColour(HAIR_COLOURS, l.hairColour) &&
    hasId(TOP_STYLES, l.top) &&
    hasColour(TOP_COLOURS, l.topColour) &&
    hasColour(BOTTOMS_COLOURS, l.bottomsColour) &&
    hasId(EXTRAS, l.extra)
  );
}

/** Read a stored look, filling gaps (older profiles stored only skin + shirt). */
export function normalizeLook(raw: unknown): AvatarLook {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const look: AvatarLook = {
    skin: hasColour(SKIN_TONES, r.skin) ? (r.skin as string) : DEFAULT_LOOK.skin,
    hair: hasId(HAIR_STYLES, r.hair) ? r.hair : DEFAULT_LOOK.hair,
    hairColour: hasColour(HAIR_COLOURS, r.hairColour) ? (r.hairColour as string) : DEFAULT_LOOK.hairColour,
    top: hasId(TOP_STYLES, r.top) ? r.top : DEFAULT_LOOK.top,
    topColour: hasColour(TOP_COLOURS, r.topColour)
      ? (r.topColour as string)
      : hasColour(TOP_COLOURS, r.shirt)
        ? (r.shirt as string)
        : DEFAULT_LOOK.topColour,
    bottomsColour: hasColour(BOTTOMS_COLOURS, r.bottomsColour) ? (r.bottomsColour as string) : DEFAULT_LOOK.bottomsColour,
    extra: hasId(EXTRAS, r.extra) ? r.extra : DEFAULT_LOOK.extra,
  };
  return look;
}

/** Pick a look from a sequence of numbers in [0, 1). */
function lookFrom(next: () => number): AvatarLook {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  return {
    skin: pick(SKIN_TONES).color,
    hair: pick(HAIR_STYLES).id,
    hairColour: pick(HAIR_COLOURS).color,
    top: pick(TOP_STYLES).id,
    topColour: pick(TOP_COLOURS).color,
    bottomsColour: pick(BOTTOMS_COLOURS).color,
    // Extras are less common so starting looks stay simple.
    extra: next() < 0.6 ? "none" : pick(EXTRAS.slice(1)).id,
  };
}

/** A random look, for the "Surprise me" button. */
export function randomLook(): AvatarLook {
  return lookFrom(Math.random);
}

/** A stable starting look derived from a player's id, so new hunters don't all start identical. */
export function lookForId(id: string): AvatarLook {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (Math.imul(seed, 31) + id.charCodeAt(i)) | 0;
  return lookFrom(() => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  });
}

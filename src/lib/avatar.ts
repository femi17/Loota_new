export type AvatarLook = { skin: string; shirt: string };

export const SKIN_TONES = [
  { color: "#F1C27D", label: "Light" },
  { color: "#E0AC69", label: "Light medium" },
  { color: "#C68642", label: "Medium" },
  { color: "#8D5524", label: "Medium dark" },
  { color: "#5C3A1E", label: "Dark" },
] as const;

export const OUTFIT_COLOURS = [
  { color: "#2F6FEB", label: "Blue" },
  { color: "#E5484D", label: "Red" },
  { color: "#1E9E62", label: "Green" },
  { color: "#F4B41A", label: "Gold" },
  { color: "#7C4DCC", label: "Purple" },
  { color: "#F4F1EA", label: "White" },
] as const;

export const DEFAULT_LOOK: AvatarLook = { skin: "#8D5524", shirt: "#2F6FEB" };

/** Accept only colours from the palettes above. */
export function isValidLook(look: unknown): look is AvatarLook {
  if (!look || typeof look !== "object") return false;
  const { skin, shirt } = look as Record<string, unknown>;
  return (
    SKIN_TONES.some((s) => s.color === skin) &&
    OUTFIT_COLOURS.some((o) => o.color === shirt)
  );
}

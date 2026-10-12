import type { AvatarLook } from "@/lib/avatar";

/** Flat 2D version of the blocky hunter, for menus and cards (the map uses three.js). */
export function HunterFigure({
  look,
  width = 40,
  label,
}: {
  look: AvatarLook;
  width?: number;
  label?: string;
}) {
  return (
    <svg
      width={width}
      height={(width * 64) / 40}
      viewBox="0 0 40 64"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="20" cy="12" r="10" fill={look.skin} />
      <path d="M10 11a10 10 0 0 1 20 0z" fill="#1B120C" />
      <circle cx="16.3" cy="13" r="1.1" fill="#111" />
      <circle cx="23.7" cy="13" r="1.1" fill="#111" />
      <rect x="12" y="23" width="16" height="20" rx="3" fill={look.shirt} />
      <rect x="7" y="24" width="4.5" height="16" rx="2" fill={look.skin} />
      <rect x="28.5" y="24" width="4.5" height="16" rx="2" fill={look.skin} />
      <rect x="13" y="43" width="6" height="17" rx="2" fill="#333A4A" />
      <rect x="21" y="43" width="6" height="17" rx="2" fill="#333A4A" />
    </svg>
  );
}

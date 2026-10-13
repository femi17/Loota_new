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
  const { skin, hair, hairColour, top, topColour, bottomsColour, extra } = look;
  const sleeves = top === "hoodie";

  return (
    <svg
      width={width}
      height={(width * 66) / 40}
      viewBox="0 -2 40 66"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {/* Hair behind the head */}
      {hair === "afro" && <circle cx="20" cy="10" r="12.5" fill={hairColour} />}
      {hair === "braids" && (
        <>
          <rect x="8.5" y="9" width="3.2" height="18" rx="1.6" fill={hairColour} />
          <rect x="28.3" y="9" width="3.2" height="18" rx="1.6" fill={hairColour} />
        </>
      )}
      {hair === "bun" && <circle cx="20" cy="1.5" r="4.2" fill={hairColour} />}
      {top === "hoodie" && <rect x="13" y="19" width="14" height="6" rx="3" fill={topColour} />}

      {/* Head */}
      <circle cx="20" cy="12" r="10" fill={skin} />
      {hair !== "bald" && <path d="M10 11a10 10 0 0 1 20 0z" fill={hairColour} />}
      <circle cx="16.3" cy="13" r="1.1" fill="#111" />
      <circle cx="23.7" cy="13" r="1.1" fill="#111" />

      {/* Extras */}
      {extra === "cap" && (
        <>
          <path d="M9.6 10.5a10.4 10.4 0 0 1 20.8 0z" fill="#222831" />
          <rect x="19" y="8.6" width="13" height="2.6" rx="1.3" fill="#222831" />
        </>
      )}
      {extra === "glasses" && (
        <g fill="none" stroke="#111" strokeWidth="0.9">
          <rect x="13.6" y="11" width="5.2" height="4" rx="1.2" />
          <rect x="21.2" y="11" width="5.2" height="4" rx="1.2" />
          <path d="M18.8 12.6h2.4" />
        </g>
      )}
      {extra === "headphones" && (
        <>
          <path d="M9 13a11 11 0 0 1 22 0" fill="none" stroke="#222831" strokeWidth="1.8" />
          <rect x="7.2" y="11" width="3.6" height="6" rx="1.6" fill="#222831" />
          <rect x="29.2" y="11" width="3.6" height="6" rx="1.6" fill="#222831" />
        </>
      )}

      {/* Arms: skin with short sleeves, or full hoodie sleeves */}
      <rect x="7" y="24" width="4.5" height="16" rx="2" fill={sleeves ? topColour : skin} />
      <rect x="28.5" y="24" width="4.5" height="16" rx="2" fill={sleeves ? topColour : skin} />
      {sleeves ? (
        <>
          <circle cx="9.25" cy="40.5" r="2" fill={skin} />
          <circle cx="30.75" cy="40.5" r="2" fill={skin} />
        </>
      ) : (
        <>
          <rect x="7" y="24" width="4.5" height="5" rx="2" fill={topColour} />
          <rect x="28.5" y="24" width="4.5" height="5" rx="2" fill={topColour} />
        </>
      )}

      {/* Body */}
      <rect x="12" y="23" width="16" height="20" rx="3" fill={topColour} />
      {top === "jersey" && (
        <>
          <path d="M17 23l3 4 3-4" fill="none" stroke="#F4F1EA" strokeWidth="1.2" />
          <rect x="14.5" y="23" width="1.6" height="20" fill="#F4F1EA" opacity="0.55" />
          <rect x="23.9" y="23" width="1.6" height="20" fill="#F4F1EA" opacity="0.55" />
        </>
      )}
      {top === "hoodie" && <path d="M15 37h10" stroke="#000" strokeOpacity="0.25" strokeWidth="1" />}

      {/* Legs and shoes */}
      <rect x="13" y="43" width="6" height="16" rx="2" fill={bottomsColour} />
      <rect x="21" y="43" width="6" height="16" rx="2" fill={bottomsColour} />
      <rect x="12.5" y="58" width="7" height="3" rx="1.2" fill="#222" />
      <rect x="20.5" y="58" width="7" height="3" rx="1.2" fill="#222" />
    </svg>
  );
}

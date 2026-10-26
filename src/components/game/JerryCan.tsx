/**
 * A jerry can showing how much fuel is in it (owner, 26 Oct 2026: "show a jerry can with the fuel as percentage, that
 * is showing the fill of the fuel in the jerry can"): a red can with a window whose amber fuel rises with \`level\` (0–1).
 * \`tilt\` tips it (degrees), for pouring.
 */
export function JerryCan({ size = 20, level, tilt = 0, className = "" }: { size?: number; level: number; tilt?: number; className?: string }) {
  const l = Math.max(0, Math.min(1, level));
  const top = 9 + 22 * (1 - l); // the fuel's surface inside the window (y from 9 to 31)
  return (
    <svg width={size} height={(size * 36) / 28} viewBox="0 0 28 36" className={className} style={{ transform: `rotate(${tilt}deg)` }} aria-hidden="true">
      {/* Spout and handle */}
      <path d="M19 2 L25 6 L23 8 L18 5 Z" fill="#2B2F36" />
      <rect x="5" y="1" width="10" height="5" rx="2" fill="none" stroke="#B3261E" strokeWidth="2.4" />
      {/* Body */}
      <rect x="2" y="5" width="24" height="30" rx="3" fill="#D93B3B" stroke="#8E1B16" strokeWidth="1.5" />
      <path d="M6 10 L22 30 M22 10 L6 30" stroke="#B3261E" strokeWidth="1.6" />
      {/* The window, and the fuel in it */}
      <rect x="10" y="9" width="8" height="22" rx="2" fill="#2A1A10" />
      <clipPath id="loota-can-window">
        <rect x="10" y="9" width="8" height="22" rx="2" />
      </clipPath>
      <rect x="10" y={top} width="8" height={31 - top} fill="#F4B41A" clipPath="url(#loota-can-window)" />
    </svg>
  );
}

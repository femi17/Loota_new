import Image from "next/image";
import Link from "next/link";

export function KeyIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="7.5" cy="12" r="4.5" />
      <path d="M12 12h10M18 12v4M21 12v3" />
    </svg>
  );
}

/** The logo's own proportions (public/brand, made by scripts/build-logo.mjs from the owner's artwork). */
const LOGO_RATIO = 265 / 240;
const TONES = { light: "/brand/loota-light.png", dark: "/brand/loota-dark.png", gold: "/brand/loota-gold.png" } as const;

/**
 * The Loota logo (owner, 19 Oct 2026): the script "Loota". Cream on the dark screens, brown on the parchment cards,
 * gold for the big moments.
 */
export function LootaLogo({ height = 40, tone = "light", className = "", priority = false }: { height?: number; tone?: keyof typeof TONES; className?: string; priority?: boolean }) {
  return (
    <Image
      src={TONES[tone]}
      alt="Loota"
      width={Math.round(height * LOGO_RATIO)}
      height={height}
      priority={priority}
      className={`select-none ${className}`}
      draggable={false}
    />
  );
}

export function Logo({ height = 52 }: { height?: number }) {
  return (
    <Link href="/" className="inline-flex items-center no-underline" aria-label="Loota home">
      <LootaLogo height={height} priority />
    </Link>
  );
}

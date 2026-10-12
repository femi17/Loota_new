import Link from "next/link";

export function KeyIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="7.5" cy="12" r="4.5" />
      <path d="M12 12h10M18 12v4M21 12v3" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 text-paper no-underline">
      <span className="text-gold"><KeyIcon /></span>
      <span className="font-display text-xl font-extrabold tracking-wider">LOOTA</span>
    </Link>
  );
}

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { playFullscreen } from "@/lib/fullscreen";

/**
 * The lobby's ways onto the map, which on a phone also go full screen and sideways (owner, 8 Nov 2026: "when a user
 * clicks on free roam or joins a hunt… landscape mode in fullscreen"): the tap itself asks, as browsers require.
 */
export function PlayLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <Link href={href} className={className} onClick={() => void playFullscreen()}>
      {children}
    </Link>
  );
}

/** The Join button (in the lobby's join form). */
export function JoinButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <button type="submit" className={className} onClick={() => void playFullscreen()}>
      {children}
    </button>
  );
}

"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { leaveFullscreen, playFullscreen } from "@/lib/fullscreen";

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

/** Back in the lobby: out of full screen and no longer held sideways (owner, 8 Nov 2026: "how do I go out of fullscreen
 * mode, I went to the lobby, and it was still on landscape"). */
export function LeaveFullscreen() {
  useEffect(() => {
    void leaveFullscreen();
  }, []);
  return null;
}

/** The Join button (in the lobby's join form). */
export function JoinButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <button type="submit" className={className} onClick={() => void playFullscreen()}>
      {children}
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * A newer version of the game is live (owner, 13 Nov 2026: a card match played on a page opened before an update never
 * sent its moves to the broadcast): an open game keeps the code it was opened with, so it asks now and then and offers
 * a reload. Never reloads by itself (it could be mid-game or mid-trip); the player taps when it suits them.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
    if (mine === "dev") return;
    const ask = () =>
      void fetch("/api/version", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ build?: string }>) : null))
        .then((v) => {
          if (v?.build && v.build !== "dev" && v.build !== mine) setReady(true);
        })
        .catch(() => undefined);
    const t = window.setInterval(ask, 120_000);
    const onShow = () => document.visibilityState === "visible" && ask(); // back on the tab: ask straight away
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  if (!ready) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[70] flex justify-center px-4">
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-extrabold text-ink shadow-lg ring-2 ring-ink/20 active:scale-95"
        data-update-ready
      >
        🔄 A new version of Loota is ready · Reload
      </button>
    </div>
  );
}

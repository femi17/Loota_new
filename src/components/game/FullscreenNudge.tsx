"use client";

import { useEffect, useState } from "react";
import { canFullscreen, isFullscreen, isTouchPhone, playFullscreen } from "@/lib/fullscreen";

const ASKED_KEY = "loota:fullscreen-asked"; // this visit (sessionStorage)
const TURN_KEY = "loota:turn-asked"; // the day the iPhone hint was last shown (localStorage)

/**
 * On a phone that came onto the map without full screen (a reload, a link, or Android's back gesture closed it): one
 * offer to play full screen and sideways (owner, 8 Nov 2026: "more room to see the screen and move"). An iPhone can't
 * go full screen from a web page: there, once a day, a hint to turn the phone sideways while it's held upright.
 */
export function FullscreenNudge() {
  const [offer, setOffer] = useState<"fullscreen" | "turn" | null>(null);

  useEffect(() => {
    if (!isTouchPhone()) return;
    const decide = () => {
      if (canFullscreen()) {
        let asked = false;
        try {
          asked = sessionStorage.getItem(ASKED_KEY) === "1";
        } catch {}
        setOffer(!isFullscreen() && !asked ? "fullscreen" : null);
        return;
      }
      const upright = window.matchMedia("(orientation: portrait)").matches;
      let today = false;
      try {
        today = localStorage.getItem(TURN_KEY) === new Date().toDateString();
      } catch {}
      setOffer(upright && !today ? "turn" : null);
    };
    const t = window.setTimeout(decide, 1500); // after the map has appeared
    const portrait = window.matchMedia("(orientation: portrait)");
    const onTurn = () => setOffer((o) => (o === "turn" && !portrait.matches ? null : o));
    portrait.addEventListener("change", onTurn);
    document.addEventListener("fullscreenchange", decide);
    return () => {
      window.clearTimeout(t);
      portrait.removeEventListener("change", onTurn);
      document.removeEventListener("fullscreenchange", decide);
    };
  }, []);

  const dismiss = () => {
    try {
      if (offer === "fullscreen") sessionStorage.setItem(ASKED_KEY, "1");
      else localStorage.setItem(TURN_KEY, new Date().toDateString());
    } catch {}
    setOffer(null);
  };

  // Shown for a while only: it sits over the top of the screen (the hunt card, a riddle's clock).
  useEffect(() => {
    if (!offer) return;
    const t = window.setTimeout(() => {
      try {
        if (offer === "fullscreen") sessionStorage.setItem(ASKED_KEY, "1");
        else localStorage.setItem(TURN_KEY, new Date().toDateString());
      } catch {}
      setOffer(null);
    }, 10_000);
    return () => window.clearTimeout(t);
  }, [offer]);

  if (!offer) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4" style={{ marginTop: "env(safe-area-inset-top)" }}>
      <div role="dialog" aria-label={offer === "fullscreen" ? "Play full screen" : "Turn your phone"} data-fullscreen-offer={offer} className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink p-3 pl-4 text-paper shadow-xl ring-[1.5px] ring-gold">
        <span className="text-2xl" aria-hidden="true">
          {offer === "fullscreen" ? "⛶" : "📱"}
        </span>
        <p className="min-w-0 flex-1 text-sm leading-snug">
          {offer === "fullscreen" ? (
            <>
              <b>Play full screen</b>, sideways: more room.
            </>
          ) : (
            <>
              <b>Turn your phone sideways</b> for more room.
            </>
          )}
        </p>
        {offer === "fullscreen" && (
          <button
            type="button"
            onClick={() => {
              void playFullscreen().then(() => setOffer(null));
              try {
                sessionStorage.setItem(ASKED_KEY, "1");
              } catch {}
            }}
            className="h-10 shrink-0 rounded-xl bg-gold px-3 text-sm font-extrabold text-ink"
          >
            Full screen
          </button>
        )}
        <button type="button" onClick={dismiss} aria-label={offer === "fullscreen" ? "Not now" : "OK"} className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted hover:text-paper">
          ✕
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RELICS, RELIC_ICON, type RelicId } from "@/game/items";

const TOAST_MS = 4500;
/** How often every map asks for the world's news (owner, 26 Oct 2026: "when a user picks a tool, all users should see an announcement"). */
const NEWS_MS = 12_000;

/** Shows a line of news for a few seconds (the hunt's, and the world's). */
export function toast(text: string) {
  window.dispatchEvent(new CustomEvent<string>("loota:toast", { detail: text }));
}

type News = { at: string; kind: "relic" | "lamp"; prize: string; qty: number; place: string | null; who: string; mine: boolean };

/** One piece of world news, as everyone reads it. */
export function newsLine(n: Pick<News, "kind" | "prize" | "qty" | "place" | "who">) {
  const relic = n.prize in RELICS ? (n.prize as RelicId) : null;
  const what = relic
    ? `${RELIC_ICON[relic]} a ${RELICS[relic].name}`
    : n.prize === "cruise"
      ? `🚗 ${n.qty} cruise token${n.qty === 1 ? "" : "s"}`
      : n.prize === "tyre_kit"
        ? "🛞 a tyre kit"
        : n.prize;
  return n.kind === "lamp" ? `🪔 ${n.who} won ${what} from the lamp${n.place ? ` near ${n.place}` : ""}!` : `${n.who} picked up ${what}!`;
}

/**
 * The news strip over the map: the hunt's news (rivals, keys) and the world's (a relic picked up, a lamp prize won),
 * three at most (on a phone just the newest, in two lines at most; owner, 28 Oct 2026: "we cannot keep too many toast
 * on the screen on mobile"), a few seconds each. `hidden` while a scene fills the screen.
 */
export function NewsToasts({ hidden }: { hidden: boolean }) {
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);

  useEffect(() => {
    const show = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, text }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
    };
    window.addEventListener("loota:toast", show);
    return () => window.removeEventListener("loota:toast", show);
  }, []);

  // The world's news: what others picked up or won since the last look (the first look only sets the clock).
  useEffect(() => {
    let stopped = false;
    let since: string | null = null;
    const db = createClient();
    async function poll() {
      const { data } = await db.rpc("world_news", { p_since: since });
      const r = data as { now: string; items: News[] } | null;
      if (stopped || !r) return;
      const first = since === null;
      since = r.now;
      if (first) return;
      for (const n of r.items) if (!n.mine) toast(newsLine(n));
    }
    void poll();
    const timer = window.setInterval(() => void poll(), NEWS_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!toasts.length || hidden) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[190px] z-20 mx-auto flex max-w-sm flex-col gap-1.5" aria-live="polite" aria-label="News">
      {toasts.map((t) => (
        <p
          key={t.id}
          className="loota-wonder-banner rounded-xl bg-ink/95 px-3 py-2 text-sm font-bold text-paper ring-1 ring-gold max-sm:line-clamp-2 max-sm:[&:not(:last-child)]:hidden"
        >
          {t.text}
        </p>
      ))}
    </div>
  );
}

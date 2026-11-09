"use client";

import { createContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LootaLogo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

/** This device's session (claim_session), for the live positions it sends: the broadcast ignores any other. */
export const SessionContext = createContext<{ current: string | null }>({ current: null });

type Other = { session: string; kind: "phone" | "computer" };
const kindOfThis = (): Other["kind"] => (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "phone" : "computer");

/**
 * One device a player (owner, 3 Nov 2026: "If a user joins on 2 device… User should get a message on the screens that
 * wont go away until one is closed"). Every open game says it's there (Realtime presence on device:<player>); while
 * the player has it open on more than one device, the game is paused on all of them (no moves, saves or live position,
 * so the broadcast sees one hunter) under a message that stays until all but one are closed: closing the tab, or
 * "Close it here". The one left carries on. A device closed here can open the game again ("Play here").
 */
export function OneDevice({ playerId, children }: { playerId: string; children: React.ReactNode }) {
  const session = useRef<string | null>(null); // handed down as the ref itself: read when a position is sent
  const [others, setOthers] = useState<Other[]>([]);
  const [here, setHere] = useState(true); // false: closed on this device ("Close it here")
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (!here) return;
    const supabase = createClient();
    const id = crypto.randomUUID();
    session.current = id;
    void supabase.rpc("claim_session", { p_session: id });
    const ch = supabase.channel(`device:${playerId}`, { config: { private: true, presence: { key: id } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ kind: Other["kind"] }>();
      setOthers(
        Object.entries(state)
          .filter(([key]) => key !== id)
          .map(([key, metas]) => ({ session: key, kind: metas[0]?.kind ?? "computer" })),
      );
    });
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      void ch.track({ kind: kindOfThis(), at: new Date().toISOString() });
      setJoined(true);
    });
    return () => {
      setJoined(false);
      setOthers([]);
      void ch.untrack();
      void supabase.removeChannel(ch);
    };
  }, [playerId, here]);

  if (!here) {
    return (
      <Screen>
        <h1 className="font-display text-2xl font-extrabold">Closed on this device</h1>
        <p className="max-w-sm text-sm text-paper/75">Carry on on your other device. Or play here (close it there first).</p>
        <button type="button" onClick={() => setHere(true)} className="h-12 rounded-xl bg-gold px-6 font-bold text-ink">
          Play here
        </button>
      </Screen>
    );
  }
  if (joined && others.length > 0) {
    const where = [kindOfThis(), ...others.map((o) => o.kind)];
    const phones = where.filter((k) => k === "phone").length;
    const devices =
      phones === where.length ? `${where.length} phones` : phones === 0 ? `${where.length} computers` : phones === 1 && where.length === 2 ? "a phone and a computer" : `${where.length} devices`;
    return (
      <Screen>
        <h1 className="font-display text-2xl font-extrabold">Loota is open on {devices}</h1>
        <p className="max-w-sm text-sm text-paper/75">
          You can play on one device at a time, so the hunt sees only one of you. The game is paused on all of them until you close it on all but one.
        </p>
        <button type="button" onClick={() => setHere(false)} className="h-12 rounded-xl bg-gold px-6 font-bold text-ink">
          Close it here
        </button>
        <p className="text-xs text-paper/60">Or close the game on the other device: this one carries on.</p>
      </Screen>
    );
  }
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-ink p-6 text-center text-paper" role="dialog" aria-label="Open on more than one device">
      <LootaLogo height={44} tone="gold" />
      <p className="text-4xl" aria-hidden="true">
        📱💻
      </p>
      {children}
      <Link href="/lobby" className="text-sm font-bold text-paper/70 underline">
        Back to the lobby
      </Link>
    </div>
  );
}

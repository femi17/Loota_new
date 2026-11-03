"use client";

import { createContext, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LootaLogo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

/** This device's session (claim_session), for the live positions it sends: the broadcast ignores any other. */
export const SessionContext = createContext<{ current: string | null }>({ current: null });

/**
 * One device a player (owner, 3 Nov 2026: "If a user joins on 2 device, we close one so it doesn't affect the
 * broadcast"). Opening the game claims the player's session, the newest wins: another device that has the game open
 * hears it straight away (and checks every 30 s and on coming back to it, for one that was asleep), closes its game
 * (the map, saves, live position) and offers to play here instead.
 */
export function OneDevice({ playerId, children }: { playerId: string; children: React.ReactNode }) {
  const session = useRef<string | null>(null); // handed down as the ref itself: read when a position is sent
  const [elsewhere, setElsewhere] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const channel = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  /** Is this still the device the player plays on? (The database decides: a message alone never closes a game.) */
  const stillMine = useCallback(async () => {
    const mine = session.current;
    if (!mine) return true;
    const { data } = await createClient().from("player_sessions").select("session_id").eq("user_id", playerId).maybeSingle();
    return !data || (data as { session_id: string }).session_id === mine;
  }, [playerId, session]);

  const claim = useCallback(async () => {
    const id = crypto.randomUUID();
    session.current = id;
    const { error } = await createClient().rpc("claim_session", { p_session: id });
    if (error) return false;
    void channel.current?.send({ type: "broadcast", event: "takeover", payload: { session: id } });
    return true;
  }, [session]);

  useEffect(() => {
    const supabase = createClient();
    let live = true;
    const check = () =>
      void stillMine().then((mine) => {
        if (live && !mine) setElsewhere(true);
      });
    const ch = supabase.channel(`device:${playerId}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "takeover" }, ({ payload }) => {
      if ((payload as { session?: string }).session !== session.current) check();
    });
    ch.subscribe((status) => {
      // Connected: say so to any other device (it closes), now that it can hear us.
      if (status === "SUBSCRIBED" && session.current) void ch.send({ type: "broadcast", event: "takeover", payload: { session: session.current } });
    });
    channel.current = ch;
    void claim();
    const timer = window.setInterval(check, 30_000);
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      void supabase.removeChannel(ch);
      channel.current = null;
    };
  }, [playerId, claim, stillMine, session]);

  if (elsewhere) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-ink p-6 text-center text-paper" role="dialog" aria-label="Playing on another device">
        <LootaLogo height={44} tone="gold" />
        <p className="text-4xl" aria-hidden="true">
          📱
        </p>
        <h1 className="font-display text-2xl font-extrabold">Loota is open on another device</h1>
        <p className="max-w-sm text-sm text-paper/75">You can play on one device at a time, so the hunt sees only one of you. The game has closed here.</p>
        <button
          type="button"
          disabled={claiming}
          onClick={() => {
            setClaiming(true);
            void claim().then((ok) => {
              setClaiming(false);
              if (ok) setElsewhere(false);
            });
          }}
          className="h-12 rounded-xl bg-gold px-6 font-bold text-ink disabled:opacity-50"
        >
          {claiming ? "Opening…" : "Play here instead"}
        </button>
        <Link href="/lobby" className="text-sm font-bold text-paper/70 underline">
          Back to the lobby
        </Link>
      </div>
    );
  }
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RELICS, type RelicId } from "@/game/items";

type Relic = { id: string; relic: RelicId; charges: number; expires_at: string };

/** The player's bag: relics found while roaming, kept for the next hunt. */
export function BagPanel({ leads, onClose }: { leads: number; onClose: () => void }) {
  const [relics, setRelics] = useState<Relic[] | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("player_relics")
      .select("id, relic, charges, expires_at")
      .order("acquired_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setRelics(((data ?? []) as Relic[]).filter((r) => new Date(r.expires_at).getTime() > Date.now()));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Your bag"
        className="max-h-[80dvh] w-full overflow-y-auto rounded-t-3xl bg-ink p-5 sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl font-extrabold">Your bag</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center rounded-xl bg-ink-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {leads > 0 && (
          <p className="mb-4 rounded-2xl bg-ink-2 p-3 text-sm">
            <span className="font-bold text-[#C3A6FF]">
              {leads} intel lead{leads > 1 ? "s" : ""}
            </span>{" "}
            on the map: follow the purple beams. About 1 in 4 scrolls is a decoy.
          </p>
        )}

        {relics === null ? (
          <p className="text-muted">Opening your bag…</p>
        ) : relics.length === 0 ? (
          <p className="text-muted">
            No relics yet. Roam the map: relics hide at real places, and intel scrolls point the way. Relics can&apos;t be bought.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {relics.map((r) => {
              const info = RELICS[r.relic];
              return (
                <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-ink-2 p-3">
                  <span className="size-9 shrink-0 rotate-45 rounded-md" style={{ background: info.colour }} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-bold">
                      {info.name}
                      {r.charges > 1 ? ` ×${r.charges}` : ""}
                    </span>
                    <span className="text-sm text-muted">{info.effect}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{daysLeft(r.expires_at)}d left</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">Relics are used during hunts. Using them arrives with the hunt update.</p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RELICS, type RelicId } from "@/game/items";

type Relic = { id: string; relic: RelicId; charges: number; expires_at: string };

/** What each relic's button says (Shields work by themselves; Fast Pass waits for transport). */
const USE_LABEL: Record<RelicId, string | null> = {
  second_wind: "Use",
  jerry_can: "Use",
  radar: "Use",
  rain_charm: "Use",
  shield: null,
  fast_pass: null,
  lockdown_orb: "Raise dome",
};

/** The player's bag: relics found while roaming, and using them. */
export function BagPanel({ leads, onUse, onClose }: { leads: number; onUse: (id: string) => Promise<string>; onClose: () => void }) {
  const [relics, setRelics] = useState<Relic[] | null>(null);
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // reload after using one

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("player_relics")
      .select("id, relic, charges, expires_at")
      .gt("charges", 0)
      .order("acquired_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setRelics(((data ?? []) as Relic[]).filter((r) => new Date(r.expires_at).getTime() > Date.now()));
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));

  async function use(id: string) {
    setBusy(id);
    setMessage(await onUse(id));
    setBusy(null);
    setVersion((v) => v + 1);
  }

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
            in your lamp, as whispers. About 1 in 4 is a lie.
          </p>
        )}

        {message && (
          <p role="status" className="mb-4 rounded-2xl border border-gold/60 bg-gold/10 p-3 text-sm">
            {message}
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
              const label = USE_LABEL[r.relic];
              return (
                <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-ink-2 p-3">
                  <span className="size-9 shrink-0 rotate-45 rounded-md" style={{ background: info.colour }} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-bold">
                      {info.name}
                      {r.charges > 1 ? ` ×${r.charges}` : ""}
                    </span>
                    <span className="text-sm text-muted">{info.effect}</span>
                    <span className="text-xs text-muted">{daysLeft(r.expires_at) === 1 ? "1 day left" : `${daysLeft(r.expires_at)} days left`}</span>
                  </span>
                  {label ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void use(r.id)}
                      className="h-10 shrink-0 rounded-xl bg-gold px-4 text-sm font-bold text-ink disabled:opacity-50"
                    >
                      {busy === r.id ? "…" : label}
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs text-muted">{r.relic === "shield" ? "Works by itself" : "Tick it when you board"}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">
          Relics are found, never bought, and last 7 days. A Shield is used up automatically when it blocks rain or traffic.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RELICS, type RelicId } from "@/game/items";
import { wonderOf } from "@/game/wonders";
import { VEHICLES, type AddonId, type VehicleKind } from "@/game/economy";
import { PapersRow, type OwnedVehicle } from "./VehiclePanel";

type Relic = { id: string; relic: RelicId; charges: number; expires_at: string };
/** A Wonder from the Djinn (design doc 7.7): held in secret. */
type Wonder = { id: string; wonder: string; expires_at: string };

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

/** What each Wonder's button says (the Djinn's Coin works by itself). */
const WONDER_LABEL: Record<string, string> = {
  carpet_of_kings: "Fly",
  seers_seal: "Break",
  master_key: "Turn",
  phantom_cloak: "Wear",
  sandstorm_crown: "Wear",
  eye_of_the_djinn: "Open",
  hourglass_of_ages: "Turn",
};

/** The player's inventory: their vehicles' gear and papers (and buying what's missing), Wonders, and relics. */
export function BagPanel({
  leads,
  owned,
  coins,
  onAddon,
  onUse,
  onWonder,
  onClose,
}: {
  leads: number;
  /** The vehicles the player owns, with their gear and papers. */
  owned: OwnedVehicle[];
  coins: number;
  /** Buy a missing piece of gear or a licence. */
  onAddon: (kind: VehicleKind, id: AddonId) => Promise<void>;
  onUse: (id: string) => Promise<string>;
  /** Use a Wonder; null when the map takes over (the Carpet asks where to). */
  onWonder: (id: string, wonder: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [relics, setRelics] = useState<Relic[] | null>(null);
  const [wonders, setWonders] = useState<Wonder[]>([]);
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null); // a Wonder is used once: tap twice
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // reload after using one
  const [buying, setBuying] = useState(false);

  async function addon(kind: VehicleKind, id: AddonId) {
    setBuying(true);
    await onAddon(kind, id);
    setBuying(false);
  }

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
    createClient()
      .from("player_wonders")
      .select("id, wonder, expires_at")
      .is("used_at", null)
      .order("won_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setWonders(((data ?? []) as Wonder[]).filter((w) => new Date(w.expires_at).getTime() > Date.now()));
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

  async function unleash(w: Wonder) {
    if (sure !== w.id) {
      setSure(w.id);
      return;
    }
    setSure(null);
    setBusy(w.id);
    const said = await onWonder(w.id, w.wonder);
    setBusy(null);
    if (said === null) return;
    setMessage(said);
    setVersion((v) => v + 1);
  }

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Inventory"
        className="max-h-[80dvh] w-full overflow-y-auto rounded-t-3xl bg-ink p-5 sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl font-extrabold">Inventory</h2>
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

        {wonders.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2" aria-label="Your Wonders">
            {wonders.map((w) => {
              const info = wonderOf(w.wonder);
              return (
                <li key={w.id} className="flex flex-col gap-1 rounded-2xl bg-[#2A1747] p-4 ring-2 ring-[#9B5DE5]">
                  <p className="font-display text-lg font-extrabold">
                    {info.icon} {info.name.replace(/^the /, "The ")}
                  </p>
                  <p className="text-sm text-paper/85">{info.effect}</p>
                  <p className="text-xs text-paper/60">
                    A Wonder from the Djinn: one in the world, and only you know you hold it. Fades in {daysLeft(w.expires_at)} days.{" "}
                    {w.wonder === "djinn_coin"
                      ? "It works by itself, once."
                      : w.wonder === "carpet_of_kings"
                        ? "Fly any time."
                        : w.wonder === "seers_seal"
                          ? "Break it on the Djinn's map, before you choose a seal."
                          : "Its power wakes in a live hunt. Everyone will hear when you use it."}
                  </p>
                  {w.wonder !== "djinn_coin" && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void unleash(w)}
                      className={`mt-1 h-10 self-start rounded-xl px-4 text-sm font-bold disabled:opacity-50 ${
                        sure === w.id ? "bg-danger text-paper" : "bg-[#9B5DE5] text-paper"
                      }`}
                    >
                      {busy === w.id ? "…" : sure === w.id ? "Sure? It's used once. Tap again" : (WONDER_LABEL[w.wonder] ?? "Unleash")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <section className="mb-4 flex flex-col gap-2" aria-label="Gear and papers">
          <h3 className="font-display text-lg font-extrabold">Gear and papers</h3>
          {owned.length === 0 ? (
            <p className="text-sm text-muted">
              No vehicle of your own yet. Buy one with the vehicle button on the right: its gear and papers (a light, a helmet, your
              licence, registration, insurance) are offered with it, and you can get anything missing here later.
            </p>
          ) : (
            <>
              {owned.map((v) => (
                <div key={v.kind} className="flex flex-col gap-1.5 rounded-2xl bg-ink-2 p-3">
                  <p className="font-bold">
                    {VEHICLES[v.kind].name}
                    {v.inUse ? <span className="ml-2 text-xs font-normal text-muted">riding</span> : null}
                  </p>
                  <PapersRow kind={v.kind} papers={v.papers} coins={coins} busy={buying} onAddon={(k, id) => void addon(k, id)} />
                </div>
              ))}
              <p className="text-xs text-muted">
                Police checkpoints fine 20 coins for each thing missing. Licences are yours (one covers every motorbike, or every car); a
                helmet, registration and insurance belong to each vehicle. Rented vehicles come with everything.
              </p>
            </>
          )}
        </section>

        <h3 className="mb-2 font-display text-lg font-extrabold">Relics</h3>
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

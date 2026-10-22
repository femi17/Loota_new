"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RELIC_ICON, RELICS, type RelicId } from "@/game/items";
import { wonderOf } from "@/game/wonders";
import { KEG_CAPACITY, VEHICLES, type AddonId, type VehicleKind } from "@/game/economy";
import { GearTiles, type OwnedVehicle } from "./VehiclePanel";
import { BagIcon, CloseIcon, VehicleIcon } from "./HudIcons";

type Relic = { id: string; relic: RelicId; charges: number; expires_at: string };
/** A Wonder from the Djinn (design doc 7.7): held in secret. */
type Wonder = { id: string; wonder: string; expires_at: string };
type Tab = "gear" | "relics" | "wonders";

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

const RARITY_STYLE: Record<string, string> = {
  Common: "bg-paper/10 text-paper/80",
  Rare: "bg-[#F4B41A]/15 text-gold",
  Legendary: "bg-[#9B5DE5]/25 text-[#C3A6FF]",
};

const STATE_CHIP: Record<OwnedVehicle["state"], { text: string; style: string }> = {
  ready: { text: "In your pocket", style: "bg-paper/10 text-paper/80" },
  empty: { text: "Empty tank", style: "bg-danger/20 text-[#FF8A8A]" },
  broken: { text: "Broken down", style: "bg-danger/20 text-[#FF8A8A]" },
  repairing: { text: "Being repaired", style: "bg-[#F4B41A]/15 text-gold" },
  stranded: { text: "Parked · no fuel", style: "bg-danger/20 text-[#FF8A8A]" },
  flat: { text: "Parked · flat tyre", style: "bg-danger/20 text-[#FF8A8A]" },
};

/** The player's inventory: their vehicles' gear and papers (and buying what's missing), the jerry can, relics, Wonders. */
export function BagPanel({
  leads,
  owned,
  coins,
  keg,
  tyreKits,
  onUseItem,
  onAddon,
  onUse,
  onWonder,
  onClose,
}: {
  leads: number;
  /** The vehicles the player owns, with their gear and papers. */
  owned: OwnedVehicle[];
  coins: number;
  /** The jerry can, if the player has one (fuel in % of a tank). */
  keg: { fuel: number; usesLeft: number } | null;
  /** Tyre kits (pump and patches): a bicycle's flat fixed anywhere. */
  tyreKits: number;
  onUseItem: (item: "tyre_kit") => Promise<string>;
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
  const [tab, setTab] = useState<Tab>("gear");

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

  async function addon(kind: VehicleKind, id: AddonId) {
    setBuying(true);
    await onAddon(kind, id);
    setBuying(false);
  }

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

  const relicCount = relics?.reduce((n, r) => n + r.charges, 0) ?? 0;
  const tabs: { id: Tab; icon: string; label: string; count: number | null }[] = [
    { id: "gear", icon: "🎒", label: "Gear", count: null },
    { id: "relics", icon: "💎", label: "Relics", count: relicCount },
    { id: "wonders", icon: "✨", label: "Wonders", count: wonders.length },
  ];

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Inventory"
        className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-ink sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: the backpack, coins, close */}
        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-[#9B5DE5]/20 text-[#C3A6FF]" aria-hidden="true">
            <BagIcon />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-extrabold leading-tight">Inventory</h2>
            <p className="text-xs text-muted">{coins.toLocaleString("en-NG")} coins to spend</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center rounded-xl bg-ink-2">
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="mx-5 mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-ink-2 p-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition-colors ${
                tab === t.id ? "bg-gold text-ink" : "text-paper/75"
              }`}
            >
              <span aria-hidden="true">{t.icon}</span>
              {t.label}
              {t.count ? (
                <span className={`rounded-full px-1.5 text-[11px] ${tab === t.id ? "bg-ink/20" : "bg-paper/15"}`}>{t.count}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6">
          {message && (
            <p role="status" className="mb-3 rounded-2xl border border-gold/60 bg-gold/10 p-3 text-sm">
              {message}
            </p>
          )}
          {leads > 0 && (
            <p className="mb-3 flex items-center gap-2 rounded-2xl bg-[#2A1747] p-3 text-sm">
              <span className="text-xl" aria-hidden="true">📜</span>
              <span>
                <b className="text-[#C3A6FF]">
                  {leads} intel lead{leads > 1 ? "s" : ""}
                </b>{" "}
                in your lamp, as whispers. About 1 in 4 is a lie.
              </span>
            </p>
          )}

          {tab === "gear" && (
            <section className="flex flex-col gap-3" aria-label="Gear and papers">
              {owned.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-2xl bg-ink-2 p-5 text-center">
                  <span className="text-4xl" aria-hidden="true">🛵</span>
                  <p className="text-sm text-muted">
                    No vehicle of your own yet. Buy one with the vehicle button on the right: its gear and papers (a light, a helmet, your licence,
                    registration, insurance) are offered with it, and anything missing can be got here later.
                  </p>
                </div>
              )}
              {owned.map((v) => {
                const chip = v.inUse ? { text: "Riding", style: "bg-[#1E9E62]/25 text-[#3DD68C]" } : STATE_CHIP[v.state];
                return (
                  <div key={v.kind} className="rounded-2xl bg-ink-2 p-3">
                    <div className="mb-2.5 flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-gold/15 text-gold" aria-hidden="true">
                        <VehicleIcon kind={v.kind} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold leading-tight">{VEHICLES[v.kind].name}</p>
                        {v.kind !== "bicycle" && (
                          <div className="mt-1 flex items-center gap-2" aria-label={`Fuel ${Math.round(v.fuel)}%`}>
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink">
                              <div className={`h-full rounded-full ${v.fuel < 20 ? "bg-danger" : "bg-gold"}`} style={{ width: `${Math.max(0, Math.min(100, v.fuel))}%` }} />
                            </div>
                            <span className="text-[11px] text-muted">⛽ {Math.round(v.fuel)}%</span>
                          </div>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.style}`}>{chip.text}</span>
                    </div>
                    <GearTiles kind={v.kind} papers={v.papers} coins={coins} busy={buying} onAddon={(k, id) => void addon(k, id)} />
                  </div>
                );
              })}

              {/* The jerry can */}
              <div className="flex items-center gap-3 rounded-2xl bg-ink-2 p-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-danger/15 text-xl" aria-hidden="true">🛢</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-tight">Jerry can</p>
                  <p className="text-xs text-muted">
                    {keg
                      ? `${keg.fuel > 0 ? `${Math.round(keg.fuel)}% of a tank in it` : "Empty"} · ${keg.usesLeft} uses left`
                      : "None yet: petrol stations sell them (25 coins)."}
                  </p>
                </div>
                {keg && (
                  <div className="relative h-9 w-3 overflow-hidden rounded-full bg-ink" aria-hidden="true">
                    <div className="absolute inset-x-0 bottom-0 rounded-full bg-danger" style={{ height: `${Math.min(100, (100 * keg.fuel) / KEG_CAPACITY)}%` }} />
                  </div>
                )}
              </div>

              {/* Tyre kits, from people you helped */}
              {tyreKits > 0 && (
                <div className="flex items-center gap-3 rounded-2xl bg-ink-2 p-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-gold/15 text-xl" aria-hidden="true">🛠</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold leading-tight">Tyre kit{tyreKits > 1 ? ` ×${tyreKits}` : ""}</p>
                    <p className="text-xs text-muted">Pump and patches: your bicycle&apos;s tyres pumped, or a flat fixed, anywhere.</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy("tyre_kit");
                      setMessage(await onUseItem("tyre_kit"));
                      setBusy(null);
                    }}
                    className="h-10 shrink-0 rounded-xl bg-gold px-4 text-sm font-bold text-ink disabled:opacity-50"
                  >
                    {busy === "tyre_kit" ? "…" : "Use"}
                  </button>
                </div>
              )}

              {owned.length > 0 && (
                <p className="px-1 text-[11px] leading-relaxed text-muted">
                  🚔 Police checkpoints fine 20 coins for each thing missing. Licences are yours (one covers every motorbike, or every car); a helmet,
                  registration and insurance belong to each vehicle. Rented vehicles come with everything.
                </p>
              )}
            </section>
          )}

          {tab === "relics" &&
            (relics === null ? (
              <p className="py-6 text-center text-muted">Opening your bag…</p>
            ) : relics.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl bg-ink-2 p-5 text-center">
                <span className="text-4xl" aria-hidden="true">💎</span>
                <p className="text-sm text-muted">No relics yet. They hide at real places during a hunt; intel scrolls point the way. Relics can&apos;t be bought.</p>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-2" aria-label="Your relics">
                {relics.map((r) => {
                  const info = RELICS[r.relic];
                  const label = USE_LABEL[r.relic];
                  return (
                    <li key={r.id} className="flex flex-col gap-2 rounded-2xl bg-ink-2 p-3" style={{ boxShadow: `inset 0 0 0 1.5px ${info.colour}55` }}>
                      <div className="flex items-start justify-between">
                        <span
                          className="flex size-12 items-center justify-center rounded-2xl text-2xl"
                          style={{ background: `${info.colour}26`, boxShadow: `0 0 18px ${info.colour}40` }}
                          aria-hidden="true"
                        >
                          {RELIC_ICON[r.relic]}
                        </span>
                        {r.charges > 1 && <span className="rounded-full bg-paper/15 px-2 text-xs font-bold">×{r.charges}</span>}
                      </div>
                      <div>
                        <p className="font-bold leading-tight">{info.name}</p>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${RARITY_STYLE[info.rarity]}`}>
                          {info.rarity}
                        </span>
                      </div>
                      <p className="flex-1 text-xs leading-snug text-muted">{info.effect}</p>
                      <p className="text-[11px] text-muted">⏳ {daysLeft(r.expires_at) === 1 ? "1 day left" : `${daysLeft(r.expires_at)} days left`}</p>
                      {label ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void use(r.id)}
                          className="h-10 rounded-xl bg-gold text-sm font-bold text-ink disabled:opacity-50"
                        >
                          {busy === r.id ? "…" : label}
                        </button>
                      ) : (
                        <span className="flex h-10 items-center justify-center rounded-xl bg-ink text-center text-[11px] text-muted">
                          {r.relic === "shield" ? "Works by itself" : "Tick it when you board"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}
          {tab === "relics" && (
            <p className="mt-3 px-1 text-[11px] text-muted">Relics are found, never bought, and last 7 days. A Shield is used up by itself when it blocks rain or traffic.</p>
          )}

          {tab === "wonders" &&
            (wonders.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl bg-[#2A1747] p-5 text-center">
                <span className="text-4xl" aria-hidden="true">🧞</span>
                <p className="text-sm text-paper/80">
                  No Wonders. Once a week the Djinn opens a Wager: win it and a one-of-a-kind Wonder is yours, held in secret.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Your Wonders">
                {wonders.map((w) => {
                  const info = wonderOf(w.wonder);
                  return (
                    <li key={w.id} className="flex flex-col gap-2 rounded-2xl bg-[#2A1747] p-4 ring-2 ring-[#9B5DE5]">
                      <div className="flex items-center gap-3">
                        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#9B5DE5]/30 text-3xl shadow-[0_0_24px_rgba(155,93,229,0.6)]" aria-hidden="true">
                          {info.icon}
                        </span>
                        <div className="min-w-0">
                          <p className="font-display text-lg font-extrabold leading-tight">{info.name.replace(/^the /, "The ")}</p>
                          <p className="text-[11px] text-[#C3A6FF]">One in the world · fades in {daysLeft(w.expires_at)} days</p>
                        </div>
                      </div>
                      <p className="text-sm text-paper/85">{info.effect}</p>
                      <p className="text-xs text-paper/60">
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
                          className={`mt-1 h-11 rounded-xl text-sm font-bold disabled:opacity-50 ${sure === w.id ? "bg-danger text-paper" : "bg-[#9B5DE5] text-paper"}`}
                        >
                          {busy === w.id ? "…" : sure === w.id ? "Sure? It's used once. Tap again" : (WONDER_LABEL[w.wonder] ?? "Unleash")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      </div>
    </div>
  );
}

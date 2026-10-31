"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ClanChat } from "@/components/ClanChat";
import { RELICS, RELIC_ICON, type RelicId } from "@/game/items";
import { wonderOf } from "@/game/wonders";

type Member = { id: string; username: string; role: "leader" | "member"; joinedAt: string; seenAt: string | null; me: boolean };
type Mine = {
  clan: { id: string; name: string; crest: string; colour: string } | null;
  me?: { role: string; invite: string };
  members?: Member[];
  max?: number;
  asked?: boolean;
};
type Invite = { name: string; crest: string; colour: string; by: string; members: number } | null;
type Giftables = { relics: { id: string; relic: RelicId; charges: number }[]; wonders: { id: string; wonder: string }[] };

const CRESTS = ["🛡️", "🦁", "🐍", "🦅", "🐺", "🦂", "🐘", "🐉", "⚓", "🗝️", "🔥", "🌙"];
const COLOURS = ["#F4B41A", "#2EC4B6", "#E63946", "#9B5DE5", "#2F6FEB", "#1E9E62", "#F28C28", "#F4F1EA"];
const field = "h-11 rounded-xl border-[1.5px] border-line bg-ink px-3 text-paper outline-none focus:border-gold";
const SAY: Record<string, string> = {
  taken: "That clan name is taken. Try another.",
  name: "A clan name needs 2 to 30 letters.",
  in_clan: "You're already in a clan.",
  code: "That invite code doesn't match a clan.",
  full: "That clan is full: 5 is the most.",
  coins: "You don't have that many coins.",
  amount: "Give between 1 and 5,000 coins.",
  not_mate: "You can only give to your clanmates.",
  item: "That's no longer yours to give.",
};
const ago = (iso: string | null) => {
  if (!iso) return "not on the map yet";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 2 ? "on the map now" : m < 60 ? `on the map ${m} min ago` : m < 1440 ? `on the map ${Math.round(m / 60)} h ago` : `last seen ${Math.round(m / 1440)} d ago`;
};
const forgetInvite = () => {
  document.cookie = "loota_invite=; path=/; max-age=0";
};

/**
 * Clans (owner, 31 Oct 2026: "ask them if they want to clan up or solo… the ready player hunt vibe"): start one, join
 * one with an invite, or hunt solo; in a clan, its members, the invite link, gifts (coins, items, Wonders) and the chat.
 */
export function ClanPanel({ inviteCode, welcome }: { inviteCode: string | null; welcome: boolean }) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [mine, setMine] = useState<Mine | null>(null);
  const [invite, setInvite] = useState<Invite>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_clan");
    setMine(data as Mine);
  }, [supabase]);
  useEffect(() => {
    let live = true;
    void supabase.rpc("my_clan").then(({ data }) => live && setMine(data as Mine));
    if (inviteCode) void supabase.rpc("clan_of_invite", { p_code: inviteCode }).then(({ data }) => live && setInvite(data as Invite));
    return () => {
      live = false;
    };
  }, [supabase, inviteCode]);

  async function act(fn: string, args: Record<string, unknown>, done?: string) {
    if (busy) return null;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { data } = await supabase.rpc(fn, args);
      const r = data as { ok: boolean; reason?: string; balance?: number } | null;
      if (!r?.ok) {
        setError(SAY[r?.reason ?? ""] ?? "That didn't work. Try again.");
        return null;
      }
      if (done) setNote(done);
      await load();
      return r;
    } finally {
      setBusy(false);
    }
  }

  if (!mine) return <p className="text-muted">Loading…</p>;

  // ---- Not in a clan: start one, join one, or hunt solo
  if (!mine.clan) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="font-display text-3xl font-extrabold">{welcome ? "One last thing: clan up or solo?" : "Clan up or solo?"}</h1>
          <p className="mt-1 text-muted">
            Every hunter races for the prize alone, but a clan helps: a private chat for clues, clanmates on your map, and coins, items and Wonders you can give
            each other. Up to 5 hunters.
          </p>
        </div>
        {error && <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger-text ring-1 ring-danger">{error}</p>}
        {invite && (
          <section className="flex flex-col gap-3 rounded-3xl p-5 ring-2" style={{ background: `${invite.colour}22`, borderColor: invite.colour, boxShadow: `inset 0 0 0 2px ${invite.colour}` }} aria-label="Your invite">
            <p className="text-sm text-muted">{invite.by} invited you to</p>
            <p className="font-display text-2xl font-extrabold">
              {invite.crest} {invite.name}
            </p>
            <p className="text-sm text-muted">{invite.members} of 5 hunters</p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await act("join_clan", { p_code: inviteCode })) forgetInvite();
              }}
              className="h-12 rounded-2xl bg-gold font-bold text-ink disabled:opacity-60"
            >
              Join {invite.name}
            </button>
          </section>
        )}
        <StartClan busy={busy} onStart={(name, crest, colour) => void act("create_clan", { p_name: name, p_crest: crest, p_colour: colour })} />
        {!invite && <JoinClan busy={busy} onJoin={(code) => void act("join_clan", { p_code: code })} />}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            await supabase.rpc("clan_go_solo");
            forgetInvite();
            router.push("/lobby");
          }}
          className="h-12 rounded-2xl border-[1.5px] border-line font-bold"
        >
          🧭 Hunt solo (you can join a clan later)
        </button>
      </div>
    );
  }

  // ---- In a clan
  const { clan, me, members = [] } = mine;
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/join/${me!.invite}`;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex items-center gap-4 rounded-3xl p-5" style={{ background: `${clan.colour}22`, boxShadow: `inset 0 0 0 2px ${clan.colour}` }}>
        <span className="text-5xl" aria-hidden="true">
          {clan.crest}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-extrabold">{clan.name}</h1>
          <p className="text-sm text-muted">
            {members.length} of {mine.max ?? 5} hunters · you&apos;re {me?.role === "leader" ? "the leader" : "a member"}
          </p>
        </div>
      </section>
      {error && <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger-text ring-1 ring-danger">{error}</p>}
      {note && <p className="rounded-xl bg-[#1E9E62]/15 p-3 text-sm ring-1 ring-[#1E9E62]">{note}</p>}

      <section className="flex flex-col gap-2" aria-label="Members">
        <h2 className="font-display text-lg font-extrabold">Members</h2>
        {members.map((m) => (
          <MemberRow key={m.id} member={m} busy={busy} onGiveCoins={(n) => void act("clan_give_coins", { p_to: m.id, p_amount: n }, `You gave ${m.username} ${n} coins.`)} onGiveItem={(kind, id, name) => void act(kind === "relic" ? "clan_give_relic" : "clan_give_wonder", kind === "relic" ? { p_relic: id, p_to: m.id } : { p_wonder: id, p_to: m.id }, `You gave ${m.username} ${name}.`)} />
        ))}
      </section>

      {members.length < (mine.max ?? 5) && (
        <section className="flex flex-col gap-2 rounded-2xl bg-ink-2 p-4" aria-label="Invite">
          <h2 className="font-bold">Invite a hunter</h2>
          <p className="text-sm text-muted">Send your link to someone who&apos;s good at puzzles. When they join through it and play their first hunt, you both get 250 coins.</p>
          <div className="flex gap-2">
            <input readOnly value={link} className={`${field} min-w-0 flex-1 text-sm`} aria-label="Your invite link" />
            <button
              type="button"
              onClick={async () => {
                if (navigator.share) await navigator.share({ title: `Join ${clan.name} on Loota`, url: link }).catch(() => {});
                else {
                  await navigator.clipboard.writeText(link);
                  setNote("Invite link copied.");
                }
              }}
              className="h-11 shrink-0 rounded-xl bg-gold px-4 text-sm font-bold text-ink"
            >
              Share
            </button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label="Chat">
        <h2 className="font-display text-lg font-extrabold">Clan chat</h2>
        <ClanChat className="h-80" />
      </section>

      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Leave ${clan.name}?`)) return;
          await act("leave_clan", {}, `You left ${clan.name}.`);
        }}
        className="self-start text-sm text-muted underline"
      >
        Leave the clan
      </button>
    </div>
  );
}

function StartClan({ busy, onStart }: { busy: boolean; onStart: (name: string, crest: string, colour: string) => void }) {
  const [name, setName] = useState("");
  const [crest, setCrest] = useState(CRESTS[1]);
  const [colour, setColour] = useState(COLOURS[0]);
  return (
    <form
      className="flex flex-col gap-3 rounded-3xl bg-ink-2 p-5"
      aria-label="Start a clan"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(name, crest, colour);
      }}
    >
      <h2 className="font-display text-xl font-extrabold">⚔️ Start a clan</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={30} placeholder="The Night Owls" className={field} aria-label="Clan name" />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Crest">
        {CRESTS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={crest === c} onClick={() => setCrest(c)} className={`size-11 rounded-xl text-2xl ${crest === c ? "bg-gold" : "bg-ink"}`}>
            {c}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
        {COLOURS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={c} onClick={() => setColour(c)} className={`size-9 rounded-full ${colour === c ? "ring-4 ring-paper" : ""}`} style={{ background: c }} />
        ))}
      </div>
      <button type="submit" disabled={busy} className="h-12 rounded-2xl bg-gold font-bold text-ink disabled:opacity-60">
        Start {name.trim() || "the clan"}
      </button>
    </form>
  );
}

function JoinClan({ busy, onJoin }: { busy: boolean; onJoin: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-col gap-3 rounded-3xl bg-ink-2 p-5"
      aria-label="Join a clan"
      onSubmit={(e) => {
        e.preventDefault();
        onJoin(code);
      }}
    >
      <h2 className="font-display text-xl font-extrabold">🤝 Join a clan</h2>
      <p className="text-sm text-muted">Got an invite code from a friend? Type it here (or open their invite link).</p>
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required maxLength={8} placeholder="8048CB28" className={`${field} min-w-0 flex-1 font-mono tracking-widest`} aria-label="Invite code" />
        <button type="submit" disabled={busy} className="h-11 shrink-0 rounded-xl bg-gold px-4 font-bold text-ink disabled:opacity-60">
          Join
        </button>
      </div>
    </form>
  );
}

function MemberRow({ member, busy, onGiveCoins, onGiveItem }: { member: Member; busy: boolean; onGiveCoins: (n: number) => void; onGiveItem: (kind: "relic" | "wonder", id: string, name: string) => void }) {
  const [supabase] = useState(createClient);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("50");
  const [gifts, setGifts] = useState<Giftables | null>(null);
  const [pick, setPick] = useState("");
  return (
    <div className="rounded-2xl bg-ink-2 p-3" data-member={member.username}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">
            {member.username} {member.role === "leader" && <span className="text-xs text-gold">· leader</span>} {member.me && <span className="text-xs text-muted">· you</span>}
          </p>
          <p className="text-xs text-muted">{ago(member.seenAt)}</p>
        </div>
        {!member.me && (
          <button
            type="button"
            onClick={async () => {
              setOpen((o) => !o);
              if (!gifts) {
                const { data } = await supabase.rpc("clan_giftables");
                setGifts(data as Giftables);
              }
            }}
            className="h-9 shrink-0 rounded-lg border border-line px-3 text-xs font-bold"
          >
            🎁 Give
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onGiveCoins(Number(amount));
            }}
          >
            <input type="number" min={1} max={5000} value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} h-10 w-28`} aria-label="Coins to give" />
            <button type="submit" disabled={busy} className="h-10 rounded-xl bg-gold px-3 text-sm font-bold text-ink disabled:opacity-60">
              Give coins
            </button>
          </form>
          {gifts && gifts.relics.length + gifts.wonders.length > 0 ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const [kind, id] = pick.split(":");
                const name = kind === "relic" ? RELICS[gifts.relics.find((r) => r.id === id)!.relic].name : wonderOf(gifts.wonders.find((w) => w.id === id)!.wonder).name;
                if (id) onGiveItem(kind as "relic" | "wonder", id, name);
              }}
            >
              <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${field} h-10 min-w-0 flex-1 text-sm`} aria-label="Item to give" required>
                <option value="">An item or Wonder…</option>
                {gifts.relics.map((r) => (
                  <option key={r.id} value={`relic:${r.id}`}>
                    {RELIC_ICON[r.relic]} {RELICS[r.relic].name}
                  </option>
                ))}
                {gifts.wonders.map((w) => (
                  <option key={w.id} value={`wonder:${w.id}`}>
                    {wonderOf(w.wonder).icon} {wonderOf(w.wonder).name}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={busy || !pick} className="h-10 shrink-0 rounded-xl border border-gold px-3 text-sm font-bold disabled:opacity-50">
                Give it
              </button>
            </form>
          ) : (
            <p className="text-xs text-muted">No items or Wonders to give right now.</p>
          )}
        </div>
      )}
    </div>
  );
}

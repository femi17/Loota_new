import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { HunterFigure } from "@/components/HunterFigure";
import { ChestArt } from "@/components/ChestArt";
import { Countdown } from "@/components/Countdown";
import { getPlayer, type Player } from "@/lib/player";
import { listHunts } from "@/lib/hunts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logOut } from "../(auth)/actions";
import { joinHunt } from "./actions";
import { JoinButton, PlayLink } from "./PlayButtons";
import { huntResumesAt, type HuntSummary } from "@/game/hunt";

/**
 * The lobby, "play first" (owner, 7 Nov 2026: "we need to redesign the lobby… the free roam when there is no hunt should
 * be at the top"; chose design A on the canvas): one big card at the top says what to do now — the live hunt you're in,
 * else Free roam — then the other hunts as compact cards, clan and look as tiles, and past hunts folded away.
 */

/** Now (read per request: the lobby is dynamic). */
const nowMs = () => Date.now();

const PHASE_LABEL = { draft: "Draft", upcoming: "Coming up", live: "Live now", paused: "Back at 9 am", ended: "Ended" } as const;
/** Live first, then resting for the night, then coming up, then ended. */
const ORDER = { live: 0, paused: 1, upcoming: 2, draft: 3, ended: 4 } as const;

const when = (iso: string) =>
  `${new Date(iso).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", ...(new Date(iso).getFullYear() !== new Date().getFullYear() && { year: "numeric" }), hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" })} (Lagos time)`;

const storage = (bucket: string, path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;

type Trailer = { video: string; poster: string | null };

/**
 * Each story hunt's trailer (owner, 31 Oct 2026: "What will be in the lobby, story trailer, I will create that"), with
 * the story's first picture as its cover. Read with the server's key: players can't read hunts themselves (it holds the
 * story's answers), so only these two addresses leave the server.
 */
async function trailersOf(ids: string[]) {
  if (!ids.length) return new Map<string, Trailer>();
  const { data } = await createAdminClient().from("hunts").select("id, trailer_path, story_pictures(n, path)").in("id", ids).not("trailer_path", "is", null);
  return new Map(
    (data ?? []).map((h) => {
      const first = [...(h.story_pictures ?? [])].filter((p) => p.path).sort((a, b) => a.n - b.n)[0];
      return [h.id, { video: storage("story-trailers", h.trailer_path!), poster: first ? storage("story-pictures", first.path!) : null }];
    }),
  );
}

/** How many keys the player holds in each hunt they're in. */
async function keysHeld(player: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const { data } = await createAdminClient().from("hunt_players").select("hunt_id, keys_held").eq("user_id", player).in("hunt_id", ids);
  return new Map((data ?? []).map((r) => [r.hunt_id, r.keys_held ?? 0]));
}

const Icon = {
  play: (size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  ),
  key: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2 20 3M17 6l3 3M15 8l2 2" />
    </svg>
  ),
  people: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.6c1.8.7 3 2.5 3.5 5.4" />
    </svg>
  ),
  clock: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  trophy: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden="true">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </svg>
  ),
  pin: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  ),
  map: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
      <path d="M9 3v15M15 6v15" />
    </svg>
  ),
  chevron: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
  shield: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" />
    </svg>
  ),
  shirt: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z" />
    </svg>
  ),
  past: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </svg>
  ),
};

/** A few streets, a park, water and the hunter's pin: free roam at a glance. */
function MapArt() {
  return (
    <svg viewBox="0 0 390 168" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden="true">
      <rect width="390" height="168" fill="#E9E2D3" />
      <path d="M0 120 C80 110 120 150 210 140 S330 100 390 112 V168 H0 Z" fill="#A9CBE0" />
      <rect x="250" y="18" width="90" height="56" rx="10" fill="#CFE0B4" />
      <path d="M-10 70 H400" stroke="#D6CCB8" strokeWidth="16" />
      <path d="M-10 70 H400" stroke="#fff" strokeWidth="11" />
      <path d="M120 -10 L150 180" stroke="#D6CCB8" strokeWidth="12" />
      <path d="M120 -10 L150 180" stroke="#fff" strokeWidth="8" />
      <path d="M150 70 C200 60 220 30 300 20" stroke="#fff" strokeWidth="6" fill="none" />
      <path d="M40 0 L60 70 L30 168" stroke="#fff" strokeWidth="5" fill="none" />
      <circle cx="140" cy="70" r="22" fill="#2F6FEB" opacity="0.15" />
      <circle cx="140" cy="70" r="13" fill="#2F6FEB" stroke="#fff" strokeWidth="4" />
    </svg>
  );
}

function TrailerVideo({ hunt, trailer, className }: { hunt: HuntSummary; trailer: Trailer; className: string }) {
  return (
    <video
      src={trailer.video}
      poster={trailer.poster ?? undefined}
      controls
      playsInline
      preload="metadata"
      aria-label={`${hunt.title}: the trailer`}
      className={`bg-ink object-cover ${className}`}
    />
  );
}

function LiveChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-paper">
      <span className="loota-live-dot size-1.5 rounded-full bg-paper" aria-hidden="true" />
      {children}
    </span>
  );
}

/** The countdown a hunt card shows: to its end, its 9 am return, or its start. */
function HuntClock({ h }: { h: HuntSummary }) {
  if (h.phase === "ended") return <>Ended</>;
  const to = h.phase === "live" ? h.endsAt : h.phase === "paused" ? new Date(huntResumesAt(nowMs())).toISOString() : h.startsAt;
  return (
    <>
      {h.phase === "live" ? "Ends in " : h.phase === "paused" ? "Back in " : "Starts in "}
      <Countdown to={to} fallback="…" />
    </>
  );
}

/** The top card when you're in a live hunt: where you are in it, and the way back in. */
function HuntHero({ h, trailer, held }: { h: HuntSummary; trailer?: Trailer; held: number }) {
  return (
    <section aria-label="Your hunt" className="overflow-hidden rounded-[28px] bg-ink-2 ring-[1.5px] ring-gold">
      <article>
        <div className="relative">
          {trailer ? (
            <TrailerVideo hunt={h} trailer={trailer} className="block aspect-video w-full" />
          ) : (
            <div className="flex h-40 items-center justify-center bg-[radial-gradient(ellipse_at_50%_60%,#4A3510_0%,#182033_70%)]">
              <ChestArt size={120} />
            </div>
          )}
          <span className="pointer-events-none absolute left-3 top-3">
            <LiveChip>Live · you&apos;re in</LiveChip>
          </span>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <h1 className="font-display text-[26px] font-extrabold leading-tight">{h.title}</h1>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <b>{held >= h.keys ? `All ${h.keys} keys found` : `Key ${held + 1} of ${h.keys}`}</b>
              <span className="text-muted">
                <HuntClock h={h} />
              </span>
            </div>
            <div className="flex gap-1.5" role="img" aria-label={`${held} of ${h.keys} keys found`}>
              {Array.from({ length: h.keys }, (_, i) => (
                <span key={i} className={`h-2 flex-1 rounded-full ${i < held ? "bg-gold" : i === held ? "bg-line ring-[1.5px] ring-inset ring-gold" : "bg-line"}`} />
              ))}
            </div>
          </div>
          <p className="flex items-center gap-2 text-sm text-muted">
            {Icon.trophy}
            <span>
              <b className="text-paper">{h.prize}</b> · {h.winners} winner{h.winners === 1 ? "" : "s"} · {h.players} hunter{h.players === 1 ? "" : "s"}
            </span>
          </p>
          <PlayLink href={`/play?hunt=${h.id}`} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-gold text-lg font-extrabold text-ink hover:bg-gold-hover">
            {Icon.play()}
            Continue the hunt
          </PlayLink>
        </div>
      </article>
    </section>
  );
}

/** The top card when you're not in a live hunt (owner, 7 Nov 2026: free roam at the top when there's no hunt). */
function FreeRoamHero({ resting }: { resting: boolean }) {
  return (
    <section aria-label="Free roam" className="overflow-hidden rounded-[28px] bg-ink-2 ring-[1.5px] ring-gold">
      <div className="relative h-40">
        <MapArt />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-bold">
          {Icon.pin}
          {resting ? "Your hunt is resting till 9 am" : "You're not in a live hunt"}
        </span>
      </div>
      <div className="flex flex-col gap-3 p-5">
        <div>
          <h1 className="font-display text-3xl font-extrabold leading-none">Free roam</h1>
          <p className="mt-1.5 text-muted">Explore from where you are: the Lamp&apos;s Detours, roadside games, rides and finds.</p>
        </div>
        <PlayLink href="/play" className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-gold text-lg font-extrabold text-ink hover:bg-gold-hover">
          {Icon.play()}
          Play free roam
        </PlayLink>
      </div>
    </section>
  );
}

/** A hunt in the list: what it is, how it stands, and Join (or the way back in). */
function HuntCard({ h, trailer }: { h: HuntSummary; trailer?: Trailer }) {
  const live = h.phase === "live";
  const action = h.phase === "ended" ? null : h.joined ? (
    <PlayLink href={`/play?hunt=${h.id}`} className="inline-flex h-11 shrink-0 items-center rounded-xl bg-gold px-4 font-extrabold text-ink hover:bg-gold-hover">
      {live ? "Continue" : "You're in"}
    </PlayLink>
  ) : (
    <form action={joinHunt} className="shrink-0">
      <input type="hidden" name="hunt" value={h.id} />
      <JoinButton className="h-11 rounded-xl border-[1.5px] border-gold px-4 font-extrabold text-gold hover:bg-gold hover:text-ink">
        {live ? "Join the hunt" : "Join"}
      </JoinButton>
    </form>
  );
  return (
    <article className="flex flex-col gap-3 overflow-hidden rounded-[22px] bg-ink-2 p-3.5">
      {trailer && <TrailerVideo hunt={h} trailer={trailer} className="aspect-video w-full rounded-2xl" />}
      <div className="flex gap-3">
        {!trailer && (
          <div className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-ink">
            <ChestArt size={56} glow={live} />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div>
            {live ? (
              <LiveChip>Live</LiveChip>
            ) : (
              <span className="inline-flex rounded-full bg-line px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider">{PHASE_LABEL[h.phase]}</span>
            )}
          </div>
          <h3 className="font-display text-lg font-extrabold leading-tight">{h.title}</h3>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1">
              {Icon.key}
              {h.keys} keys
            </span>
            <span className="inline-flex items-center gap-1">
              {Icon.people}
              {h.players} hunter{h.players === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1">
              {Icon.clock}
              <HuntClock h={h} />
            </span>
          </div>
        </div>
      </div>
      {h.description && <p className="text-sm text-muted">{h.description}</p>}
      <div className="flex items-center gap-3">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-muted">
          {Icon.trophy}
          <span className="min-w-0">
            <b className="text-paper">{h.prize}</b> · {h.winners} winner{h.winners === 1 ? "" : "s"}
          </span>
        </p>
        {action}
      </div>
      <p className="text-xs text-muted">
        {h.phase === "upcoming"
          ? `Starts ${when(h.startsAt)}`
          : live
            ? `${h.allDay ? "Hunting round the clock" : "Hunting 9 am – 9 pm daily"} · ends ${when(h.endsAt)}`
            : h.phase === "paused"
              ? `Resting for the night: back at 9 am (Lagos time) · ends ${when(h.endsAt)}`
              : `Ended ${when(h.endsAt)}`}
      </p>
    </article>
  );
}

async function LobbyBody({ player }: { player: Player }) {
  const hunts = (await listHunts()).sort((x, y) => ORDER[x.phase] - ORDER[y.phase]);
  const open = hunts.filter((h) => h.phase !== "ended");
  const [trailers, held] = await Promise.all([
    trailersOf(open.map((h) => h.id)),
    keysHeld(player.id, open.filter((h) => h.joined).map((h) => h.id)),
  ]);
  const mine = open.find((h) => h.joined && h.phase === "live") ?? null;
  const others = open.filter((h) => h !== mine);
  const past = hunts.filter((h) => h.phase === "ended");
  const resting = open.some((h) => h.joined && h.phase === "paused");

  return (
    <>
      {mine ? <HuntHero h={mine} trailer={trailers.get(mine.id)} held={held.get(mine.id) ?? 0} /> : <FreeRoamHero resting={resting} />}

      {mine && (
        <PlayLink href="/play" className="flex items-center gap-3 rounded-[20px] bg-ink-2 p-3 pr-4 hover:bg-line">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-map text-you">{Icon.map}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-display text-base font-extrabold">Free roam</span>
            <span className="text-[13px] text-muted">Off the hunt: detours, road games, rides</span>
          </span>
          <span className="text-muted">{Icon.chevron}</span>
        </PlayLink>
      )}

      <section aria-label="Hunts" className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-extrabold">{mine ? "More hunts" : "Hunts"}</h2>
          {others.some((h) => h.phase === "live") && <span className="text-[13px] text-muted">{others.filter((h) => h.phase === "live").length} live</span>}
        </div>
        {others.length ? (
          others.map((h) => <HuntCard key={h.id} h={h} trailer={trailers.get(h.id)} />)
        ) : (
          <div className="flex items-center gap-3 rounded-[22px] border-[1.5px] border-dashed border-line p-4">
            <ChestArt size={52} glow={false} />
            <p className="text-sm text-muted">{mine ? "No other hunts right now." : "No hunts live yet. The next one will appear here with its prize, keys and start time."}</p>
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2.5">
        <ClanTile />
        <Link href="/look" className="flex min-h-28 flex-col gap-2.5 rounded-[20px] bg-ink-2 p-3.5 hover:bg-line">
          <span className="flex size-10 items-center justify-center rounded-xl bg-ink text-gold">{Icon.shirt}</span>
          <span className="font-display text-base font-extrabold">Your look</span>
          <span className="text-xs text-muted">Change your hunter</span>
        </Link>
      </section>

      {past.length > 0 && (
        <details className="group rounded-[18px] border-[1.5px] border-dashed border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3.5 text-sm text-muted [&::-webkit-details-marker]:hidden">
            {Icon.past}
            <span className="flex-1">Past hunts ({past.length})</span>
            <span className="transition-transform group-open:rotate-90">{Icon.chevron}</span>
          </summary>
          <div className="flex flex-col gap-2.5 p-2.5 pt-0">
            {past.map((h) => (
              <HuntCard key={h.id} h={h} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

/** The player's clan, or the offer to start or join one (owner, 31 Oct 2026: "clan up or solo"). */
async function ClanTile() {
  const { data } = await (await createClient()).rpc("my_clan");
  const mine = data as { clan: { name: string; crest: string; colour: string } | null; members?: unknown[] } | null;
  const clan = mine?.clan;
  return (
    <Link
      href="/clan"
      className="flex min-h-28 flex-col gap-2.5 rounded-[20px] bg-ink-2 p-3.5 hover:bg-line"
      style={clan ? { boxShadow: `inset 0 0 0 1.5px ${clan.colour}` } : undefined}
      aria-label={clan ? `Your clan: ${clan.name}` : "Clan up"}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-ink text-xl text-gold">{clan ? <span aria-hidden="true">{clan.crest}</span> : Icon.shield}</span>
      <span className="truncate font-display text-base font-extrabold">{clan ? clan.name : "Clan up"}</span>
      <span className="text-xs text-muted">{clan ? `${mine?.members?.length ?? 1} of 5 hunters` : "Hunt with up to 4 friends"}</span>
    </Link>
  );
}

export const metadata: Metadata = { title: "Lobby · Loota" };

export default function LobbyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Suspense fallback={<LobbyFallback />}>
        <Lobby />
      </Suspense>
    </div>
  );
}

function LobbyFallback() {
  return (
    <header className="flex items-center justify-between border-b border-line px-4 py-3">
      <Logo />
      <span className="text-muted">Loading…</span>
    </header>
  );
}

async function Lobby() {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/lobby");
  if (!player.home) redirect("/onboarding");

  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-xl items-center gap-2.5 px-4 py-3">
          <Logo />
          <span className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-2 px-3.5 font-bold" aria-label={`${player.coins} coins`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2.4" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
            </svg>
            {player.coins.toLocaleString("en-NG")}
          </span>
          <form action={logOut}>
            <button type="submit" className="h-10 rounded-xl border-[1.5px] border-line px-3 text-sm text-muted hover:border-muted hover:text-paper">
              Log out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pb-10 pt-5">
        <section className="flex items-center gap-3">
          <div className="flex size-13 shrink-0 items-end justify-center overflow-hidden rounded-2xl bg-map">
            <HunterFigure look={player.look} width={30} label={`${player.username}'s hunter`} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] text-muted">Welcome back, hunter</span>
            <span className="break-all font-display text-[22px] font-extrabold leading-tight">{player.username}</span>
          </div>
        </section>

        <LobbyBody player={player} />

        {player.isAdmin && (
          <Link href="/admin" className="self-start text-sm font-bold text-gold hover:underline">
            Owner tools: create and publish hunts →
          </Link>
        )}
      </main>
    </>
  );
}

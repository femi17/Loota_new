import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { HunterFigure } from "@/components/HunterFigure";
import { ChestArt } from "@/components/ChestArt";
import { Countdown } from "@/components/Countdown";
import { getPlayer } from "@/lib/player";
import { listHunts } from "@/lib/hunts";
import { logOut } from "../(auth)/actions";
import { joinHunt } from "./actions";

const PHASE_LABEL = { draft: "Draft", upcoming: "Coming up", live: "Live now", ended: "Ended" } as const;

const when = (iso: string) =>
  `${new Date(iso).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" })} (Lagos time)`;

/** Live first, then coming up, then ended. */
const ORDER = { live: 0, upcoming: 1, draft: 2, ended: 3 } as const;

async function HuntList() {
  const hunts = (await listHunts()).sort((x, y) => ORDER[x.phase] - ORDER[y.phase]);
  if (!hunts.length) {
    return (
      <section className="flex items-center gap-4 rounded-3xl border-[1.5px] border-dashed border-line p-6">
        <ChestArt size={72} glow={false} />
        <div>
          <h2 className="font-display text-2xl font-extrabold">No hunts live yet</h2>
          <p className="mt-1 text-muted">The next hunt will appear here with its prize, keys and start time.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-4" aria-label="Hunts">
      {hunts.map((h) => {
        const live = h.phase === "live";
        const action = h.phase === "ended" ? null : h.joined ? (
          <Link href={`/play?hunt=${h.id}`} className="flex h-14 w-full items-center justify-center rounded-2xl bg-gold text-lg font-extrabold text-ink hover:bg-gold-hover">
            {live ? "Continue the hunt" : "You're in · enter the map"}
          </Link>
        ) : (
          <form action={joinHunt}>
            <input type="hidden" name="hunt" value={h.id} />
            <button type="submit" className="h-14 w-full rounded-2xl bg-gold text-lg font-extrabold text-ink hover:bg-gold-hover">
              {live ? "Join the hunt" : "Join this hunt"}
            </button>
          </form>
        );
        return (
          <article
            key={h.id}
            className={`relative flex flex-col gap-4 overflow-hidden rounded-3xl p-6 ${live ? "bg-[radial-gradient(ellipse_at_90%_0%,#4A3510_0%,#182033_60%)] ring-[1.5px] ring-gold" : "bg-ink-2"}`}
          >
            {live && (
              <div className="pointer-events-none absolute -right-4 -top-2 opacity-90">
                <ChestArt size={110} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wider ${live ? "bg-danger text-paper" : "bg-line text-paper"}`}>
                {live && <span className="loota-live-dot size-1.5 rounded-full bg-paper" aria-hidden="true" />}
                {PHASE_LABEL[h.phase]}
              </span>
            </div>
            <div className="max-w-[75%]">
              <h2 className="font-display text-2xl font-extrabold leading-tight">{h.title}</h2>
              {h.description && <p className="mt-1 text-sm text-muted">{h.description}</p>}
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-ink/60 p-2.5">
                <dt className="text-xs text-muted">Keys</dt>
                <dd className="font-display text-xl font-extrabold">🗝 {h.keys}</dd>
              </div>
              <div className="rounded-2xl bg-ink/60 p-2.5">
                <dt className="text-xs text-muted">Hunters</dt>
                <dd className="font-display text-xl font-extrabold">{h.players}</dd>
              </div>
              <div className="rounded-2xl bg-ink/60 p-2.5">
                <dt className="text-xs text-muted">{live ? "Ends in" : h.phase === "upcoming" ? "Starts in" : "Ended"}</dt>
                <dd className="font-display text-xl font-extrabold">
                  {h.phase === "ended" ? "✓" : <Countdown to={live ? h.endsAt : h.startsAt} fallback="…" />}
                </dd>
              </div>
            </dl>
            <p className="flex items-center gap-2 rounded-2xl bg-gold/10 px-4 py-3 text-sm">
              <span aria-hidden="true">🏆</span>
              <span>
                <span className="text-muted">Prize: </span>
                <b>{h.prize}</b>
                <span className="text-muted"> · {h.winners} winner{h.winners === 1 ? "" : "s"}</span>
              </span>
            </p>
            <p className="text-xs text-muted">
              {h.phase === "upcoming" ? `Starts ${when(h.startsAt)}` : live ? `Ends ${when(h.endsAt)}` : `Ended ${when(h.endsAt)}`}
            </p>
            {action}
          </article>
        );
      })}
    </section>
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
    <header className="flex items-center justify-between border-b border-line px-6 py-4">
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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
          <Logo />
          <span className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-ink-2 px-4 font-bold">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2.2" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
            </svg>
            {player.coins.toLocaleString("en-NG")} coins
          </span>
          <form action={logOut}>
            <button type="submit" className="h-10 rounded-xl border-[1.5px] border-line px-4 text-sm hover:border-muted">
              Log out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <section className="flex items-center gap-4">
          <div className="flex size-16 shrink-0 items-end justify-center overflow-hidden rounded-2xl bg-map">
            <HunterFigure look={player.look} width={36} label={`${player.username}'s hunter`} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm text-muted">Welcome back, hunter</span>
            <h1 className="break-all font-display text-xl font-extrabold leading-tight sm:text-2xl">{player.username}</h1>
          </div>
          <Link href="/look" className="inline-flex h-10 shrink-0 items-center rounded-xl border-[1.5px] border-line px-3 text-sm font-bold hover:border-muted">
            Change look
          </Link>
        </section>

        <HuntList />

        <Link href="/play" className="flex items-center gap-4 rounded-3xl bg-ink-2 p-5 hover:bg-line">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ink text-2xl" aria-hidden="true">🗺️</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-display text-lg font-extrabold">Free roam</span>
            <span className="text-sm text-muted">Explore from home: the Lamp&apos;s Detours, roadside games, rides.</span>
          </span>
          <span className="inline-flex h-11 shrink-0 items-center rounded-xl border-[1.5px] border-gold px-4 font-bold text-gold">Play</span>
        </Link>
        {player.isAdmin && (
          <Link href="/admin" className="self-start text-sm font-bold text-gold hover:underline">
            Owner tools: create and publish hunts →
          </Link>
        )}
      </main>
    </>
  );
}

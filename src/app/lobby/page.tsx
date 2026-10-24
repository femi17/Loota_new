import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { HunterFigure } from "@/components/HunterFigure";
import { getPlayer } from "@/lib/player";
import { listHunts } from "@/lib/hunts";
import { logOut } from "../(auth)/actions";
import { joinHunt } from "./actions";

const PHASE_LABEL = { draft: "Draft", upcoming: "Coming up", live: "Live now", ended: "Ended" } as const;

const when = (iso: string) =>
  `${new Date(iso).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" })} (Lagos time)`;

async function HuntList() {
  const hunts = await listHunts();
  if (!hunts.length) {
    return (
      <section className="rounded-3xl border-[1.5px] border-dashed border-line p-6">
        <h2 className="font-display text-2xl font-extrabold">No hunts live yet</h2>
        <p className="mt-2 text-muted">The next hunt will appear here with its prize, keys and start time.</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-2xl font-extrabold">Hunts</h2>
      {hunts.map((h) => (
        <article key={h.id} className={`flex flex-col gap-3 rounded-3xl bg-ink-2 p-6 ${h.phase === "live" ? "border-[1.5px] border-gold" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${h.phase === "live" ? "bg-gold text-ink" : "bg-line text-paper"}`}>
              {PHASE_LABEL[h.phase]}
            </span>
            <span className="text-sm text-muted">
              {h.keys} key{h.keys === 1 ? "" : "s"} · {h.winners} winner{h.winners === 1 ? "" : "s"} · {h.players} hunter{h.players === 1 ? "" : "s"}
            </span>
          </div>
          <h3 className="font-display text-xl font-extrabold">{h.title}</h3>
          <p className="text-sm">
            <span className="text-muted">Prize: </span>
            <b>{h.prize}</b>
          </p>
          {h.description && <p className="text-sm text-muted">{h.description}</p>}
          <p className="text-sm text-muted">
            {h.phase === "upcoming" ? `Starts ${when(h.startsAt)}` : h.phase === "live" ? `Ends ${when(h.endsAt)}` : `Ended ${when(h.endsAt)}`}
          </p>
          {h.phase !== "ended" &&
            (h.joined ? (
              <Link href={`/play?hunt=${h.id}`} className="inline-flex h-12 items-center self-start rounded-2xl bg-gold px-6 font-bold text-ink">
                {h.phase === "live" ? "Continue the hunt" : "You're in · enter the map"}
              </Link>
            ) : (
              <form action={joinHunt}>
                <input type="hidden" name="hunt" value={h.id} />
                <button type="submit" className="h-12 rounded-2xl bg-gold px-6 font-bold text-ink">
                  Join this hunt
                </button>
              </form>
            ))}
        </article>
      ))}
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
        <section className="flex flex-wrap items-center gap-6 rounded-3xl bg-ink-2 p-6">
          <div className="flex size-24 items-end justify-center overflow-hidden rounded-2xl bg-map">
            <HunterFigure look={player.look} width={52} label={`${player.username}'s hunter`} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Welcome, hunter</span>
            <h1 className="font-display text-3xl font-extrabold">{player.username}</h1>
            <span className="text-sm text-muted">
              Ready to hunt from home
            </span>
          </div>
          <Link
            href="/look"
            className="ml-auto inline-flex h-11 items-center rounded-xl border-[1.5px] border-line px-4 text-sm font-bold hover:border-muted"
          >
            Change look
          </Link>
        </section>

        <Link
          href="/play"
          className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border-[1.5px] border-gold bg-ink-2 p-6 hover:bg-line"
        >
          <span className="flex flex-col gap-1">
            <span className="font-display text-2xl font-extrabold">Enter the map</span>
            <span className="text-muted">Start from home and explore the real map with your hunter.</span>
          </span>
          <span className="inline-flex h-12 items-center rounded-2xl bg-gold px-6 font-bold text-ink">Play</span>
        </Link>

        <HuntList />
        {player.isAdmin && (
          <Link href="/admin" className="self-start text-sm font-bold text-gold hover:underline">
            Owner tools: create and publish hunts →
          </Link>
        )}
      </main>
    </>
  );
}

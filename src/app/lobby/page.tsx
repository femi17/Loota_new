import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { HunterFigure } from "@/components/HunterFigure";
import { getPlayer } from "@/lib/player";
import { logOut } from "../(auth)/actions";

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
              Home set at {player.home.lat.toFixed(3)}, {player.home.lng.toFixed(3)}
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

        <section className="rounded-3xl border-[1.5px] border-dashed border-line p-6">
          <h2 className="font-display text-2xl font-extrabold">No hunts live yet</h2>
          <p className="mt-2 text-muted">
            The next hunt will appear here with its prize, keys and start time.
          </p>
        </section>
      </main>
    </>
  );
}

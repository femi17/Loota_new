import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { GameMap } from "@/components/game/GameMap";
import { getPlayer } from "@/lib/player";
import { listHunts, pickHunt } from "@/lib/hunts";

export const metadata: Metadata = { title: "Map · Loota" };

const HIDDEN_HUNT_COOKIE = "loota_hidden_hunt";

export default function PlayPage({ searchParams }: { searchParams: Promise<{ hunt?: string | string[] }> }) {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center text-muted">Loading the map…</div>}>
      <Play searchParams={searchParams} />
    </Suspense>
  );
}

async function Play({ searchParams }: { searchParams: Promise<{ hunt?: string | string[] }> }) {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/play");
  if (!player.home) redirect("/onboarding");
  const { hunt: wanted } = await searchParams;
  const asked = typeof wanted === "string";
  const hunt = pickHunt(await listHunts(), asked ? wanted : undefined);
  // The player hid this hunt's panel (it comes back from the lobby's "Continue the hunt").
  const hidden = !asked && !!hunt && (await cookies()).get(HIDDEN_HUNT_COOKIE)?.value === hunt.id;
  const start = player.position ?? player.home;
  return (
    <GameMap
      playerId={player.id}
      username={player.username}
      look={player.look}
      start={{ lng: start.lng, lat: start.lat }}
      startMode={player.position?.mode ?? "walk"}
      initialCoins={player.coins}
      huntId={hunt?.id ?? null}
      huntHidden={hidden}
      huntAsked={asked}
    />
  );
}

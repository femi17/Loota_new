import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { GameMap } from "@/components/game/GameMap";
import { getPlayer } from "@/lib/player";
import { listHunts, pickHunt } from "@/lib/hunts";
import { createClient } from "@/lib/supabase/server";

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
  const hunts = await listHunts();
  const hunt = pickHunt(hunts, asked ? wanted : undefined);
  // A live hunt the player isn't in: an invitation on the map.
  const open = hunt ? null : (hunts.find((h) => h.phase === "live" && !h.joined) ?? null);
  // New here (welcomed with coins at onboarding): the welcome tour on the map, once on each device.
  const { data: welcomed } = await (await createClient())
    .from("coin_transactions")
    .select("id")
    .eq("reference", `welcome:${player.id}`)
    .maybeSingle();
  const newcomer = !!welcomed;
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
      openHunt={open ? { id: open.id, title: open.title, keys: open.keys, prize: open.prize } : null}
      newcomer={newcomer}
      hasDetector={player.detector}
      huntClock={hunt ? { startsAt: hunt.startsAt, endsAt: hunt.endsAt } : open ? { startsAt: open.startsAt, endsAt: open.endsAt } : null}
    />
  );
}

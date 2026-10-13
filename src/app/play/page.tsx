import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { GameMap } from "@/components/game/GameMap";
import { getPlayer } from "@/lib/player";

export const metadata: Metadata = { title: "Map · Loota" };

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center text-muted">Loading the map…</div>}>
      <Play />
    </Suspense>
  );
}

async function Play() {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/play");
  if (!player.home) redirect("/onboarding");
  return <GameMap look={player.look} home={player.home} />;
}

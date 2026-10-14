import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlayer } from "@/lib/player";
import { listHunts } from "@/lib/hunts";
import { BroadcastMap } from "@/components/broadcast/BroadcastMap";

export const metadata: Metadata = { title: "Broadcast · Loota" };

type SearchParams = Promise<{ hunt?: string | string[] }>;

/** The live show's spectator screen (design doc 11), for the owner to capture into the YouTube stream. */
export default function BroadcastPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center bg-ink text-muted">Loading the broadcast…</div>}>
      <Broadcast searchParams={searchParams} />
    </Suspense>
  );
}

async function Broadcast({ searchParams }: { searchParams: SearchParams }) {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/broadcast");
  if (!player.isAdmin) redirect("/lobby");
  const { hunt: wanted } = await searchParams;
  const hunts = (await listHunts()).filter((h) => h.phase !== "draft");
  const hunt = hunts.find((h) => h.id === wanted) ?? hunts.find((h) => h.phase === "live") ?? hunts[0];
  if (!hunt) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-ink p-6 text-center">
        <p>There&apos;s no published hunt to broadcast yet.</p>
        <Link href="/admin" className="font-bold text-gold">
          Create one in Owner tools
        </Link>
      </div>
    );
  }
  return <BroadcastMap huntId={hunt.id} />;
}

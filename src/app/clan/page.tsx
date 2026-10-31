import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getPlayer } from "@/lib/player";
import { ClanPanel } from "./ClanPanel";

export const metadata: Metadata = { title: "Your clan · Loota" };

export default function ClanPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-xl items-center gap-4 px-4 py-4">
          <Logo />
          <Link href="/lobby" className="ml-auto text-sm font-bold text-gold hover:underline">
            Lobby →
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <Clan searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function Clan({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/clan");
  if (!player.home) redirect("/onboarding");
  const invite = (await cookies()).get("loota_invite")?.value ?? null;
  const { welcome } = await searchParams;
  return <ClanPanel inviteCode={invite && /^[0-9A-Fa-f]{8}$/.test(invite) ? invite.toUpperCase() : null} welcome={welcome === "1"} />;
}

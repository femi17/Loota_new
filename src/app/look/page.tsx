import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getPlayer } from "@/lib/player";
import { LookForm } from "./LookForm";

export const metadata: Metadata = { title: "Change your look · Loota" };

export default function LookPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-4">
        <div className="w-full max-w-md">
          <Suspense fallback={<p className="text-muted">Loading your hunter…</p>}>
            <Look />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

async function Look() {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/look");
  return <LookForm initialLook={player.look} />;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { FormMessage } from "@/components/FormField";
import { getPlayer } from "@/lib/player";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailReady, maskEmail } from "@/lib/prize";
import { CheckCode } from "./CheckCode";
import { resendPrizeEmail } from "./actions";

export const metadata: Metadata = { title: "Prizes · Owner tools · Loota" };

type Search = Promise<{ message?: string; error?: string }>;

export default function PrizesPage({ searchParams }: { searchParams: Search }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
          <Logo />
          <span className="text-muted">Prizes</span>
          <Link href="/admin" className="ml-auto text-sm font-bold text-gold">
            Back to owner tools
          </Link>
        </div>
      </header>
      <Suspense fallback={<p className="p-6 text-muted">Loading…</p>}>
        <Prizes searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const lagos = (iso: string) => new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

/** An ISO time n days ago (read per request: the page is dynamic). */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

type Winner = { hunt: string; title: string; prize: string; user: string; name: string; place: number; finishedAt: string; emailedAt: string | null; emailTo: string | null; paidAt: string | null; paidNote: string | null };

/**
 * The winners and their prizes (owner, 23 Nov 2026: an email with a code when a hunter gets every key, and the code
 * checked against the database before paying). Winners of the last 60 days, newest first.
 */
async function Prizes({ searchParams }: { searchParams: Search }) {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/admin/prizes");
  if (!player.isAdmin) redirect("/lobby");
  const { message, error } = await searchParams;
  const db = createAdminClient();
  const since = daysAgo(60);
  const { data: hunts } = await db.from("hunts").select("id, title, prize, winners").gte("ends_at", since);
  const byId = new Map((hunts ?? []).map((h) => [h.id as string, h]));
  const ids = [...byId.keys()];
  const [{ data: finishers }, { data: claims }] = ids.length
    ? await Promise.all([
        db.from("hunt_players").select("hunt_id, user_id, place, finished_at").in("hunt_id", ids).not("finished_at", "is", null).lte("place", 1000),
        db.from("prize_claims").select("hunt_id, user_id, emailed_at, email_to, paid_at, paid_note").in("hunt_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const won = (finishers ?? []).filter((f) => f.place != null && f.place <= (byId.get(f.hunt_id)?.winners ?? 0));
  const { data: names } = won.length ? await db.from("profiles").select("id, username").in("id", [...new Set(won.map((w) => w.user_id))]) : { data: [] };
  const nameOf = new Map((names ?? []).map((n) => [n.id as string, n.username as string]));
  const claimOf = new Map((claims ?? []).map((c) => [`${c.hunt_id}:${c.user_id}`, c]));
  const winners: Winner[] = won
    .map((w) => {
      const h = byId.get(w.hunt_id)!;
      const c = claimOf.get(`${w.hunt_id}:${w.user_id}`);
      return {
        hunt: w.hunt_id,
        title: h.title,
        prize: h.prize,
        user: w.user_id,
        name: nameOf.get(w.user_id) ?? "?",
        place: w.place,
        finishedAt: w.finished_at,
        emailedAt: c?.emailed_at ?? null,
        emailTo: c?.email_to ?? null,
        paidAt: c?.paid_at ?? null,
        paidNote: c?.paid_note ?? null,
      };
    })
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <FormMessage error={error} message={message} />
      {!emailReady() && (
        <p role="alert" className="rounded-xl border border-danger/60 bg-danger/10 px-4 py-3 text-sm text-danger-text">
          Emails aren&apos;t set up yet, so winners get no code. Create a free account at resend.com, verify playloota.com there, and add its API key to
          Vercel as RESEND_API_KEY (and EMAIL_REPLY_TO: the address winners reply to). Then use “Send the email” below for anyone who missed it.
        </p>
      )}
      <section className="flex flex-col gap-4 rounded-3xl bg-ink-2 p-6">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Check a prize code</h1>
          <p className="text-sm text-muted">Paste the code a winner replied with. It&apos;s checked against the one we emailed them (only a fingerprint of it is stored).</p>
        </div>
        <CheckCode />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-extrabold">Winners (last 60 days)</h2>
        {winners.length === 0 && <p className="text-muted">No winners yet.</p>}
        {winners.map((w) => (
          <div key={`${w.hunt}:${w.user}`} className="flex flex-wrap items-center gap-3 rounded-2xl border-[1.5px] border-line p-4 text-sm" data-winner={w.name}>
            <div className="min-w-0 flex-1">
              <p>
                <b>{w.name}</b> · place {w.place} in <b>{w.title}</b> · {w.prize}
              </p>
              <p className="text-muted">
                Finished {lagos(w.finishedAt)} · {w.emailedAt ? `code emailed to ${maskEmail(w.emailTo ?? "")} ${lagos(w.emailedAt)}` : "no email sent yet"} ·{" "}
                {w.paidAt ? `paid ${lagos(w.paidAt)}${w.paidNote ? ` (${w.paidNote})` : ""}` : "not paid"}
              </p>
            </div>
            {!w.paidAt && (
              <form action={resendPrizeEmail}>
                <input type="hidden" name="hunt" value={w.hunt} />
                <input type="hidden" name="user" value={w.user} />
                <input type="hidden" name="again" value={w.emailedAt ? "1" : "0"} />
                <button type="submit" className="h-10 rounded-xl border-[1.5px] border-gold px-4 font-bold">
                  {w.emailedAt ? "Send a new code" : "Send the email"}
                </button>
              </form>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}

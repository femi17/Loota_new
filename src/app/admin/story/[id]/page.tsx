import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getPlayer } from "@/lib/player";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignmentOf, blueprintOf, costOf, verdict, type Work } from "@/lib/story/engine";

export const metadata: Metadata = { title: "Story · Owner tools · Loota" };

/** A story hunt's story, and its answers, for the owner. */
export default function StoryPage({ params }: PageProps<"/admin/story/[id]">) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-4 sm:px-6">
          <Logo />
          <Link href="/admin" className="ml-auto text-sm font-bold text-gold">
            Back to owner tools
          </Link>
        </div>
      </header>
      <Suspense fallback={<p className="p-6 text-muted">Loading…</p>}>
        <Story params={params} />
      </Suspense>
    </div>
  );
}

async function Story({ params }: { params: PageProps<"/admin/story/[id]">["params"] }) {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/admin");
  if (!player.isAdmin) redirect("/lobby");
  const { id } = await params;
  const { data } = await createAdminClient().from("hunts").select("title, story, story_status").eq("id", id).maybeSingle();
  const work = data?.story as Work | null;
  if (!work?.skeleton) return <p className="p-6 text-muted">This hunt has no story yet.</p>;
  const b = blueprintOf(work);
  const v = verdict(work);
  const assignment = assignmentOf(work);
  const tick = (ok: boolean) => (ok ? <b className="text-ok">✓</b> : <b className="text-danger-text">✗</b>);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wider text-gold">
          {work.picked?.genre} · {work.keys} keys{work.done ? "" : " · still being written"}
        </p>
        <h1 className="font-display text-4xl font-extrabold leading-tight">{b.title}</h1>
        <p className="text-lg text-muted">{b.logline}</p>
      </div>

      {work.done && (
        <section className="flex flex-col gap-1 rounded-2xl bg-ink-2 p-4 text-sm">
          <p>{tick(v.codes)} Codes decode exactly</p>
          <p>{tick(v.answersOnMap)} Every answer is on the map</p>
          <p>{tick(v.noLeaks)} No key place named in the story</p>
          <p>{tick(v.aiFailsWithout)} An AI with the story alone can&apos;t find the places</p>
          <p>{tick(v.aiSolvesWith)} An AI with the story and the live pieces can (it&apos;s fair)</p>
          <p className="mt-2 text-xs text-muted">Cost: {costOf(work).join("; ")}</p>
        </section>
      )}

      <section className="flex flex-col gap-6">
        <h2 className="font-display text-2xl font-extrabold">The story</h2>
        {b.chapters.map((c) => (
          <article key={c.n} className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-extrabold">{c.title}</h3>
            <p className="text-xs font-bold uppercase tracking-wider text-gold">{c.setting}</p>
            {(work.chapters[c.n]?.text ?? "Not written yet.").split(/\n\s*\n/).map((p, i) => (
              <p key={i} className="leading-relaxed text-paper/90">
                {p}
              </p>
            ))}
          </article>
        ))}
      </section>

      <section className="flex flex-col gap-4 rounded-3xl border-[1.5px] border-danger p-5">
        <h2 className="font-display text-2xl font-extrabold">🔐 The answers (don&apos;t share)</h2>
        {b.keys.map((k) => {
          const a = assignment.find((x) => x.n === k.n);
          const m = work.map[k.n];
          return (
            <div key={k.n} className="flex flex-col gap-2 rounded-2xl bg-ink-2 p-4 text-sm">
              <p className="font-bold">
                🗝️ {k.n}. {k.question}
              </p>
              <p className="w-fit rounded-lg bg-ok/15 px-2 py-1 font-bold text-ok">
                {k.answer.name} · {k.answer.city}, {k.answer.country}
              </p>
              {a && (
                <p className="text-muted">
                  Lock: {a.lock.name} · Live piece: {a.channel.name}
                  {a.channel.game === "to-build" ? " (game feature to build)" : ""}
                </p>
              )}
              {k.livePiece && (
                <p className="rounded-lg bg-ink p-2">
                  <b>The live piece</b> ({k.livePiece.where}; {k.livePiece.when}): {k.livePiece.content}
                </p>
              )}
              {k.solveSteps && (
                <ol className="list-decimal pl-5 text-muted">
                  {k.solveSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              )}
              <p className="text-xs text-muted">
                Map: {m?.found ? `found (${m.found.name})` : "not checked yet"} · {work.decoys[k.n]?.length ?? 0} decoys
                {m ? `, ${m.decoys.filter((d) => d.ok).length} found on the map` : ""}
              </p>
            </div>
          );
        })}
      </section>

      {work.production && (
        <section className="flex flex-col gap-2 text-sm">
          <h2 className="font-display text-2xl font-extrabold">🎙️ Voices (ElevenLabs)</h2>
          {work.production.voices.map((x) => (
            <p key={x.name}>
              <b>{x.name}:</b> <span className="text-muted">{x.direction}</span>
            </p>
          ))}
        </section>
      )}
    </main>
  );
}

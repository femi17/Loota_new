import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { FormMessage } from "@/components/FormField";
import { getPlayer } from "@/lib/player";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStoryHunt, setPublished } from "./actions";
import { dayName, lagosDay, nextHuntDay } from "./huntDay";
import { StoryPictures } from "./StoryPictures";
import { StoryProgress } from "./StoryProgress";
import { StoryWaiting } from "./StoryWaiting";
import { StoryTrailer } from "./StoryTrailer";
import { CreateButton } from "./CreateButton";
import { TrailerScript, type Trailer } from "./TrailerScript";
import { DeleteHunt } from "./DeleteHunt";

export const metadata: Metadata = { title: "Owner tools · Loota" };

type SearchParams = Promise<{ message?: string; error?: string }>;

export default function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
          <Logo />
          <span className="text-muted">Owner tools</span>
          <Link href="/lobby" className="ml-auto text-sm font-bold text-gold">
            Back to the lobby
          </Link>
        </div>
      </header>
      <Suspense fallback={<p className="p-6 text-muted">Loading…</p>}>
        <Admin searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type HuntRow = {
  id: string;
  title: string;
  prize: string;
  winners: number;
  starts_at: string;
  ends_at: string;
  published: boolean;
  hunt_keys: { count: number }[];
  hunt_players: { count: number }[];
  /** A story hunt: writing, ready or failed (null: made by hand). */
  story_status: "waiting" | "writing" | "ready" | "failed" | null;
  keys_wanted: number | null;
  story_pictures: { n: number; chapter: number; prompt: string; path: string | null }[];
  /** The story's trailer in Storage (bucket story-trailers), shown in the lobby. */
  trailer_path: string | null;
  /** The trailer's voice-over script and voices, from the story (not the whole story: it holds the answers). */
  trailer: Trailer | null;
  voices: { name: string; direction: string }[] | null;
};

/** Where a hunt is in its life, read per request (the page is dynamic). */
function huntStatus(h: { published: boolean; starts_at: string; ends_at: string }) {
  const now = Date.now();
  if (Date.parse(h.ends_at) <= now) return "finished";
  if (!h.published) return "draft";
  return Date.parse(h.starts_at) > now ? "upcoming" : "live";
}
const STATUS = { live: "● Live", upcoming: "Coming up", draft: "Draft", finished: "Finished" } as const;
/** A story picture's public address in Storage. */
const pictureUrl = (path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/story-pictures/${path}`;
const trailerUrl = (path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/story-trailers/${path}`;

const field = "h-11 rounded-xl border-[1.5px] border-line bg-ink px-3 text-paper outline-none focus:border-gold";
const lagos = (iso: string) =>
  new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

async function Admin({ searchParams }: { searchParams: SearchParams }) {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/admin");
  if (!player.isAdmin) redirect("/lobby");
  const { message, error } = await searchParams;

  const { data } = await createAdminClient()
    .from("hunts")
    .select("id, title, prize, winners, starts_at, ends_at, published, story_status, keys_wanted, trailer_path, trailer:story->production->trailer, voices:story->production->voices, hunt_keys(count), hunt_players(count), story_pictures(n, chapter, prompt, path)")
    .order("starts_at", { ascending: false });
  const hunts = (data ?? []) as HuntRow[];
  // Live first, then coming up, drafts, and the finished ones folded away (owner, 31 Oct 2026: tidy the admin).
  const status = huntStatus;
  const groups = [
    { label: "Live now", hunts: hunts.filter((h) => status(h) === "live"), open: true },
    { label: "Coming up", hunts: hunts.filter((h) => status(h) === "upcoming"), open: true },
    { label: "Drafts", hunts: hunts.filter((h) => status(h) === "draft"), open: true },
    { label: "Finished", hunts: hunts.filter((h) => status(h) === "finished"), open: false },
  ];
  // One hunt a day, 9 am to 9 pm Lagos, made before 9 am on its day (owner, 31 Oct 2026).
  const day = nextHuntDay();
  const nextDay = dayName(day);
  const taken = hunts.find((h) => lagosDay(Date.parse(h.starts_at)) === day);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <FormMessage error={error} message={message} />

      {/* Only the keys, the prize and the winners (owner, 31 Oct 2026); Claude Code writes the story, title and description. */}
      <section className="flex flex-col gap-4 rounded-3xl bg-ink-2 p-6">
        <div>
          <h1 className="font-display text-2xl font-extrabold">New story hunt</h1>
          {taken ? (
            <p className="text-sm text-muted" aria-label="Next hunt made">
              <b className="text-paper">{nextDay}</b> has its hunt: {taken.title}. One hunt a day: the next day opens at 9 am on {nextDay}.
            </p>
          ) : (
            <p className="text-sm text-muted">
              The next hunt is on <b className="text-paper">{nextDay}, 9 am to 9 pm</b> (Lagos time). Set the keys and the prize; then give the request on the
              hunt&apos;s card to Claude Code, which writes the story, its title and description, and hides the keys in it.
            </p>
          )}
        </div>
        {!taken && (
        <form action={createStoryHunt} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Keys">
            <input name="keys" type="number" min={1} max={30} defaultValue={5} required className={field} />
          </Field>
          <Field label="Prize">
            <input name="prize" required minLength={2} maxLength={200} className={field} placeholder="₦50,000 voucher" />
          </Field>
          <Field label="Winners">
            <input name="winners" type="number" min={1} max={1000} defaultValue={3} required className={field} />
          </Field>
          <CreateButton />
        </form>
        )}
      </section>

      {hunts.length === 0 && <p className="text-center text-muted">No hunts yet. Create one above.</p>}
      {groups.map((g) =>
        g.hunts.length === 0 ? null : (
          <details key={g.label} open={g.open} className="group/list">
            <summary className="cursor-pointer list-none font-display text-lg font-extrabold [&::-webkit-details-marker]:hidden">
              <span className="inline-block transition-transform group-open/list:rotate-90">›</span> {g.label} <span className="text-muted">({g.hunts.length})</span>
            </summary>
            <div className="mt-4 flex flex-col gap-6">
              {g.hunts.map((h) => {
                const keys = h.hunt_keys[0]?.count ?? 0;
                const players = h.hunt_players[0]?.count ?? 0;
                return (
                  <section key={h.id} className="flex flex-col gap-4 rounded-3xl border-[1.5px] border-line p-6">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          status(h) === "live" ? "bg-danger text-white" : status(h) === "upcoming" ? "bg-gold text-ink" : "bg-line"
                        }`}
                      >
                        {STATUS[status(h)]}
                      </span>
                      <h2 className="font-display text-xl font-extrabold">{h.title}</h2>
                      <div className="ml-auto flex gap-2">
                        {h.published && status(h) !== "finished" && (
                          <Link
                            href={`/broadcast?hunt=${h.id}`}
                            target="_blank"
                            className="flex h-10 items-center rounded-xl bg-danger px-4 text-sm font-bold text-white"
                          >
                            ● Broadcast
                          </Link>
                        )}
                        {status(h) !== "finished" && h.story_status !== "waiting" && h.story_status !== "writing" && h.story_status !== "failed" && (
                          <form action={setPublished}>
                            <input type="hidden" name="hunt" value={h.id} />
                            <input type="hidden" name="publish" value={String(!h.published)} />
                            <button type="submit" className="h-10 rounded-xl border-[1.5px] border-gold px-4 text-sm font-bold">
                              {h.published ? "Unpublish" : "Publish"}
                            </button>
                          </form>
                        )}
                        {status(h) !== "live" && <DeleteHunt hunt={h.id} title={h.title} />}
                      </div>
                    </div>
                    <p className="text-sm text-muted">
                      Prize: {h.prize} · {h.winners} winners · {lagos(h.starts_at)} to {lagos(h.ends_at)} · {keys || h.keys_wanted || 0} keys · {players} hunters joined
                    </p>

                    {h.story_status === "waiting" && <StoryWaiting hunt={h.id} keys={h.keys_wanted ?? 5} />}
                    {(h.story_status === "writing" || h.story_status === "failed") && <StoryProgress hunt={h.id} status={h.story_status} />}
                    {h.story_status === "ready" && (
                      <>
                        <Link href={`/admin/story/${h.id}`} className="flex h-11 w-fit items-center rounded-xl border-[1.5px] border-gold px-4 text-sm font-bold">
                          📖 Read the story and its answers
                        </Link>
                        {h.story_pictures.length > 0 && (
                          <StoryPictures
                            hunt={h.id}
                            pictures={[...h.story_pictures]
                              .sort((a, b) => a.n - b.n)
                              .map((p) => ({ n: p.n, chapter: p.chapter, prompt: p.prompt, url: p.path ? pictureUrl(p.path) : null }))}
                          />
                        )}
                        {h.trailer && <TrailerScript trailer={h.trailer} voices={h.voices ?? []} />}
                        <StoryTrailer hunt={h.id} url={h.trailer_path ? trailerUrl(h.trailer_path) : null} />
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          </details>
        ),
      )}
    </main>
  );
}

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { FormMessage } from "@/components/FormField";
import { getPlayer } from "@/lib/player";
import { createAdminClient } from "@/lib/supabase/admin";
import { CATEGORY_NAMES, type TrialCategory } from "@/game/hunt";
import { addKey, createHunt, deleteDraft, removeLastKey, setPublished } from "./actions";

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

type KeyRow = {
  n: number;
  riddle: string;
  category: TrialCategory;
  area_lng: number;
  area_lat: number;
  area_radius_m: number;
  approach_clue: string | null;
  spot_lng: number;
  spot_lat: number;
};
type HuntRow = {
  id: string;
  title: string;
  prize: string;
  winners: number;
  starts_at: string;
  ends_at: string;
  questions_per_trial: number;
  seconds_per_question: number;
  published: boolean;
  hunt_keys: KeyRow[];
  hunt_players: { count: number }[];
};

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
    .select("id, title, prize, winners, starts_at, ends_at, questions_per_trial, seconds_per_question, published, hunt_keys(*), hunt_players(count)")
    .order("starts_at", { ascending: false });
  const hunts = (data ?? []) as HuntRow[];

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <FormMessage error={error} message={message} />

      <section className="flex flex-col gap-4 rounded-3xl bg-ink-2 p-6">
        <h1 className="font-display text-2xl font-extrabold">Create a hunt</h1>
        <form action={createHunt} className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <input name="title" required minLength={3} maxLength={80} className={field} placeholder="Lagos Island Dash" />
          </Field>
          <Field label="Prize">
            <input name="prize" required minLength={2} maxLength={200} className={field} placeholder="₦50,000 Jumia voucher" />
          </Field>
          <Field label="Description (shown in the lobby)">
            <input name="description" maxLength={1000} className={field} />
          </Field>
          <Field label="Winners" hint="The first this many hunters to collect every key win.">
            <input name="winners" type="number" min={1} max={1000} defaultValue={3} required className={field} />
          </Field>
          <Field label="Starts (Lagos time)">
            <input name="starts" type="datetime-local" required className={field} />
          </Field>
          <Field label="Ends (Lagos time)">
            <input name="ends" type="datetime-local" required className={field} />
          </Field>
          <Field label="Questions per Key Trial">
            <input name="questions" type="number" min={1} max={10} defaultValue={3} required className={field} />
          </Field>
          <Field label="Seconds per question">
            <input name="seconds" type="number" min={10} max={15} defaultValue={12} required className={field} />
          </Field>
          <button type="submit" className="h-12 rounded-2xl bg-gold font-bold text-ink sm:col-span-2">
            Create as draft
          </button>
        </form>
      </section>

      {hunts.map((h) => {
        const keys = [...h.hunt_keys].sort((a, b) => a.n - b.n);
        const players = h.hunt_players[0]?.count ?? 0;
        return (
          <section key={h.id} className="flex flex-col gap-4 rounded-3xl border-[1.5px] border-line p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${h.published ? "bg-gold text-ink" : "bg-line"}`}>
                {h.published ? "Published" : "Draft"}
              </span>
              <h2 className="font-display text-xl font-extrabold">{h.title}</h2>
              <div className="ml-auto flex gap-2">
                {h.published && (
                  <Link
                    href={`/broadcast?hunt=${h.id}`}
                    target="_blank"
                    className="flex h-10 items-center rounded-xl bg-danger px-4 text-sm font-bold text-white"
                  >
                    ● Broadcast
                  </Link>
                )}
                <form action={setPublished}>
                  <input type="hidden" name="hunt" value={h.id} />
                  <input type="hidden" name="publish" value={String(!h.published)} />
                  <button type="submit" className="h-10 rounded-xl border-[1.5px] border-gold px-4 text-sm font-bold">
                    {h.published ? "Unpublish" : "Publish"}
                  </button>
                </form>
                {!h.published && players === 0 && (
                  <form action={deleteDraft}>
                    <input type="hidden" name="hunt" value={h.id} />
                    <button type="submit" className="h-10 rounded-xl border-[1.5px] border-line px-4 text-sm">
                      Delete
                    </button>
                  </form>
                )}
              </div>
            </div>
            <p className="text-sm text-muted">
              Prize: {h.prize} · {h.winners} winners · {lagos(h.starts_at)} to {lagos(h.ends_at)} · {h.questions_per_trial} questions ×{" "}
              {h.seconds_per_question} s · {players} hunters joined
            </p>

            <ol className="flex flex-col gap-2">
              {keys.map((k) => (
                <li key={k.n} className="rounded-2xl bg-ink-2 p-4 text-sm">
                  <p className="font-bold">
                    Key {k.n} · {CATEGORY_NAMES[k.category]}
                  </p>
                  <p>&ldquo;{k.riddle}&rdquo;</p>
                  {k.approach_clue && <p className="text-muted">Final approach: {k.approach_clue}</p>}
                  <p className="text-xs text-muted">
                    Area {k.area_lat.toFixed(5)}, {k.area_lng.toFixed(5)} (within {k.area_radius_m} m) · Spot{" "}
                    <a
                      className="text-gold underline"
                      href={`https://www.google.com/maps?q=${k.spot_lat},${k.spot_lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {k.spot_lat.toFixed(5)}, {k.spot_lng.toFixed(5)}
                    </a>
                  </p>
                </li>
              ))}
              {!keys.length && <li className="text-sm text-muted">No keys yet.</li>}
            </ol>

            {!h.published && (
              <>
                <form action={addKey} className="grid gap-3 rounded-2xl bg-ink-2 p-4 sm:grid-cols-2">
                  <input type="hidden" name="hunt" value={h.id} />
                  <p className="font-bold sm:col-span-2">Add key {keys.length + 1}</p>
                  <div className="sm:col-span-2">
                    <Field label="Riddle" hint="Points to an area (a landmark, district or city).">
                      <textarea name="riddle" required minLength={5} maxLength={500} rows={2} className={`${field} h-auto py-2`} />
                    </Field>
                  </div>
                  <Field label="Key Trial category">
                    <select name="category" className={field} defaultValue="maths">
                      {Object.entries(CATEGORY_NAMES).map(([value, name]) => (
                        <option key={value} value={value}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Area size (metres)" hint="Inside this, hunters get the Final Approach clue and hot/cold.">
                    <input name="radius" type="number" min={100} max={50000} defaultValue={1500} required className={field} />
                  </Field>
                  <Field label="Area centre" hint="In Google Maps, right-click the place and click the numbers to copy them.">
                    <input name="area" required placeholder="6.4541, 3.3958" className={field} />
                  </Field>
                  <Field label="Exact key spot" hint="Moved automatically onto the nearest road or path.">
                    <input name="spot" required placeholder="6.4543, 3.3961" className={field} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Final Approach clue (optional)" hint="Shown only to hunters who reach the area.">
                      <input name="clue" maxLength={300} className={field} />
                    </Field>
                  </div>
                  <button type="submit" className="h-11 rounded-xl bg-gold font-bold text-ink sm:col-span-2">
                    Add key
                  </button>
                </form>
                {keys.length > 0 && (
                  <form action={removeLastKey}>
                    <input type="hidden" name="hunt" value={h.id} />
                    <button type="submit" className="text-sm text-muted underline">
                      Remove key {keys.length}
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        );
      })}
    </main>
  );
}

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { FormMessage } from "@/components/FormField";
import { getPlayer } from "@/lib/player";
import { createAdminClient } from "@/lib/supabase/admin";
import { CATEGORY_NAMES, type TrialCategory } from "@/game/hunt";
import { KEY_SCENES, KEY_SCENE_INFO, isKeyScene } from "@/game/keyScenes";
import { wonderOf } from "@/game/wonders";
import { addKey, createHunt, removeLastKey, setKeyScene, setKeyTrap, setKeyTrial, setPublished, summonDjinn } from "./actions";
import { DeleteHunt } from "./DeleteHunt";
import { RiddleFields } from "./RiddleFields";
import { StoryEditor } from "./StoryEditor";

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

/** A key's trial (owner, 24 Oct 2026: tasks, not only questions): a quiz, one puzzle, or a puzzle at random. */
const TRIAL_KINDS = [
  ["puzzle", "A puzzle (Sentries, Route, Adire or Torn Map, at random)"],
  ["sentries", "Sentries (one per row, column and district)"],
  ["route", "Route (one path through every square)"],
  ["adire", "Adire (indigo and white cloth)"],
  ["tornmap", "Torn Map (the key's own streets, torn up)"],
  ["quiz", "Quiz (questions, in the category below)"],
] as const;
/** "Key 2", or "Key 2 · relay chest" for a stop on the way to Key 2. */
const stopLabel = (keys: { relay: boolean }[], idx: number) => {
  const key = 1 + keys.slice(0, idx).filter((k) => !k.relay).length;
  return keys[idx].relay ? `Key ${key} · relay chest` : `Key ${key}`;
};
const trialName = (kind: string) => TRIAL_KINDS.find(([k]) => k === kind)?.[1].replace(/ \(.*\)$/, "") ?? kind;

type KeyRow = {
  n: number;
  riddle: string;
  category: TrialCategory;
  trial_kind: string;
  /** A relay chest: it holds a clue to the next stop, not a key. */
  relay: boolean;
  area_lng: number;
  area_lat: number;
  area_radius_m: number;
  approach_clue: string | null;
  spot_lng: number;
  spot_lat: number;
  scene: string;
  /** The Masquerade's decoy chest, if the key has one. */
  trap_lng: number | null;
  trap_lat: number | null;
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
  hunt_story: { beat: string; lines: { who: string; text: string }[] }[];
  hunt_players: { count: number }[];
};

/** Where a hunt is in its life, read per request (the page is dynamic). */
function huntStatus(h: { published: boolean; starts_at: string; ends_at: string }) {
  const now = Date.now();
  if (Date.parse(h.ends_at) <= now) return "finished";
  if (!h.published) return "draft";
  return Date.parse(h.starts_at) > now ? "upcoming" : "live";
}
const STATUS = { live: "● Live", upcoming: "Coming up", draft: "Draft", finished: "Finished" } as const;
const nowIso = () => new Date().toISOString();

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
    .select("id, title, prize, winners, starts_at, ends_at, questions_per_trial, seconds_per_question, published, hunt_keys(*), hunt_players(count), hunt_story(beat, lines)")
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

  // The Djinn's Wager: on now (what's at stake, until when), or the next one comes by surprise.
  const { data: wager } = await createAdminClient()
    .from("djinn_wagers")
    .select("wonder, ends_at, winner")
    .gt("ends_at", nowIso())
    .is("winner", null)
    .order("ends_at")
    .limit(1)
    .maybeSingle();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <FormMessage error={error} message={message} />

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-[#2A1747] p-6 ring-1 ring-[#9B5DE5]">
        <div>
          <h2 className="font-display text-xl font-extrabold">🧞 The Djinn&apos;s Wager</h2>
          {wager ? (
            <p className="text-sm text-paper">
              A Wager is on now: {wonderOf(wager.wonder).icon} <b>{wonderOf(wager.wonder).name}</b> at stake, until {lagos(wager.ends_at)}. Nobody has won it yet.
            </p>
          ) : (
            <p className="text-sm text-muted">No Wager on. The weekly one comes by surprise (never while a hunt is live), or summon him by hand.</p>
          )}
        </div>
        {!wager && (
          <form action={summonDjinn}>
            <button type="submit" className="h-11 rounded-xl bg-[#9B5DE5] px-4 font-bold text-white">
              Summon the Djinn now
            </button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-3xl bg-ink-2 p-6">
        <h1 className="font-display text-2xl font-extrabold">Create a hunt</h1>
        <form action={createHunt} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

      {hunts.length === 0 && <p className="text-center text-muted">No hunts yet. Create one above.</p>}
      {groups.map((g) =>
        g.hunts.length === 0 ? null : (
          <details key={g.label} open={g.open} className="group/list">
            <summary className="cursor-pointer list-none font-display text-lg font-extrabold [&::-webkit-details-marker]:hidden">
              <span className="inline-block transition-transform group-open/list:rotate-90">›</span> {g.label} <span className="text-muted">({g.hunts.length})</span>
            </summary>
            <div className="mt-4 flex flex-col gap-6">
      {g.hunts.map((h) => {
        const keys = [...h.hunt_keys].sort((a, b) => a.n - b.n);
        // The story's beats: the start, after each key but the last (that's the finish), each relay chest, the finish.
        const realKeys = keys.filter((k) => !k.relay).length;
        const beats = ["start"];
        keys.forEach((k, idx) => {
          const key = 1 + keys.slice(0, idx).filter((x) => !x.relay).length;
          if (k.relay) beats.push(`relay:${key}`);
          else if (key < realKeys) beats.push(`key:${key}`);
        });
        beats.push("finish");
        const storyText = Object.fromEntries(
          (h.hunt_story ?? []).map((b) => [b.beat, b.lines.map((l) => `${l.who[0].toUpperCase()}${l.who.slice(1)}: ${l.text}`).join("\n")]),
        );
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
                {status(h) !== "finished" && (
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
              Prize: {h.prize} · {h.winners} winners · {lagos(h.starts_at)} to {lagos(h.ends_at)} · {h.questions_per_trial} questions ×{" "}
              {h.seconds_per_question} s · {players} hunters joined
            </p>

            <ol className="flex flex-col gap-2">
              {keys.map((k, idx) => (
                <li key={k.n} className="rounded-2xl bg-ink-2 p-4 text-sm">
                  <p className="font-bold">
                    {stopLabel(keys, idx)} · {k.trial_kind === "quiz" ? `Quiz: ${CATEGORY_NAMES[k.category]}` : trialName(k.trial_kind)} ·{" "}
                    {isKeyScene(k.scene) ? KEY_SCENE_INFO[k.scene].label : k.scene}
                  </p>
                  <p>&ldquo;{k.riddle}&rdquo;</p>
                  {k.approach_clue && <p className="text-muted">Final approach: {k.approach_clue}</p>}
                  <form action={setKeyScene} className="my-1 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="hunt" value={h.id} />
                    <input type="hidden" name="n" value={k.n} />
                    <label className="text-xs text-muted" htmlFor={`scene-${h.id}-${k.n}`}>
                      Its place
                    </label>
                    <select id={`scene-${h.id}-${k.n}`} name="scene" defaultValue={k.scene} className="h-9 rounded-lg bg-ink px-2 text-xs">
                      {KEY_SCENES.map((s) => (
                        <option key={s} value={s}>
                          {KEY_SCENE_INFO[s].label} · {KEY_SCENE_INFO[s].keeper.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="h-9 rounded-lg border border-line px-3 text-xs font-bold">
                      Change
                    </button>
                  </form>
                  <form action={setKeyTrial} className="my-1 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="hunt" value={h.id} />
                    <input type="hidden" name="n" value={k.n} />
                    <label className="text-xs text-muted" htmlFor={`trial-${h.id}-${k.n}`}>
                      Its trial
                    </label>
                    <select id={`trial-${h.id}-${k.n}`} name="trial" defaultValue={k.trial_kind} className="h-9 rounded-lg bg-ink px-2 text-xs">
                      {TRIAL_KINDS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="h-9 rounded-lg border border-line px-3 text-xs font-bold">
                      Change
                    </button>
                  </form>
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
                  {!k.relay && (
                    <form action={setKeyTrap} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="hunt" value={h.id} />
                      <input type="hidden" name="n" value={k.n} />
                      <input type="hidden" name="trap" value={k.trap_lng == null ? "add" : "remove"} />
                      {k.trap_lng != null && k.trap_lat != null ? (
                        <span className="text-xs text-muted">
                          🎭 Trap chest at{" "}
                          <a className="text-gold underline" href={`https://www.google.com/maps?q=${k.trap_lat},${k.trap_lng}`} target="_blank" rel="noreferrer">
                            {k.trap_lat.toFixed(5)}, {k.trap_lng.toFixed(5)}
                          </a>
                        </span>
                      ) : (
                        <span className="text-xs text-muted">🎭 No trap chest: the Masquerade could plant a decoy 180–280 m away (25 coins and 15 s dizzy for whoever opens it).</span>
                      )}
                      <button type="submit" className="h-9 rounded-lg border border-line px-3 text-xs font-bold">
                        {k.trap_lng == null ? "Add a trap chest" : "Remove the trap"}
                      </button>
                    </form>
                  )}
                </li>
              ))}
              {!keys.length && <li className="text-sm text-muted">No keys yet.</li>}
            </ol>

            {keys.length > 0 && <StoryEditor hunt={h.id} beats={beats} initial={storyText} />}

            {!h.published && (
              <>
                <form action={addKey} className="grid grid-cols-1 gap-3 rounded-2xl bg-ink-2 p-4 sm:grid-cols-2">
                  <input type="hidden" name="hunt" value={h.id} />
                  <p className="font-bold sm:col-span-2">Add stop {keys.length + 1}: a key, or a relay chest on the way to one</p>
                  <label className="flex items-start gap-2 rounded-xl bg-ink p-3 text-sm sm:col-span-2">
                    <input type="checkbox" name="relay" className="mt-1 size-4 accent-[#F4B41A]" />
                    <span>
                      <b>A relay chest</b>
                      <span className="block text-xs text-muted">
                        Its chest holds no key, only the next stop&apos;s riddle (the key is at the next stop you add). Hunters can&apos;t tell until it opens.
                      </span>
                    </span>
                  </label>
                  <RiddleFields />
                  <Field label="Key Trial" hint="A puzzle at the chest, or questions.">
                    <select name="trial" className={field} defaultValue="puzzle">
                      {TRIAL_KINDS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quiz category" hint="Only for a quiz trial.">
                    <select name="category" className={field} defaultValue="maths">
                      {Object.entries(CATEGORY_NAMES).map(([value, name]) => (
                        <option key={value} value={value}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="The key's place" hint="What the place where it's won looks like, and who asks the trial there.">
                    <select name="scene" className={field} defaultValue="auto">
                      <option value="auto">Automatic (from what&apos;s around the spot)</option>
                      {KEY_SCENES.map((s) => (
                        <option key={s} value={s}>
                          {KEY_SCENE_INFO[s].label} · {KEY_SCENE_INFO[s].keeper.name}
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
                  <button type="submit" className="h-11 rounded-xl bg-gold font-bold text-ink sm:col-span-2">
                    Add key
                  </button>
                </form>
                {keys.length > 0 && (
                  <form action={removeLastKey}>
                    <input type="hidden" name="hunt" value={h.id} />
                    <button type="submit" className="text-sm text-muted underline">
                      Remove stop {keys.length}
                    </button>
                  </form>
                )}
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

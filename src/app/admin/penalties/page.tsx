import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { FormMessage } from "@/components/FormField";
import { getPlayer } from "@/lib/player";
import { createAdminClient } from "@/lib/supabase/admin";
import { PENALTY_SCENES } from "@/game/penaltyScenes";
import { addPenalty, updatePenalty } from "./actions";

export const metadata: Metadata = { title: "Penalties · Owner tools · Loota" };

type Search = { tier?: string; effect?: string; q?: string; page?: string; retired?: string; message?: string; error?: string };
type Row = { code: string; tier: "soft" | "deep"; effect: "wait" | "coins" | "energy" | "back"; amount: number; title: string; body: string; scene: string; active: boolean };

const PER_PAGE = 40;
const field = "h-10 rounded-xl border-[1.5px] border-line bg-ink px-3 text-sm text-paper outline-none focus:border-gold";
const COST: Record<Row["effect"], string> = { wait: "Wait", coins: "Coins", energy: "Energy", back: "Back to the start" };
const unit = (r: Pick<Row, "effect" | "tier">) => (r.effect === "wait" ? "seconds" : r.effect === "coins" ? "coins" : r.effect === "energy" ? "energy" : "");

export default function PenaltiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
          <Logo />
          <span className="text-muted">Penalties</span>
          <Link href="/admin" className="ml-auto text-sm font-bold text-gold">
            Back to owner tools
          </Link>
        </div>
      </header>
      <Suspense fallback={<p className="p-6 text-muted">Loading…</p>}>
        <Penalties searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/**
 * The penalties (owner, 31 Oct 2026: "a database of penalties… 500 - 1000"): every trap the server can deal, to read,
 * reword, re-cost, retire, or add to. Deep ones are for the wrong place, soft ones for the wrong room in a house.
 */
async function Penalties({ searchParams }: { searchParams: Promise<Search> }) {
  const player = await getPlayer();
  if (!player) redirect("/login?next=/admin/penalties");
  if (!player.isAdmin) redirect("/lobby");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const db = createAdminClient();
  let query = db.from("penalties").select("code, tier, effect, amount, title, body, scene, active", { count: "exact" });
  if (sp.tier === "soft" || sp.tier === "deep") query = query.eq("tier", sp.tier);
  if (sp.effect && Object.keys(COST).includes(sp.effect)) query = query.eq("effect", sp.effect);
  if (!sp.retired) query = query.eq("active", true);
  const q = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (q) query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`);
  const { data, count } = await query.order("tier").order("code").range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  const rows = (data ?? []) as Row[];
  const [{ count: deep }, { count: soft }, { count: retired }] = await Promise.all([
    db.from("penalties").select("code", { count: "exact", head: true }).eq("tier", "deep").eq("active", true),
    db.from("penalties").select("code", { count: "exact", head: true }).eq("tier", "soft").eq("active", true),
    db.from("penalties").select("code", { count: "exact", head: true }).eq("active", false),
  ]);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE));
  const link = (extra: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tier: sp.tier, effect: sp.effect, q: sp.q, retired: sp.retired, page: String(page), ...extra })) if (v) p.set(k, v);
    return `/admin/penalties?${p}`;
  };
  const here = link({});

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <FormMessage error={sp.error} message={sp.message} />
      <section className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-extrabold">Penalties</h1>
        <p className="text-sm text-muted">
          {deep} deep (the wrong place: a hunter is caught by a trap) · {soft} soft (the wrong room in a house) · {retired} retired. The game deals one at
          random, never the same one twice in a row.
        </p>
      </section>

      <form className="grid grid-cols-2 gap-2 sm:grid-cols-5" action="/admin/penalties">
        <select name="tier" defaultValue={sp.tier ?? ""} className={field} aria-label="Kind">
          <option value="">Deep and soft</option>
          <option value="deep">Deep (wrong place)</option>
          <option value="soft">Soft (wrong room)</option>
        </select>
        <select name="effect" defaultValue={sp.effect ?? ""} className={field} aria-label="Cost">
          <option value="">Any cost</option>
          {Object.entries(COST).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search the words" className={`${field} col-span-2 sm:col-span-1`} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="retired" value="1" defaultChecked={!!sp.retired} className="size-4 accent-[#F4B41A]" /> Retired too
        </label>
        <button type="submit" className="h-10 rounded-xl bg-gold text-sm font-bold text-ink">
          Show
        </button>
      </form>

      <p className="text-sm text-muted" aria-live="polite">
        {count ?? 0} penalties{pages > 1 ? `, page ${page} of ${pages}` : ""}
      </p>
      <ol className="flex flex-col gap-3" aria-label="Penalties">
        {rows.map((r) => (
          <li key={r.code} className={`rounded-2xl bg-ink-2 p-4 ${r.active ? "" : "opacity-60"}`} data-penalty={r.code}>
            <div className="flex items-start gap-3">
              <span className="text-3xl" aria-hidden="true">
                {PENALTY_SCENES[r.scene] ?? "💀"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  {r.tier === "deep" ? "Deep · wrong place" : "Soft · wrong room"} · {COST[r.effect]}
                  {r.effect !== "back" && ` ${r.amount} ${unit(r)}`}
                  {!r.active && " · retired"}
                </p>
                <p className="font-bold">{r.title}</p>
                <p className="text-sm text-paper/85">{r.body}</p>
              </div>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-bold text-gold">Edit</summary>
              <form action={updatePenalty} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
                <input type="hidden" name="code" value={r.code} />
                <input type="hidden" name="back" value={here} />
                <input name="title" defaultValue={r.title} required maxLength={80} className={`${field} sm:col-span-2`} aria-label="Title" />
                <select name="scene" defaultValue={r.scene} className={field} aria-label="Scene">
                  {Object.entries(PENALTY_SCENES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v} {k}
                    </option>
                  ))}
                </select>
                <input name="amount" type="number" min={1} max={3600} defaultValue={r.amount} required className={field} aria-label={`Amount (${unit(r) || "not used"})`} disabled={r.effect === "back"} />
                {r.effect === "back" && <input type="hidden" name="amount" value={1} />}
                <textarea name="body" defaultValue={r.body} required maxLength={600} rows={3} className={`${field} h-auto py-2 sm:col-span-4`} aria-label="What happens" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={r.active} className="size-4 accent-[#F4B41A]" /> In play
                </label>
                <button type="submit" className="h-10 rounded-xl bg-gold text-sm font-bold text-ink sm:col-start-4">
                  Save
                </button>
              </form>
            </details>
          </li>
        ))}
        {!rows.length && <li className="text-sm text-muted">No penalties match.</li>}
      </ol>
      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={link({ page: String(page - 1) })} className="text-gold">‹ Previous</Link> : <span />}
          {page < pages ? <Link href={link({ page: String(page + 1) })} className="text-gold">Next ›</Link> : <span />}
        </nav>
      )}

      <section className="flex flex-col gap-3 rounded-3xl bg-ink-2 p-6">
        <h2 className="font-display text-xl font-extrabold">Add a penalty</h2>
        <p className="text-sm text-muted">Write what happens, then what it costs. Seconds for a wait (a deep wait stops a hunter naming a new place; a soft wait keeps the house shut).</p>
        <form action={addPenalty} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <select name="tier" className={field} aria-label="Kind" defaultValue="deep">
            <option value="deep">Deep (wrong place)</option>
            <option value="soft">Soft (wrong room)</option>
          </select>
          <select name="effect" className={field} aria-label="Cost" defaultValue="wait">
            {Object.entries(COST).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input name="amount" type="number" min={1} max={3600} defaultValue={120} required className={field} aria-label="Amount" />
          <select name="scene" className={field} aria-label="Scene" defaultValue="collapse">
            {Object.entries(PENALTY_SCENES).map(([k, v]) => (
              <option key={k} value={k}>
                {v} {k}
              </option>
            ))}
          </select>
          <input name="title" required maxLength={80} placeholder="The rotten stair" className={`${field} sm:col-span-4`} aria-label="Title" />
          <textarea name="body" required maxLength={600} rows={3} placeholder="The third stair gives way under you… You lose 2 minutes climbing out." className={`${field} h-auto py-2 sm:col-span-4`} aria-label="What happens" />
          <button type="submit" className="h-11 rounded-xl bg-gold font-bold text-ink sm:col-span-4">
            Add the penalty
          </button>
        </form>
      </section>
    </main>
  );
}

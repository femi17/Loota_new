import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Logo } from "@/components/Logo";
import { HuntScene } from "@/components/HuntScene";
import { Countdown } from "@/components/Countdown";
import { Masquerade } from "@/components/game/Masquerade";
import { createAdminClient } from "@/lib/supabase/admin";
import { huntResting, huntResumesAt } from "@/game/hunt";

const steps = [
  { icon: "🧩", title: "Crack the riddle", text: "Every key hides at a real place in Nigeria. Work out where: you only find out you're right when you get there." },
  { icon: "🛵", title: "Make the journey", text: "Walk, cycle, ride an okada, take a danfo or fly. Watch your energy, fuel and coins on real roads." },
  { icon: "🗝️", title: "Beat the Key Trial", text: "At the chest, solve a puzzle against the clock (Sentries, Route, Adire cloth, the Torn Map) while rivals race you live." },
  { icon: "🎭", title: "Outwit the Masquerade", text: "He hides the keys, moves them about and plants trap chests. Trust the heat, not the glint." },
];

/** Whether a hunt has started, and whether it's resting for the night (read per request: the page is dynamic here). */
const started = (startsAt: string) => new Date(startsAt).getTime() <= Date.now();
const resting = () => huntResting(Date.now());
const resumes = () => new Date(huntResumesAt(Date.now())).toISOString();

/** What's on now (or next): the hunt's name, prize and clock, for anyone looking in. */
async function LiveHunt() {
  await connection();
  const { data: h } = await createAdminClient()
    .from("hunts")
    .select("id, title, prize, starts_at, ends_at, hunt_players(count)")
    .eq("published", true)
    .gt("ends_at", new Date().toISOString())
    .order("starts_at")
    .limit(1)
    .maybeSingle();
  if (!h) return null;
  const live = started(h.starts_at);
  const night = live && resting();
  const hunters = (h.hunt_players as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
  return (
    <Link href="/signup" className="flex max-w-xl items-center gap-3 rounded-2xl bg-ink-2 px-4 py-3 ring-1 ring-gold/60 hover:ring-gold" aria-label={`${live ? "Live now" : "Coming up"}: ${h.title}`}>
      <span className={`size-2.5 shrink-0 rounded-full ${live && !night ? "loota-live-dot bg-danger" : "bg-gold"}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-wider text-gold">{night ? "Resting till 9 am" : live ? "Live now" : "Next hunt"}</span>
        <span className="block truncate font-bold">{h.title}</span>
        <span className="block text-sm text-muted">
          🏆 {h.prize}
          {live && hunters > 0 ? ` · ${hunters} hunter${hunters === 1 ? "" : "s"} racing` : ""}
        </span>
      </span>
      <span className="shrink-0 text-right text-sm">
        <span className="block text-xs text-muted">{night ? "back in" : live ? "ends in" : "starts in"}</span>
        <b className="text-paper">
          <Countdown to={night ? resumes() : live ? h.ends_at : h.starts_at} fallback="…" />
        </b>
      </span>
    </Link>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-3">
          <Link href="/login" className="px-2 text-paper hover:text-gold">Log in</Link>
          <Link href="/signup" className="inline-flex h-11 items-center rounded-xl bg-gold px-5 font-bold text-ink hover:bg-gold-hover">
            Play now
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 pb-20 pt-4 sm:px-8">
        <section className="flex flex-wrap items-center gap-8">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            <h1 className="font-display text-[clamp(40px,6vw,72px)] font-extrabold leading-none">
              Real map. Real prizes. <span className="text-gold">Race for the keys.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted">
              Crack riddles that point to real places across Nigeria, travel there on real roads, and beat the puzzle at the
              chest before your rivals do. Join from anywhere in the world.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="inline-flex h-14 items-center rounded-2xl bg-gold px-7 text-[17px] font-bold text-ink hover:bg-gold-hover">
                Create your hunter
              </Link>
              <Link href="/login" className="inline-flex h-14 items-center rounded-2xl border-[1.5px] border-line px-6 hover:border-muted">
                I already have an account
              </Link>
            </div>
            <Suspense fallback={null}>
              <LiveHunt />
            </Suspense>
          </div>
          <HuntScene />
        </section>

        <section className="flex flex-col gap-6">
          <h2 className="font-display text-3xl font-extrabold">How a hunt works</h2>
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-3 rounded-3xl bg-ink-2 p-6">
                <span className="flex items-center gap-3">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-ink text-2xl" aria-hidden="true">{step.icon}</span>
                  <span className="text-sm font-bold text-gold">Step {i + 1}</span>
                </span>
                <h3 className="text-xl font-bold">{step.title}</h3>
                <p className="leading-relaxed text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="relative flex flex-wrap items-center gap-6 overflow-hidden rounded-3xl bg-[radial-gradient(ellipse_at_20%_110%,#7A3A10_0%,#3B1F4F_50%,#140F2E_90%)] p-6 sm:p-10">
          <div className="flex shrink-0 justify-center">
            <Masquerade size={96} />
          </div>
          <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
            <p className="text-sm font-bold uppercase tracking-wider text-gold">Meet the villain</p>
            <p className="font-display text-2xl font-extrabold leading-snug sm:text-3xl">“Hehehe! I am the Masquerade, and I hid the keys myself. Catch me if you can!”</p>
            <p className="text-muted">Every hunt has a story. He taunts the leaders, moves keys to relay chests and leaves decoys for the careless.</p>
          </div>
        </section>

        <section className="flex flex-wrap gap-6 rounded-3xl border-[1.5px] border-gold p-6 sm:p-8">
          {["Every prize is paid for upfront", "Keys can't be bought", "Walking is always free"].map((point) => (
            <p key={point} className="flex flex-[1_1_200px] items-center gap-3 font-bold">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
                <path d="M8.5 12l2.5 2.5 4.5-5" />
              </svg>
              {point}
            </p>
          ))}
        </section>
      </main>
    </div>
  );
}

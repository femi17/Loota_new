import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Logo, LootaLogo } from "@/components/Logo";
import { PhoneShot } from "@/components/PhoneShot";
import { Countdown } from "@/components/Countdown";
import { Masquerade } from "@/components/game/Masquerade";
import { createAdminClient } from "@/lib/supabase/admin";
import { huntResting, huntResumesAt } from "@/game/hunt";
// Real screenshots of the game (phone), made by scripts/build-landing-shots.mjs from the browser tests' pictures.
import heroShot from "@/images/landing/chest.webp";
import heroBack from "@/images/landing/tornmap.webp";
import trialShot from "@/images/landing/trial.webp";
import keeperShot from "@/images/landing/keeper.webp";
import storyShot from "@/images/landing/masquerade.webp";
import petrolShot from "@/images/landing/petrol.webp";
import chessShot from "@/images/landing/chess.webp";

export const metadata: Metadata = { title: "Loota: a treasure hunt on the real map" };

const steps = [
  { icon: "🧩", title: "Crack the riddle", text: "Every key hides at a real place. Work out where: you only find out you're right when you get there." },
  { icon: "🧭", title: "Make the journey", text: "Walk, ride, drive, take the bus or fly, on real roads. Watch your energy, fuel and coins." },
  { icon: "🗝️", title: "Beat the Key Trial", text: "At the chest, solve a puzzle against the clock while rivals race you live." },
  { icon: "🏆", title: "Claim the prize", text: "The first hunters to collect every key win. The prize, and how many win it, are on the card before you join." },
];

const shots = [
  { src: trialShot, title: "Key Trials", text: "Sentries, Route, Adire cloth, the Torn Map: a new puzzle at every chest." },
  { src: keeperShot, title: "Keepers of the keys", text: "Each key waits in its own place: a market, a beach, a palace." },
  { src: storyShot, title: "A story in every hunt", text: "The Masquerade taunts you as you close in on his keys." },
  { src: petrolShot, title: "Real places, real people", text: "Fill up, eat and rest at real petrol stations and eateries near you." },
  { src: chessShot, title: "Roadside games", text: "Passers-by challenge you to chess, the three cups and pairs, for coins." },
];

const rides = [
  { icon: "🚶", name: "Walk", note: "Always free" },
  { icon: "🚲", name: "Bicycle", note: "Keep the tyres pumped" },
  { icon: "🛵", name: "Motorbike", note: "Okada in Lagos" },
  { icon: "🚕", name: "Car & taxi", note: "Fuel and papers" },
  { icon: "🚌", name: "Bus", note: "Rest on the way" },
  { icon: "🚆", name: "Train", note: "Tickets at the station" },
  { icon: "✈️", name: "Plane", note: "Check in, then the lounge" },
];

const extras = [
  { icon: "🌍", title: "Roam the real world", text: "Start where you are. Real streets, shops, petrol stations and bus stops, in any country." },
  { icon: "🧑🏾‍🍳", title: "People on every corner", text: "The cook, the pump attendant, the mechanic, the ticket clerk: every stop is a little scene, with local names and talk." },
  { icon: "🚨", title: "Trouble on the road", text: "Checkpoints, police chases, flat tyres and an empty tank far from the pump. Bring your papers." },
  { icon: "🪔", title: "The Lamp", text: "It glows when something's close: a detour, a relic, a reward for the curious." },
  { icon: "🧞", title: "The Djinn's Wager", text: "Once a week, without warning, the Djinn opens a wager. One winner takes a Wonder, a power nobody else has." },
  { icon: "📻", title: "Loota Radio", text: "Live stations from the country you're in while you travel, and Nigeria's from anywhere." },
];

const promises = [
  { title: "Every prize is paid for upfront", text: "You see the prize before you join." },
  { title: "Keys can't be bought", text: "Coins buy rides, fuel and food, never keys or answers." },
  { title: "Walking is always free", text: "No coins? You can still reach every key." },
  { title: "Hunts rest at night", text: "9 pm to 9 am Lagos time: nobody wins by skipping sleep." },
];

const questions = [
  { q: "Is Loota free to play?", a: "Yes. You get 500 coins when you set your home, and walking never costs anything. Coins pay for rides, fuel, food and gear; you earn more on the road (roadside games, helping travellers, the Lamp's finds) or buy them." },
  { q: "Do I have to be in Nigeria?", a: "No. Loota plays on the real map wherever you are, with local shops, bus stations and radio. Hunts take place at real places, and you can travel to them in the game by bus, train or plane." },
  { q: "What can I win?", a: "Each hunt has its own prize and number of winners, shown on the hunt's card before you join. The prize is paid for before the hunt starts." },
  { q: "Do I need to download anything?", a: "No. Loota runs in the browser on your phone or computer. Sign up, choose your look and set your home." },
  { q: "Can someone just buy their way to the keys?", a: "No. Keys can only be won: by cracking the riddle, getting there and beating the Key Trial." },
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

function Shield() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  );
}

function Heading({ kicker, title, id }: { kicker: string; title: string; id?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-bold uppercase tracking-wider text-gold">{kicker}</p>
      <h2 id={id} className="font-display text-[clamp(28px,4vw,40px)] font-extrabold leading-tight">{title}</h2>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-3">
          <a href="#how" className="hidden px-2 text-muted hover:text-paper md:inline">How it works</a>
          <a href="#world" className="hidden px-2 text-muted hover:text-paper md:inline">The game</a>
          <a href="#faq" className="hidden px-2 text-muted hover:text-paper md:inline">Questions</a>
          <Link href="/login" className="px-2 text-paper hover:text-gold">Log in</Link>
          <Link href="/signup" className="inline-flex h-11 items-center rounded-xl bg-gold px-5 font-bold text-ink hover:bg-gold-hover">
            Play now
          </Link>
        </nav>
      </header>

      <main className="flex flex-col gap-24 pb-10 sm:gap-28">
        {/* The hero: what Loota is, the way in, what's on now, and the game itself */}
        <section className="relative">
          <div className="pointer-events-none absolute inset-x-0 -top-24 h-[640px] bg-[radial-gradient(ellipse_at_75%_35%,rgba(244,180,26,0.16),transparent_60%)]" aria-hidden="true" />
          <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-10 gap-y-12 px-4 pt-4 sm:px-8">
            <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-6">
              <p className="inline-flex w-fit items-center gap-2 rounded-full bg-ink-2 px-3 py-1.5 text-sm font-bold text-gold ring-1 ring-line">
                <span aria-hidden="true">🗺️</span> A treasure hunt on the real map
              </p>
              <h1 className="font-display text-[clamp(42px,6.4vw,76px)] font-extrabold leading-[0.98]">
                Real map. Real prizes. <span className="text-gold">Race for the keys.</span>
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-muted">
                Crack riddles that point to real places, travel there on real roads (on foot, by bike, bus, train or plane) and
                beat the puzzle at the chest before your rivals do. Play from wherever you are in the world.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/signup" className="inline-flex h-14 items-center rounded-2xl bg-gold px-7 text-[17px] font-bold text-ink shadow-[0_10px_30px_-10px_rgba(244,180,26,0.7)] hover:bg-gold-hover">
                  Create your hunter
                </Link>
                <Link href="/login" className="inline-flex h-14 items-center rounded-2xl border-[1.5px] border-line px-6 hover:border-muted">
                  I already have an account
                </Link>
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted" aria-label="Good to know">
                <li><span aria-hidden="true">🎁</span> 500 coins to start</li>
                <li><span aria-hidden="true">🚶</span> Walking is always free</li>
                <li><span aria-hidden="true">📱</span> No download: plays in your browser</li>
              </ul>
              <Suspense fallback={null}>
                <LiveHunt />
              </Suspense>
            </div>

            <div className="flex min-w-0 flex-[1_1_360px] justify-center" role="img" aria-label="Loota on a phone: the riddle, the detector burning and the chest on the map; behind it, the Torn Map puzzle">
              <div className="relative sm:pl-[150px]">
                <PhoneShot src={heroBack} alt="" width={210} className="absolute left-0 top-16 hidden -rotate-6 sm:block" />
                <PhoneShot src={heroShot} alt="" width={260} priority className="relative rotate-2 max-sm:!w-[220px]" />
                <span className="loota-float absolute -left-6 bottom-[30%] rounded-2xl bg-ink-2/95 px-3 py-2 text-sm font-bold shadow-xl ring-1 ring-line" aria-hidden="true">
                  🏁 Rivals racing you live
                </span>
                <span className="loota-float absolute -right-4 bottom-[8%] rounded-2xl bg-gold px-3 py-2 text-sm font-bold text-ink shadow-xl [animation-delay:-1.5s]" aria-hidden="true">
                  🏆 Real prizes
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* How a hunt works */}
        <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 sm:px-8" aria-labelledby="how">
          <Heading kicker="How it works" title="One hunt, four steps" id="how" />
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-4 rounded-3xl bg-ink-2 p-5 ring-1 ring-line/60 sm:flex-col sm:p-6">
                <span className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ink text-2xl" aria-hidden="true">
                  {step.icon}
                  <span className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-gold text-xs font-extrabold text-ink">{i + 1}</span>
                </span>
                <span className="flex min-w-0 flex-col gap-1.5">
                  <h3 className="text-lg font-bold sm:text-xl">{step.title}</h3>
                  <p className="leading-relaxed text-muted">{step.text}</p>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* The game itself, in pictures */}
        <section className="flex flex-col gap-8" aria-labelledby="world">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
            <Heading kicker="The game" title="A whole world between you and the chest" id="world" />
          </div>
          <ul className="mx-auto flex w-full max-w-6xl snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-2 sm:px-8 lg:justify-between" aria-label="Pictures of the game">
            {shots.map((s) => (
              <li key={s.title} className="flex w-[220px] shrink-0 snap-center flex-col gap-3 lg:w-[196px]">
                <PhoneShot src={s.src} alt={`${s.title}: ${s.text}`} width={220} className="lg:!w-[196px]" />
                <span className="px-1">
                  <b className="block">{s.title}</b>
                  <span className="text-sm leading-snug text-muted">{s.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="px-4 text-center text-xs text-muted sm:hidden" aria-hidden="true">Swipe for more →</p>
        </section>

        {/* Getting there */}
        <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 sm:px-8" aria-labelledby="ways">
          <Heading kicker="Getting there" title="Half the hunt is the journey" id="ways" />
          <ul className="flex flex-wrap justify-center gap-x-[2%] gap-y-2 lg:flex-nowrap lg:gap-3">
            {rides.map((r) => (
              <li key={r.name} className="flex w-[23.4%] flex-col items-center gap-1 rounded-2xl bg-ink-2 px-1 py-3 text-center ring-1 ring-line/60 sm:px-2 sm:py-4 lg:w-0 lg:flex-1">
                <span className="text-2xl sm:text-3xl" aria-hidden="true">{r.icon}</span>
                <b className="text-sm sm:text-base">{r.name}</b>
                <span className="text-[11px] leading-tight text-muted sm:text-xs">{r.note}</span>
              </li>
            ))}
          </ul>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            {extras.map((e) => (
              <li key={e.title} className="flex flex-col gap-3 rounded-3xl bg-ink-2 p-4 ring-1 ring-line/60 md:flex-row md:gap-4 md:p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-ink text-xl md:size-12 md:text-2xl" aria-hidden="true">{e.icon}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  <h3 className="font-bold leading-tight">{e.title}</h3>
                  <p className="text-[13px] leading-snug text-muted md:text-sm md:leading-relaxed">{e.text}</p>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* The villain */}
        <section className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <div className="relative flex flex-wrap items-center gap-6 overflow-hidden rounded-3xl bg-[radial-gradient(ellipse_at_20%_110%,#7A3A10_0%,#3B1F4F_50%,#140F2E_90%)] p-6 sm:p-10">
            <div className="flex shrink-0 justify-center">
              <Masquerade size={96} />
            </div>
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
              <p className="text-sm font-bold uppercase tracking-wider text-gold">Meet the villain</p>
              <p className="font-display text-2xl font-extrabold leading-snug sm:text-3xl">“Hehehe! I am the Masquerade, and I hid the keys myself. Catch me if you can!”</p>
              <p className="text-muted">Every hunt has a story. He taunts the leaders, moves keys to relay chests and plants trap chests for the careless. Trust the heat, not the glint.</p>
            </div>
          </div>
        </section>

        {/* Fair play */}
        <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 sm:px-8" aria-labelledby="fair">
          <Heading kicker="Fair play" title="A race anyone can win" id="fair" />
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4 rounded-3xl border-[1.5px] border-gold p-5 sm:p-8">
            {promises.map((p) => (
              <li key={p.title} className="flex gap-3">
                <Shield />
                <span>
                  <b className="block">{p.title}</b>
                  <span className="text-sm text-muted">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Questions */}
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 sm:px-8" aria-labelledby="faq">
          <Heading kicker="Questions" title="Before you start" id="faq" />
          <div className="flex flex-col gap-3">
            {questions.map((f) => (
              <details key={f.q} className="group rounded-2xl bg-ink-2 ring-1 ring-line/60 open:ring-gold/50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-bold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="text-xl text-gold transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="px-5 pb-5 leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* The way in, once more */}
        <section className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <div className="flex flex-col items-center gap-5 rounded-3xl bg-[radial-gradient(ellipse_at_50%_0%,rgba(244,180,26,0.22),transparent_70%)] px-6 py-12 text-center ring-1 ring-line">
            <span className="text-5xl" aria-hidden="true">🗝️</span>
            <h2 className="font-display text-[clamp(28px,4vw,44px)] font-extrabold leading-tight">The keys are out there.</h2>
            <p className="max-w-md text-muted">Make your hunter, set your home and take your first steps on the real map. It takes a minute.</p>
            <Link href="/signup" className="inline-flex h-14 items-center rounded-2xl bg-gold px-8 text-[17px] font-bold text-ink hover:bg-gold-hover">
              Create your hunter
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-line px-4 py-8 text-sm text-muted sm:px-8">
        <LootaLogo height={36} />
        <nav aria-label="Footer" className="flex gap-5">
          <Link href="/login" className="hover:text-paper">Log in</Link>
          <Link href="/signup" className="hover:text-paper">Sign up</Link>
        </nav>
        <p>© Loota</p>
      </footer>
    </div>
  );
}

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { HunterFigure } from "@/components/HunterFigure";

const steps = [
  { title: "Crack the riddle", text: "Every key hides at a real place. Guess where, but you only find out when you arrive." },
  { title: "Make the journey", text: "Walk, cycle, ride, take the bus or fly. Manage your energy, fuel and coins along real roads." },
  { title: "Beat the Key Trial", text: "Quick-fire questions, 10–15 seconds each. Collect every key in order to win." },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-3">
          <Link href="/login" className="px-2 text-paper hover:text-gold">Log in</Link>
          <Link href="/signup" className="inline-flex h-11 items-center rounded-xl bg-gold px-5 font-bold text-ink hover:bg-gold-hover">
            Play now
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 pb-20 pt-6 sm:px-8">
        <section className="flex flex-wrap items-center gap-10">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            <h1 className="font-display text-[clamp(40px,6vw,72px)] font-extrabold leading-none">
              Real map. Real prizes. <span className="text-gold">Race for the keys.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted">
              Solve riddles that point to real places across Nigeria. Travel there with your avatar, then beat the
              timed trial to win the key. Join from anywhere in the world.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="inline-flex h-14 items-center rounded-2xl bg-gold px-7 text-[17px] font-bold text-ink hover:bg-gold-hover">
                Create your hunter
              </Link>
              <Link href="/login" className="inline-flex h-14 items-center rounded-2xl border-[1.5px] border-line px-6 hover:border-muted">
                I already have an account
              </Link>
            </div>
          </div>
          <div className="relative flex h-80 min-w-0 flex-[1_1_380px] items-end justify-center gap-6 overflow-hidden rounded-[28px] bg-map pb-10">
            <div aria-hidden="true" className="absolute left-[-10%] top-24 h-6 w-[120%] -rotate-6 bg-white" />
            <div aria-hidden="true" className="absolute left-1/2 top-0 h-full w-5 rotate-6 bg-[#ffe7a8]" />
            <div className="relative"><HunterFigure look={{ skin: "#C68642", shirt: "#E5484D" }} width={56} /></div>
            <div className="relative"><HunterFigure look={{ skin: "#8D5524", shirt: "#2F6FEB" }} width={80} label="Loota hunters" /></div>
            <div className="relative"><HunterFigure look={{ skin: "#5C3A1E", shirt: "#1E9E62" }} width={56} /></div>
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <h2 className="font-display text-3xl font-extrabold">How a hunt works</h2>
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-3 rounded-3xl bg-ink-2 p-6">
                <span className="flex size-9 items-center justify-center rounded-full bg-gold font-bold text-ink">{i + 1}</span>
                <h3 className="text-xl font-bold">{step.title}</h3>
                <p className="leading-relaxed text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
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

"use client";

/** A penalty the server dealt (public.deal_penalty): the trap, and what it cost. */
export type Penalty = {
  code: string;
  tier: "soft" | "deep";
  title: string;
  body: string;
  scene: string;
  effect: "wait" | "coins" | "energy" | "back";
  amount: number;
  until: string | null;
};

/** One picture per kind of trap (scenes are reused across the many penalties). */
const SCENE: Record<string, string> = {
  collapse: "🕳️",
  darts: "🏹",
  flood: "🌊",
  smoke: "💨",
  net: "🕸️",
  boulder: "🪨",
  fire: "🔥",
  swarm: "🦇",
  masquerade: "🎭",
  storm: "⛈️",
  fall: "🧗",
  gas: "☠️",
  cage: "⛓️",
  mirror: "🪞",
  snake: "🐍",
};

function cost(p: Penalty) {
  if (p.effect === "wait") return p.tier === "deep" ? `⏳ No new answer for ${Math.round(p.amount / 60)} min` : `⏳ ${p.amount} s before you can go back in`;
  if (p.effect === "coins") return p.amount > 0 ? `🪙 −${p.amount} coins` : "🪙 Your pockets were empty: nothing to lose";
  if (p.effect === "energy") return `⚡ −${p.amount} energy`;
  return "↩️ Back where you set off for this key";
}

/**
 * A penalty, as it happens (owner, 31 Oct 2026: "in movies they always end up dead"): the wrong place springs a trap.
 * Deep ones (the wrong location) fill the screen in black and red; soft ones (the wrong room) are lighter.
 */
export function PenaltyCard({ penalty, onClose }: { penalty: Penalty; onClose: () => void }) {
  const deep = penalty.tier === "deep";
  return (
    <div
      className={`pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center p-4 ${deep ? "bg-[radial-gradient(circle_at_50%_40%,#5A0B0B_0%,#120404_70%)]" : "bg-black/70"}`}
      role="alertdialog"
      aria-modal="true"
      aria-label={`A trap: ${penalty.title}`}
      data-penalty={penalty.code}
    >
      <div className="loota-shake flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-ink/90 p-6 text-center ring-1 ring-danger/60">
        <p className="text-6xl" aria-hidden="true">
          {SCENE[penalty.scene] ?? "💀"}
        </p>
        <p className={`text-xs font-extrabold uppercase tracking-[0.25em] ${deep ? "text-danger-text" : "text-gold"}`}>{deep ? "Wrong place" : "Wrong room"}</p>
        <h2 className="font-display text-2xl font-extrabold">{penalty.title}</h2>
        <p className="text-sm leading-relaxed text-paper/90">{penalty.body}</p>
        <p className="rounded-xl bg-danger/15 px-3 py-2 text-sm font-bold text-danger-text ring-1 ring-danger/50">{cost(penalty)}</p>
        <button type="button" onClick={onClose} className="h-12 w-full rounded-2xl bg-gold font-bold text-ink">
          Get up
        </button>
      </div>
    </div>
  );
}

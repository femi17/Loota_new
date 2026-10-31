"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { carryOnStory } from "./actions";

type Step = { status: string | null; did: string | null; progress: { done: number; total: number }; log: string[]; error: string | null; title: string | null; notes: string[] };

/**
 * A story being written: while this page is open it asks the server for the next step again and again (each step is
 * one request: the live server stops long ones), showing how far it has got. Stopped (out of credit, lost connection):
 * the reason, and Carry on.
 */
export function StoryProgress({ hunt, status }: { hunt: string; status: "writing" | "failed" }) {
  const router = useRouter();
  const [step, setStep] = useState<Step | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const running = useRef(false);

  useEffect(() => {
    let stopped = false;
    const show = (s: Step) => {
      setStep(s);
      if (s.did) setLines((l) => [...l.slice(-7), s.did!]);
    };
    async function run() {
      // Where it's got to first (the page may have been closed half-way).
      const first = (await fetch(`/api/admin/story-step?hunt=${hunt}`).then((r) => r.json())) as Step;
      if (stopped) return;
      show(first);
      if (status !== "writing" || running.current) return;
      running.current = true;
      for (;;) {
        let s: Step;
        try {
          s = (await fetch("/api/admin/story-step", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hunt }) }).then((r) => r.json())) as Step;
        } catch {
          await new Promise((r) => setTimeout(r, 5000)); // no connection: try again in a moment
          if (stopped) break;
          continue;
        }
        if (stopped) break;
        show(s);
        if (s.status !== "writing") {
          router.refresh();
          break;
        }
      }
      running.current = false;
    }
    void run();
    return () => {
      stopped = true;
    };
  }, [hunt, status, router]);

  const p = step?.progress ?? { done: 0, total: 1 };
  const pct = Math.round((100 * p.done) / Math.max(1, p.total));
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4" aria-label="Story progress">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold">
          {status === "failed" || step?.status === "failed" ? "✋ The story stopped" : "✍️ Writing the story"}
          {step?.title ? <span className="text-muted">: &ldquo;{step.title}&rdquo;</span> : null}
        </p>
        <span className="text-sm tabular-nums text-muted">
          {p.done} of {p.total} steps
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink">
        <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${pct}%` }} />
      </div>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted">
          {lines.map((l, i) => (
            <li key={i}>✓ {l}</li>
          ))}
        </ul>
      )}
      {(status === "failed" || step?.status === "failed") && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-danger/10 p-3 ring-1 ring-danger">
          <p className="min-w-0 flex-1 text-sm">{step?.error ?? "It stopped."} Everything written so far is kept.</p>
          <form action={carryOnStory}>
            <input type="hidden" name="hunt" value={hunt} />
            <button type="submit" className="h-10 rounded-xl bg-gold px-4 text-sm font-bold text-ink">
              Carry on
            </button>
          </form>
        </div>
      )}
      {status === "writing" && step?.status !== "failed" && (
        <p className="text-xs text-muted">Keep this page open: it writes one step at a time (10 to 20 minutes in all). Closing it pauses the story; it carries on when you come back.</p>
      )}
    </div>
  );
}

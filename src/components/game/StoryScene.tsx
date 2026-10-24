"use client";

import { useEffect, useState } from "react";
import { HunterFigure } from "@/components/HunterFigure";
import { KEY_SCENE_INFO } from "@/game/keyScenes";
import { STORY_NAMES, type StoryLine } from "@/game/story";
import { cue } from "@/game/sound";
import { Masquerade } from "./Masquerade";

/**
 * A story beat (owner, 24 Oct 2026: the Masquerade, light and playful): a night-festival stage with the Masquerade on
 * one side and the Keeper on the other; each line types out in a speech panel; tap to go on. Skip any time.
 */
export function StoryScene({ lines, mood = "sly", onDone }: { lines: StoryLine[]; mood?: "sly" | "cross" | "beaten"; onDone: () => void }) {
  const [at, setAt] = useState(0);
  const [shown, setShown] = useState(0);
  const line = lines[at];
  const full = !line || shown >= line.text.length;

  // Type the line out.
  useEffect(() => {
    if (!line) return;
    const timer = window.setInterval(() => setShown((s) => Math.min(line.text.length, s + 2)), 28);
    return () => window.clearInterval(timer);
  }, [line]);
  // Each line's speaker gets a little sound.
  useEffect(() => {
    if (line?.who === "masquerade") cue("rival");
    else if (line?.who === "keeper") cue("news");
  }, [line]);

  const next = () => {
    if (!full) {
      setShown(line.text.length);
      return;
    }
    if (at + 1 >= lines.length) onDone();
    else {
      setAt(at + 1);
      setShown(0);
    }
  };

  const speaking = line?.who ?? "narrator";
  return (
    <div role="dialog" aria-label="Story" className="pointer-events-auto fixed inset-0 z-40 flex flex-col overflow-hidden bg-[#140F2E]" onClick={next}>
      {/* The night stage: stars, festival bunting, warm lights, the ground */}
      <div className="absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_110%,#7A3A10_0%,#3B1F4F_45%,#140F2E_80%)]" />
        {[...Array(28)].map((_, i) => (
          <span
            key={i}
            className="loota-star absolute size-1 rounded-full bg-[#FFF7E0]"
            style={{ left: `${(i * 37) % 100}%`, top: `${(i * 23) % 45}%`, animationDelay: `${(i % 7) * 0.4}s` }}
          />
        ))}
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="absolute inset-x-0 top-[12%] h-10 w-full">
          <path d="M0 2 Q25 10 50 3 T100 2" stroke="#F5ECD8" strokeWidth="0.3" fill="none" />
          {[...Array(16)].map((_, i) => {
            const x = 3 + i * 6.2;
            const y = 2 + Math.sin((x / 100) * Math.PI * 2) * 2.6 + 2.5;
            return <path key={i} d={`M${x - 1.6} ${y} L${x + 1.6} ${y} L${x} ${y + 4}z`} fill={["#E5484D", "#F4B41A", "#1E9E62", "#7C4DCC"][i % 4]} />;
          })}
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-[#3A2410] to-[#5B3A1A]" />
        {/* A warm festival glow where they stand */}
        <div className="absolute inset-x-[-20%] bottom-[24%] h-[30%] rounded-[50%] bg-[radial-gradient(ellipse,rgba(244,180,26,0.35),transparent_65%)]" />
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDone();
        }}
        className="absolute right-4 top-4 z-10 rounded-full bg-ink/60 px-4 py-2 text-sm font-bold text-paper"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        Skip ›
      </button>

      {/* The cast */}
      <div className="relative z-[1] flex flex-1 items-end justify-between px-4 pb-[34vh]">
        <div className={`origin-bottom transition-all duration-300 ${speaking === "masquerade" ? "scale-110" : "scale-95 opacity-85"}`}>
          <Masquerade size={176} mood={mood} />
        </div>
        <div className={`mb-2 origin-bottom transition-all duration-300 ${speaking === "keeper" ? "scale-110" : "scale-95 opacity-85"}`}>
          <HunterFigure look={KEY_SCENE_INFO.circle.keeper.look} width={108} />
        </div>
      </div>

      {/* What's said */}
      <div className="absolute inset-x-0 bottom-0 z-[2] p-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div className={`mx-auto max-w-lg rounded-3xl p-4 shadow-xl ${speaking === "narrator" ? "bg-ink/80 text-center italic" : "bg-[#F5ECD8] text-[#3A2410]"}`}>
          {speaking !== "narrator" && (
            <p className={`font-display text-sm font-extrabold uppercase tracking-wider ${speaking === "masquerade" ? "text-[#B42318]" : "text-[#1E3A6E]"}`}>{STORY_NAMES[speaking]}</p>
          )}
          <p className={`min-h-[3.5rem] text-lg leading-snug ${speaking === "narrator" ? "text-paper" : ""}`}>{line?.text.slice(0, shown)}</p>
          <p className={`mt-1 text-right text-xs font-bold ${speaking === "narrator" ? "text-paper/60" : "text-[#3A2410]/60"}`}>
            {full ? (at + 1 >= lines.length ? "Tap to play ›" : "Tap ›") : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

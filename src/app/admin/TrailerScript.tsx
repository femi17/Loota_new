"use client";

import { useState } from "react";

export type Trailer = { voiceOver: string; shots: { picture: number; lines: string }[] };

/**
 * The trailer's voice-over (owner, 31 Oct 2026: "I did not see a voice over for the trailer"): the script to paste into
 * ElevenLabs, with Copy, and which lines play over which of the 3 pictures.
 */
export function TrailerScript({ trailer, voices }: { trailer: Trailer; voices: { name: string; direction: string }[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4" aria-label="Trailer voice-over">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold">🎙 The trailer&apos;s voice-over</p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(trailer.voiceOver);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="ml-auto h-9 rounded-lg border border-line px-3 text-xs font-bold"
        >
          {copied ? "✓ Copied" : "Copy script"}
        </button>
      </div>
      <p className="text-xs text-muted">About 45 seconds. Paste it into ElevenLabs, one voice per speaker, then cut the 3 pictures to it.</p>
      <pre className="whitespace-pre-wrap rounded-xl bg-ink p-3 font-sans text-sm text-paper/90">{trailer.voiceOver}</pre>
      {trailer.shots.length > 0 && (
        <ol className="flex flex-col gap-1 text-xs text-muted">
          {trailer.shots.map((s) => (
            <li key={s.picture}>
              <b className="text-paper">Picture {s.picture}:</b> {s.lines}
            </li>
          ))}
        </ol>
      )}
      {voices.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer font-bold">Voices</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {voices.map((v) => (
              <li key={v.name}>
                <b className="text-paper">{v.name}:</b> {v.direction}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

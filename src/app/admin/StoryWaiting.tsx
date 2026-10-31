"use client";

import { useState } from "react";

/**
 * A story hunt waiting for its story (owner, 31 Oct 2026: no paid API; "I can always prompt you to create a new
 * story"): the request to give Claude Code, with a Copy button. Claude Code writes the story and imports it into this
 * hunt; the card then shows the story, its keys and its picture prompts.
 */
export function StoryWaiting({ hunt, keys }: { hunt: string; keys: number }) {
  const request = `/new-story-hunt ${hunt} ${keys} keys`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ink-2 p-4" aria-label="Waiting for its story">
      <p className="font-bold">⏳ Waiting for its story</p>
      <p className="text-sm text-muted">Copy this and send it to Claude Code. It writes a new story with {keys} hidden keys, checks every place on the map, and brings it here: the title, the keys, and a picture prompt for each scene.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-ink px-3 py-2 text-sm text-gold">{request}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(request);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="h-10 rounded-xl bg-gold px-4 text-sm font-bold text-ink"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

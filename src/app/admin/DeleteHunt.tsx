"use client";

import { useState } from "react";
import { deleteHunt } from "./actions";

/** "Delete": opens a small box where the owner types DELETE before the hunt goes for good. */
export function DeleteHunt({ hunt, title }: { hunt: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="h-10 rounded-xl border-[1.5px] border-line px-4 text-sm hover:border-danger hover:text-danger-text">
        Delete
      </button>
    );
  }
  return (
    <form action={deleteHunt} className="flex flex-wrap items-center gap-2 rounded-xl bg-danger/10 p-2 ring-1 ring-danger">
      <input type="hidden" name="hunt" value={hunt} />
      <span className="text-xs">Delete &ldquo;{title}&rdquo; and everything in it? Type DELETE:</span>
      <input
        name="confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoFocus
        aria-label="Type DELETE to confirm"
        className="h-9 w-24 rounded-lg bg-ink px-2 text-sm uppercase text-paper outline-none ring-1 ring-line focus:ring-danger"
      />
      <button type="submit" disabled={typed.toUpperCase() !== "DELETE"} className="h-9 rounded-lg bg-danger px-3 text-sm font-bold text-white disabled:opacity-40">
        Delete for good
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-9 px-2 text-sm text-muted">
        Cancel
      </button>
    </form>
  );
}

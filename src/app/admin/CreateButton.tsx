"use client";

import { useFormStatus } from "react-dom";

/** "Create the hunt", off while it's being made: a second tap can't ask for a second hunt (owner, 31 Oct 2026). */
export function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="h-12 rounded-2xl bg-gold font-bold text-ink disabled:opacity-60 sm:col-span-3">
      {pending ? "Creating the hunt…" : "Create the hunt"}
    </button>
  );
}

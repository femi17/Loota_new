"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveLook } from "./actions";
import { LookEditor } from "@/components/LookEditor";
import { FormMessage, primaryButton } from "@/components/FormField";
import type { AvatarLook } from "@/lib/avatar";

export function LookForm({ initialLook }: { initialLook: AvatarLook }) {
  const [look, setLook] = useState(initialLook);
  const [state, action, pending] = useActionState(saveLook, undefined);

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-extrabold">Change your look</h1>
        <p className="text-muted">Other hunters see this on the map, with your name tag above it.</p>
      </div>
      <LookEditor look={look} onChange={setLook} />
      <input type="hidden" name="look" value={JSON.stringify(look)} />
      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Saving…" : "Save look"}
      </button>
      <Link href="/lobby" className="text-center text-muted hover:text-paper">Cancel</Link>
    </form>
  );
}

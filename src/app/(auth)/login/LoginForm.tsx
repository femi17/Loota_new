"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { logIn } from "../actions";
import { FormField, FormMessage, primaryButton } from "@/components/FormField";

export function LoginForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(logIn, undefined);
  const linkFailed = params.get("error") === "confirm";

  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-extrabold">Welcome back</h1>
      {linkFailed && !state && (
        <FormMessage error="That confirmation link didn't work or has expired. Log in to try again, or sign up again." />
      )}
      <input type="hidden" name="next" value={params.get("next") ?? ""} />
      <FormField label="Email" name="email" type="email" autoComplete="email" required />
      <FormField label="Password" name="password" type="password" autoComplete="current-password" required />
      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Logging in…" : "Log in"}
      </button>
      <p className="text-center text-sm text-muted">
        New here? <Link href="/signup" className="text-gold hover:text-gold-hover">Create your hunter</Link>
      </p>
    </form>
  );
}

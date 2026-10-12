"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp } from "../actions";
import { FormField, FormMessage, primaryButton } from "@/components/FormField";

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, undefined);

  if (state?.message) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-3xl font-extrabold">Check your email</h1>
        <FormMessage message={state.message} />
        <Link href="/login" className="text-gold hover:text-gold-hover">Go to log in</Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-extrabold">Create your hunter</h1>
        <p className="text-muted">Free to join. Prizes are paid for upfront.</p>
      </div>
      <FormField label="Hunter name" name="username" autoComplete="username" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" hint="3–20 letters, numbers or underscores. Shown on leaderboards." />
      <FormField label="Email" name="email" type="email" autoComplete="email" required />
      <FormField label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters." />
      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Creating…" : "Create hunter"}
      </button>
      <p className="text-center text-sm text-muted">
        Already hunting? <Link href="/login" className="text-gold hover:text-gold-hover">Log in</Link>
      </p>
    </form>
  );
}

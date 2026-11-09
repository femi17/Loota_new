"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export type AuthState = { error?: string; message?: string } | undefined;

const HUNTER_NAME = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * How many times a password has turned up in data breaches (security audit, 9 Nov 2026: Supabase's own check is a
 * dashboard setting). Have I Been Pwned's range search, the one Supabase uses: only the first 5 characters of the
 * password's SHA-1 leave the server, never the password. Null when the service doesn't answer (sign-up goes on).
 */
async function timesBreached(password: string): Promise<number | null> {
  const sha = createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`, { headers: { "Add-Padding": "true" }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    for (const line of (await res.text()).split("\n")) {
      const [suffix, count] = line.trim().split(":");
      if (suffix === sha.slice(5)) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const username = String(formData.get("username") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!HUNTER_NAME.test(username)) return { error: "Hunter name must be 3–20 letters, numbers or underscores." };
  if (!EMAIL.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (((await timesBreached(password)) ?? 0) > 0) {
    return { error: "That password has appeared in a data breach elsewhere, so it isn't safe. Choose a different one." };
  }

  const supabase = await createClient();

  const { data: available, error: checkError } = await supabase.rpc("username_available", { name: username });
  if (checkError) return { error: "Couldn't check that hunter name. Please try again." };
  if (!available) return { error: "That hunter name isn't available. Try another." };

  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
      emailRedirectTo: `${origin}/auth/confirm?next=/onboarding`,
    },
  });
  if (error) return { error: error.message };

  // With email confirmation switched off, Supabase signs the player in straight away.
  if (data.session) redirect("/onboarding");

  return { message: `We've sent a confirmation link to ${email}. Open it to activate your hunter.` };
}

export async function logIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      error: /confirm/i.test(error.message)
        ? "Please confirm your email first. Check your inbox for the link."
        : "Wrong email or password.",
    };
  }

  redirect(next);
}

export async function logOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in · Loota" };

export default function LoginPage() {
  // LoginForm reads ?next= and ?error= from the URL, which is only known at request time.
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create your hunter · Loota" };

export default function SignupPage() {
  return <SignupForm />;
}

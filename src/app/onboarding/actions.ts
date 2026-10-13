"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveLookFromForm } from "@/lib/save-look";

export type OnboardingState = { error?: string } | undefined;

export async function finishOnboarding(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const rawLng = String(formData.get("lng") ?? "");
  const rawLat = String(formData.get("lat") ?? "");
  const lng = Number(rawLng);
  const lat = Number(rawLat);
  if (!rawLng || !rawLat || !Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { error: "Share your location so we know where you start." };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const id = auth?.claims?.sub;
  if (!id) redirect("/login?next=/onboarding");

  const lookError = await saveLookFromForm(supabase, id, formData);
  if (lookError) return { error: lookError };

  const { error: homeError } = await supabase.rpc("set_home", { lng, lat });
  if (homeError) {
    return {
      error: homeError.message.includes("30 days")
        ? "Your home was set recently. It can only move once every 30 days."
        : "Couldn't save your starting point. Please try again.",
    };
  }

  redirect("/lobby");
}

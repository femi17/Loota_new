import { isValidLook } from "@/lib/avatar";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Validate a look sent from a form (as JSON) and save it to the player's profile. */
export async function saveLookFromForm(supabase: Supabase, playerId: string, formData: FormData) {
  let look: unknown;
  try {
    look = JSON.parse(String(formData.get("look") ?? ""));
  } catch {
    return "Something went wrong with your look. Please try again.";
  }
  if (!isValidLook(look)) return "Pick an option for every part of your look.";

  const { error } = await supabase.from("profiles").update({ avatar: look }).eq("id", playerId);
  return error ? "Couldn't save your look. Please try again." : null;
}

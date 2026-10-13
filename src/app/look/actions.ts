"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveLookFromForm } from "@/lib/save-look";

export type LookState = { error?: string } | undefined;

export async function saveLook(_prev: LookState, formData: FormData): Promise<LookState> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const id = auth?.claims?.sub;
  if (!id) redirect("/login?next=/look");

  const error = await saveLookFromForm(supabase, id, formData);
  if (error) return { error };

  redirect("/lobby");
}

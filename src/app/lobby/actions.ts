"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function joinHunt(formData: FormData) {
  const hunt = String(formData.get("hunt") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(hunt)) redirect("/lobby");
  const supabase = await createClient();
  const { data } = await supabase.rpc("join_hunt", { p_hunt: hunt });
  if (!(data as { ok: boolean } | null)?.ok) redirect("/lobby");
  redirect(`/play?hunt=${hunt}`);
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlayer } from "@/lib/player";
import { PENALTY_SCENES } from "@/game/penaltyScenes";

const SCENES = Object.keys(PENALTY_SCENES);
const EFFECTS = ["wait", "coins", "energy", "back"];

async function owner() {
  const player = await getPlayer();
  if (!player?.isAdmin) redirect("/lobby");
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
function back(to: string, message: string, error = false) {
  redirect(`${to}${to.includes("?") ? "&" : "?"}${error ? "error" : "message"}=${encodeURIComponent(message)}`);
}

/** Change a penalty's wording, cost or scene, or retire it (owner, 31 Oct 2026: the penalties, editable in the admin). */
export async function updatePenalty(form: FormData) {
  await owner();
  const to = text(form, "back") || "/admin/penalties";
  const code = text(form, "code");
  const amount = Number(text(form, "amount"));
  const title = text(form, "title");
  const body = text(form, "body");
  const scene = text(form, "scene");
  if (!code || !title || body.length < 10) back(to, "A penalty needs a title and a story of at least 10 letters.", true);
  if (!Number.isInteger(amount) || amount < 1 || amount > 3600) back(to, "The amount must be a whole number from 1 to 3600.", true);
  if (!SCENES.includes(scene)) back(to, "Choose a scene from the list.", true);
  const { error } = await createAdminClient()
    .from("penalties")
    .update({ title: title.slice(0, 80), body: body.slice(0, 600), amount, scene, active: form.get("active") === "on" })
    .eq("code", code);
  if (error) back(to, error.message, true);
  revalidatePath("/admin/penalties");
  back(to, `Saved: ${title}.`);
}

/** Add a new penalty to the table: the server deals it like the others. */
export async function addPenalty(form: FormData) {
  await owner();
  const tier = text(form, "tier");
  const effect = text(form, "effect");
  const amount = Number(text(form, "amount"));
  const title = text(form, "title");
  const body = text(form, "body");
  const scene = text(form, "scene");
  const to = "/admin/penalties";
  if (!["soft", "deep"].includes(tier) || !EFFECTS.includes(effect)) back(to, "Choose a kind and a cost.", true);
  if (effect === "back" && tier !== "deep") back(to, "Only a deep penalty (the wrong place) can send someone back.", true);
  if (!title || body.length < 10) back(to, "A penalty needs a title and a story of at least 10 letters.", true);
  if (!Number.isInteger(amount) || amount < 1 || amount > 3600) back(to, "The amount must be a whole number from 1 to 3600.", true);
  if (!SCENES.includes(scene)) back(to, "Choose a scene from the list.", true);
  const code = `own-${tier}-${Date.now().toString(36)}`;
  const { error } = await createAdminClient()
    .from("penalties")
    .insert({ code, tier, effect, amount: effect === "back" ? 1 : amount, title: title.slice(0, 80), body: body.slice(0, 600), scene });
  if (error) back(to, error.message, true);
  revalidatePath("/admin/penalties");
  back(to, `Added: ${title}.`);
}

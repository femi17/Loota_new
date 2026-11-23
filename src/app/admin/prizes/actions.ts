"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlayer } from "@/lib/player";
import { hashPrizeCode, sendFinishEmail } from "@/lib/prize";

async function owner() {
  const player = await getPlayer();
  if (!player?.isAdmin) redirect("/lobby");
}
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const UUID = /^[0-9a-f-]{36}$/i;
const back = (message: string, error = false): never => redirect(`/admin/prizes?${error ? "error" : "message"}=${encodeURIComponent(message)}`);

export type CodeCheck =
  | { ok: false; reason: string }
  | {
      ok: true;
      hunt: string;
      huntTitle: string;
      prize: string;
      user: string;
      name: string;
      email: string;
      place: number;
      finishedAt: string | null;
      paidAt: string | null;
      paidNote: string | null;
    };

/**
 * Checks a prize code a winner sent (owner, 23 Nov 2026: "we verify the token matches the one in the database"): its
 * hash against prize_claims. Shows whose it is, so the owner pays the right person (and the email it was sent to, to
 * match the reply).
 */
export async function checkPrizeCode(_prev: CodeCheck | undefined, form: FormData): Promise<CodeCheck> {
  await owner();
  const code = text(form, "code");
  if (code.replace(/[^A-Za-z0-9]/g, "").length < 8) return { ok: false, reason: "That isn't a whole code (LOOTA-XXXX-XXXX)." };
  const db = createAdminClient();
  const { data: claim } = await db
    .from("prize_claims")
    .select("hunt_id, user_id, place, winner, email_to, paid_at, paid_note")
    .eq("code_hash", hashPrizeCode(code))
    .maybeSingle();
  if (!claim || !claim.winner) return { ok: false, reason: "No match: this code isn't in our records (or a newer code replaced it). Don't pay it." };
  const [{ data: hunt }, { data: profile }, { data: me }] = await Promise.all([
    db.from("hunts").select("title, prize").eq("id", claim.hunt_id).maybeSingle(),
    db.from("profiles").select("username").eq("id", claim.user_id).maybeSingle(),
    db.from("hunt_players").select("finished_at").eq("hunt_id", claim.hunt_id).eq("user_id", claim.user_id).maybeSingle(),
  ]);
  return {
    ok: true,
    hunt: claim.hunt_id,
    huntTitle: hunt?.title ?? "?",
    prize: hunt?.prize ?? "?",
    user: claim.user_id,
    name: profile?.username ?? "?",
    email: claim.email_to ?? "?",
    place: claim.place,
    finishedAt: me?.finished_at ?? null,
    paidAt: claim.paid_at,
    paidNote: claim.paid_note,
  };
}

/** Records that a winner has been paid (once), with a note such as the bank transfer's reference. */
export async function markPaid(form: FormData) {
  await owner();
  const hunt = text(form, "hunt");
  const user = text(form, "user");
  if (!UUID.test(hunt) || !UUID.test(user)) back("Unknown winner.", true);
  const note = text(form, "note").slice(0, 200) || null;
  const { data } = await createAdminClient()
    .from("prize_claims")
    .update({ paid_at: new Date().toISOString(), paid_note: note })
    .eq("hunt_id", hunt)
    .eq("user_id", user)
    .eq("winner", true)
    .is("paid_at", null)
    .select("user_id");
  revalidatePath("/admin/prizes");
  back(data?.length ? "Marked as paid." : "Already marked as paid (or not a winner).", !data?.length);
}

/** Sends a winner's email now (it hadn't gone), or again with a new code (the old code stops working). */
export async function resendPrizeEmail(form: FormData) {
  await owner();
  const hunt = text(form, "hunt");
  const user = text(form, "user");
  if (!UUID.test(hunt) || !UUID.test(user)) back("Unknown winner.", true);
  const h = await headers();
  const site = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const r = await sendFinishEmail(hunt, user, site, text(form, "again") === "1");
  revalidatePath("/admin/prizes");
  if (r.status === "sent") back(`Sent to ${r.to}.`);
  back(
    r.status === "no-email-service"
      ? "Email isn't set up yet: add RESEND_API_KEY in Vercel (see the note at the top)."
      : r.status === "not-finished"
        ? "That hunter hasn't finished the hunt."
        : "The email didn't go. Try again in a minute.",
    true,
  );
}

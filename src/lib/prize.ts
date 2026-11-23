import { createHash, randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The finish email and the prize code (owner, 23 Nov 2026: "User should get an email after getting the whole key, and
 * we verify the token matches the one in the database to verify"). Every hunter who collects every key gets an email;
 * a winner's holds a one-off prize code (LOOTA-XXXX-XXXX). Only its SHA-256 is kept (prize_claims.code_hash), so the
 * owner checks a code at /admin/prizes and nobody reading the database can claim a prize with it.
 *
 * Sent through Resend (https://resend.com): RESEND_API_KEY in the hosting's settings, and the sending domain verified
 * there. EMAIL_FROM (default "Loota <prizes@playloota.com>") and EMAIL_REPLY_TO (where winners reply) are optional.
 * Server only.
 */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L: read out over the phone
export function newPrizeCode() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `LOOTA-${part()}-${part()}`;
}
/** The stored form of a code, however it was typed ("loota 7kq3 9xpm", "7KQ39XPM"). */
export function hashPrizeCode(code: string) {
  const bare = code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^LOOTA/, "");
  return createHash("sha256").update(bare).digest("hex");
}
/** "ada@gmail.com" → "a**@gmail.com". */
export const maskEmail = (email: string) => email.replace(/^(.)(.*)(@.*)$/, (_, a: string, b: string, c: string) => `${a}${"*".repeat(Math.min(b.length, 6))}${c}`);

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const emailReady = () => Boolean(process.env.RESEND_API_KEY);

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Loota <prizes@playloota.com>",
      to: [to],
      subject,
      html,
      text,
      ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return Boolean(res?.ok);
}

function finishEmail(o: { name: string; hunt: string; prize: string; place: number; winners: number; code: string | null; site: string }) {
  const rules = `${o.site}/rules`;
  if (o.code) {
    const subject = `You won! Your Loota prize code for ${o.hunt}`;
    const text = [
      `Well done, ${o.name}!`,
      `You collected every key in ${o.hunt} and finished ${ordinal(o.place)}. You've won: ${o.prize}.`,
      `Your prize code: ${o.code}`,
      `To claim it, reply to this email with the code, your full name and a bank account in your own name. We check the code against our records before paying. Keep it private: anyone with it could try to claim your prize.`,
      `The prize rules: ${rules}`,
    ].join("\n\n");
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1b1206">
<h1 style="color:#b8860b">You won, ${esc(o.name)}!</h1>
<p>You collected every key in <b>${esc(o.hunt)}</b> and finished <b>${ordinal(o.place)}</b>. You've won: <b>${esc(o.prize)}</b>.</p>
<p>Your prize code:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:3px;background:#fff4d6;border:2px solid #f4b41a;border-radius:12px;padding:14px;text-align:center">${o.code}</p>
<p>To claim it, <b>reply to this email</b> with the code, your full name and a bank account in your own name. We check the code against our records before paying.</p>
<p style="color:#6b5a3e">Keep it private: anyone with it could try to claim your prize. <a href="${rules}">The prize rules</a></p>
</div>`;
    return { subject, text, html };
  }
  const subject = `You finished ${o.hunt}!`;
  const text = [
    `Well done, ${o.name}!`,
    `You collected every key in ${o.hunt} and finished ${ordinal(o.place)}. The prize went to the first ${o.winners === 1 ? "hunter" : `${o.winners} hunters`} to finish; be quicker next time!`,
    `The next hunt: ${o.site}`,
  ].join("\n\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1b1206">
<h1 style="color:#b8860b">Hunt complete, ${esc(o.name)}!</h1>
<p>You collected every key in <b>${esc(o.hunt)}</b> and finished <b>${ordinal(o.place)}</b>.</p>
<p>The prize went to the first ${o.winners === 1 ? "hunter" : `${o.winners} hunters`} to finish: be quicker next time!</p>
<p><a href="${o.site}">The next hunt</a></p>
</div>`;
  return { subject, text, html };
}

export type FinishEmail =
  | { status: "not-finished" }
  | { status: "sent"; to: string; winner: boolean }
  | { status: "sending" | "failed" | "no-email-service"; winner: boolean };

/**
 * Emails a hunter who has finished a hunt (once; `again` sends a new code, which replaces the old one). Safe to call
 * any number of times: the first call records the finish in prize_claims, and a short claim (sending_at) stops two
 * calls sending two different codes.
 */
export async function sendFinishEmail(huntId: string, userId: string, site: string, again = false): Promise<FinishEmail> {
  const db = createAdminClient();
  const [{ data: me }, { data: hunt }] = await Promise.all([
    db.from("hunt_players").select("finished_at, place").eq("hunt_id", huntId).eq("user_id", userId).maybeSingle(),
    db.from("hunts").select("title, prize, winners").eq("id", huntId).maybeSingle(),
  ]);
  if (!me?.finished_at || !me.place || !hunt) return { status: "not-finished" };
  const winner = me.place <= hunt.winners;
  await db.from("prize_claims").upsert({ hunt_id: huntId, user_id: userId, place: me.place, winner }, { onConflict: "hunt_id,user_id", ignoreDuplicates: true });
  const { data: claim } = await db.from("prize_claims").select("emailed_at, email_to").eq("hunt_id", huntId).eq("user_id", userId).single();
  if (claim?.emailed_at && !again) return { status: "sent", to: maskEmail(claim.email_to ?? ""), winner };
  if (!emailReady()) return { status: "no-email-service", winner };

  // Claim the send for two minutes (a second call meanwhile waits)
  const stale = new Date(Date.now() - 120_000).toISOString();
  let lock = db.from("prize_claims").update({ sending_at: new Date().toISOString() }).eq("hunt_id", huntId).eq("user_id", userId).or(`sending_at.is.null,sending_at.lt.${stale}`);
  if (!again) lock = lock.is("emailed_at", null);
  const { data: locked } = await lock.select("hunt_id");
  if (!locked?.length) return { status: "sending", winner };

  const [{ data: user }, { data: profile }] = await Promise.all([db.auth.admin.getUserById(userId), db.from("profiles").select("username").eq("id", userId).maybeSingle()]);
  const email = user?.user?.email;
  if (!email) {
    await db.from("prize_claims").update({ sending_at: null }).eq("hunt_id", huntId).eq("user_id", userId);
    return { status: "failed", winner };
  }
  const code = winner ? newPrizeCode() : null;
  const mail = finishEmail({ name: profile?.username ?? "hunter", hunt: hunt.title, prize: hunt.prize, place: me.place, winners: hunt.winners, code, site });
  const ok = await sendEmail(email, mail.subject, mail.html, mail.text);
  await db
    .from("prize_claims")
    .update(ok ? { sending_at: null, emailed_at: new Date().toISOString(), email_to: email, code_hash: code ? hashPrizeCode(code) : null } : { sending_at: null })
    .eq("hunt_id", huntId)
    .eq("user_id", userId);
  return ok ? { status: "sent", to: maskEmail(email), winner } : { status: "failed", winner };
}

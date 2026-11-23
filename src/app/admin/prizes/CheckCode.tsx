"use client";

import { useActionState } from "react";
import { checkPrizeCode, markPaid } from "./actions";

const field = "h-11 rounded-xl border-[1.5px] border-line bg-ink px-3 text-paper outline-none focus:border-gold";
const lagos = (iso: string) => new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

/** Paste the code a winner sent; it's checked against the database, and the winner can be marked as paid. */
export function CheckCode() {
  const [result, action, pending] = useActionState(checkPrizeCode, undefined);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-wrap gap-3">
        <input name="code" required placeholder="LOOTA-XXXX-XXXX" autoComplete="off" spellCheck={false} className={`${field} min-w-0 flex-1 uppercase tracking-widest`} aria-label="Prize code" />
        <button type="submit" disabled={pending} className="h-11 rounded-xl bg-gold px-5 font-bold text-ink disabled:opacity-60">
          {pending ? "Checking…" : "Check the code"}
        </button>
      </form>
      {result && !result.ok && (
        <p role="alert" className="rounded-xl border border-danger/60 bg-danger/10 px-4 py-3 text-sm text-danger-text" data-code-result="no">
          ✗ {result.reason}
        </p>
      )}
      {result?.ok && (
        <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-gold p-4 text-sm" data-code-result="yes">
          <p className="text-base font-bold text-gold">✓ The code matches our records</p>
          <p>
            <b>{result.name}</b> ({result.email}) finished <b>{result.huntTitle}</b> in place {result.place}
            {result.finishedAt ? `, ${lagos(result.finishedAt)}` : ""}. Prize: <b>{result.prize}</b>.
          </p>
          <p className="text-muted">Check the reply came from that email address, and pay only into an account in the winner&apos;s own name.</p>
          {result.paidAt ? (
            <p className="font-bold">
              Already paid on {lagos(result.paidAt)}
              {result.paidNote ? ` (${result.paidNote})` : ""}. Don&apos;t pay twice.
            </p>
          ) : (
            <form action={markPaid} className="flex flex-wrap gap-3">
              <input type="hidden" name="hunt" value={result.hunt} />
              <input type="hidden" name="user" value={result.user} />
              <input name="note" maxLength={200} placeholder="Transfer reference (optional)" className={`${field} min-w-0 flex-1`} />
              <button type="submit" className="h-11 rounded-xl border-[1.5px] border-gold px-4 font-bold">
                Mark as paid
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

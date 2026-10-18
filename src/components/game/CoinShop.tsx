"use client";

import { useState } from "react";
import { COIN_PACKS, packBonus, type CoinPack } from "@/game/coinPacks";

/** Paystack's payment window (https://js.paystack.co/v2/inline.js). */
type PaystackPopup = {
  resumeTransaction: (
    accessCode: string,
    callbacks: { onSuccess?: (t: unknown) => void; onCancel?: () => void; onError?: (e: { message?: string }) => void; onLoad?: () => void },
  ) => void;
};
declare global {
  interface Window {
    PaystackPop?: new () => PaystackPopup;
  }
}

let loading: Promise<boolean> | null = null;
/** Load Paystack's payment window once; false if it can't be (then the player goes to Paystack's page instead). */
function loadPaystack(): Promise<boolean> {
  if (window.PaystackPop) return Promise.resolve(true);
  loading ??= new Promise<boolean>((resolve) => {
    const s = document.createElement("script");
    s.src = "https://js.paystack.co/v2/inline.js";
    s.async = true;
    s.onload = () => resolve(!!window.PaystackPop);
    s.onerror = () => {
      loading = null;
      resolve(false);
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Open Paystack's window on a payment our server started; false if the window isn't there. */
function openPaystack(accessCode: string, callbacks: Parameters<PaystackPopup["resumeTransaction"]>[1]) {
  const Popup = window.PaystackPop;
  if (!Popup) return false;
  new Popup().resumeTransaction(accessCode, callbacks);
  return true;
}

/** Ask our server whether a payment went through (it asks Paystack); a few tries while Paystack is still settling it. */
export async function confirmPayment(reference: string): Promise<{ ok: true; coins: number; balance: number } | { ok: false; message: string }> {
  for (let i = 0; i < 6; i++) {
    const res = await fetch("/api/coins/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference }) });
    const r = (await res.json().catch(() => null)) as { ok?: boolean; coins?: number; balance?: number; pending?: boolean; failed?: boolean; error?: string } | null;
    if (r?.ok && r.coins != null && r.balance != null) return { ok: true, coins: r.coins, balance: r.balance };
    if (r?.failed) return { ok: false, message: "The payment didn't go through, so nothing was charged for coins." };
    if (r?.error) return { ok: false, message: r.error };
    await new Promise((done) => setTimeout(done, 2000));
  }
  return { ok: false, message: "Paystack is still confirming your payment. Your coins arrive as soon as it does." };
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/**
 * Buying coins (design doc 10.1): the packs with their naira prices (the only place naira appear), paid through
 * Paystack's window over the game; the coins arrive once our server has checked the payment with Paystack.
 */
export function CoinShop({
  coins,
  notice = null,
  onPaid,
  onClose,
}: {
  coins: number;
  /** How a payment made on Paystack's own page went (back in the game from it). */
  notice?: { text: string; good: boolean } | null;
  onPaid: (balance: number, added: number) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(notice);
  const test = (process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "").startsWith("pk_test_");

  async function buy(pack: CoinPack) {
    setBusy(pack.id);
    setMessage(null);
    try {
      const res = await fetch("/api/coins/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack: pack.id }) });
      const r = (await res.json().catch(() => null)) as { reference?: string; accessCode?: string; url?: string; error?: string } | null;
      if (!r?.reference || !r.accessCode) {
        setMessage({ text: r?.error ?? "Couldn't start the payment. Try again.", good: false });
        setBusy(null);
        return;
      }
      const reference = r.reference;
      const ready = await loadPaystack();
      const opened =
        ready &&
        openPaystack(r.accessCode, {
        onSuccess: () => {
          void confirmPayment(reference).then((done) => {
            setBusy(null);
            if (done.ok) {
              setMessage({ text: `+${done.coins.toLocaleString("en-NG")} coins! Thank you.`, good: true });
              onPaid(done.balance, done.coins);
            } else setMessage({ text: done.message, good: false });
          });
        },
        onCancel: () => {
          setBusy(null);
          setMessage({ text: "Payment cancelled: nothing was charged.", good: false });
        },
        onError: (e) => {
          setBusy(null);
          setMessage({ text: e?.message ?? "The payment window had a problem. Try again.", good: false });
        },
      });
      // No payment window: Paystack's own page, which sends the player back to /play?paid=… to be checked.
      if (!opened && r.url) window.location.assign(r.url);
    } catch {
      setBusy(null);
      setMessage({ text: "Couldn't reach the shop. Check your connection.", good: false });
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/60 sm:items-center" onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-label="Buy coins" className="max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl bg-ink p-5 sm:max-w-md sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold">Buy coins</h2>
            <p className="text-sm text-muted">You have {coins.toLocaleString("en-NG")} coins. Coins pay for rides, fuel, food, repairs and vehicles.</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink-2 disabled:opacity-40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-2">
          {COIN_PACKS.map((p) => {
            const bonus = packBonus(p);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void buy(p)}
                  aria-label={`${p.name}: ${p.coins} coins for ${naira(p.naira)}`}
                  className="relative flex w-full flex-col items-start gap-0.5 rounded-2xl bg-ink-2 p-3 text-left ring-1 ring-line hover:ring-gold disabled:opacity-50"
                >
                  {bonus > 0 && <span className="absolute right-2 top-2 rounded-full bg-gold px-1.5 text-[10px] font-extrabold text-ink">+{bonus}%</span>}
                  <span className="text-xs text-muted">{p.name}</span>
                  <span className="flex items-center gap-1 font-display text-xl font-extrabold">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F4B41A" strokeWidth="2.4" aria-hidden="true">
                      <circle cx="12" cy="12" r="8.5" />
                    </svg>
                    {p.coins.toLocaleString("en-NG")}
                  </span>
                  <span className="text-sm font-bold text-gold">{busy === p.id ? "Opening Paystack…" : naira(p.naira)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {message && (
          <p className={`mt-3 rounded-xl p-3 text-sm font-bold ${message.good ? "bg-[#1E9E62]/20 text-[#3DD68C]" : "bg-ink-2 text-paper"}`} role="status">
            {message.text}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">Payments by Paystack: cards, bank transfer and USSD. Coins arrive as soon as Paystack confirms.</p>
        {test && (
          <p className="mt-2 rounded-xl bg-[#3B2F0A] p-2 text-xs text-gold">
            Test mode: no real money. Use Paystack&apos;s test card 4084 0840 8408 4081, any future expiry, CVV 408, PIN 0000, OTP 123456.
          </p>
        )}
      </div>
    </div>
  );
}

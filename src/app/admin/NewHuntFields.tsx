"use client";

import { useState, type ReactNode } from "react";
import { NIGERIA_STATES } from "@/lib/hunt-area";

const field = "h-11 rounded-xl border-[1.5px] border-line bg-ink px-3 text-paper outline-none focus:border-gold";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

/**
 * The day, hours and area of a new hunt (owner, 23 Nov 2026: make the hunt page "sufficient for adding daily hunt,
 * like picking a state, a country or worldwide"). Hours stay within 9 am – 9 pm, Lagos time: the game rests at night.
 */
// The countries come from the server: browsers name a few differently from the server (a mismatch on hydration).
export function NewHuntFields({ firstDay, lastDay, defaultDay, taken, countries }: { firstDay: string; lastDay: string; defaultDay: string; taken: Record<string, string>; countries: { code: string; name: string }[] }) {
  const [day, setDay] = useState(defaultDay);
  const [where, setWhere] = useState<"world" | "country" | "state">("state");
  const [country, setCountry] = useState("NG");
  const hasHunt = taken[day];
  return (
    <>
      <Field label="Day" hint={hasHunt ? `Taken: ${hasHunt}` : "One hunt a day"}>
        <input name="day" type="date" min={firstDay} max={lastDay} value={day} onChange={(e) => setDay(e.target.value)} required className={field} />
      </Field>
      <Field label="Starts (Lagos time)">
        <input name="start" type="time" min="09:00" max="20:00" step={900} defaultValue="09:00" required className={field} />
      </Field>
      <Field label="Ends (Lagos time)" hint="Between 9 am and 9 pm">
        <input name="end" type="time" min="10:00" max="21:00" step={900} defaultValue="21:00" required className={field} />
      </Field>
      <Field label="Where">
        <select name="region" value={where} onChange={(e) => setWhere(e.target.value as typeof where)} className={field} aria-label="Where the keys are">
          <option value="world">🌍 Worldwide</option>
          <option value="country">A country</option>
          <option value="state">A state</option>
        </select>
      </Field>
      {where !== "world" && (
        <Field label="Country">
          <select name="country" value={country} onChange={(e) => setCountry(e.target.value)} className={field}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {where === "state" &&
        (country === "NG" ? (
          <Field label="State">
            <select name="state" defaultValue="Lagos" className={field}>
              {NIGERIA_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="State or region" hint="As the map names it, e.g. Greater Accra">
            <input name="state" required minLength={2} maxLength={60} className={field} />
          </Field>
        ))}
    </>
  );
}

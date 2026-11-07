"use client";

import { useActionState, useEffect, useState } from "react";
import { finishOnboarding } from "./actions";
import { LookEditor } from "@/components/LookEditor";
import { FormMessage, primaryButton } from "@/components/FormField";
import type { AvatarLook } from "@/lib/avatar";

type Place = { status: "idle" | "locating" | "error"; message?: string } | { status: "found"; lng: number; lat: number; name: string };
type Found = { name: string; detail: string; lng: number; lat: number };

/**
 * Starting places to pick instead of sharing a real location (owner, 5 Nov 2026: "instead of picking their real
 * location, they should also have a choice to pick any default location"): popular cities, each a central street.
 */
const CITIES: { name: string; lng: number; lat: number }[] = [
  { name: "Lagos", lng: 3.3792, lat: 6.5244 },
  { name: "Abuja", lng: 7.4951, lat: 9.0579 },
  { name: "Port Harcourt", lng: 7.0134, lat: 4.8156 },
  { name: "Kano", lng: 8.5167, lat: 12.0001 },
  { name: "Ibadan", lng: 3.8964, lat: 7.3775 },
  { name: "Enugu", lng: 7.4951, lat: 6.4584 },
  { name: "Accra", lng: -0.187, lat: 5.6037 },
  { name: "Nairobi", lng: 36.8219, lat: -1.2921 },
  { name: "Johannesburg", lng: 28.0473, lat: -26.2041 },
  { name: "Cairo", lng: 31.2357, lat: 30.0444 },
  { name: "London", lng: -0.1276, lat: 51.5072 },
  { name: "Paris", lng: 2.3522, lat: 48.8566 },
  { name: "Dubai", lng: 55.2708, lat: 25.2048 },
  { name: "New York", lng: -73.9857, lat: 40.7484 },
  { name: "Tokyo", lng: 139.7006, lat: 35.6595 },
];

export function OnboardingForm({ username, initialLook }: { username: string; initialLook: AvatarLook }) {
  const [look, setLook] = useState(initialLook);
  const [place, setPlace] = useState<Place>({ status: "idle" });
  const [state, action, pending] = useActionState(finishOnboarding, undefined);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);

  function locate() {
    if (!navigator.geolocation) {
      setPlace({ status: "error", message: "This browser can't share your location. Pick a city or search for a place instead." });
      return;
    }
    setPlace({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({
        status: "found",
        name: "Where you are now",
        lng: Math.round(pos.coords.longitude * 1e5) / 1e5,
        lat: Math.round(pos.coords.latitude * 1e5) / 1e5,
      }),
      () => setPlace({ status: "error", message: "We couldn't get your location. Allow location access, or pick a city or search for a place instead." }),
      { enableHighAccuracy: false, timeout: 15000 },
    );
  }

  // Searching for anywhere in the world, as the player types (the map's own place search)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    let live = true;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&lng=3.3792&lat=6.5244`);
        const data = (await res.json().catch(() => null)) as { places?: Found[] } | null;
        if (live) setResults(data?.places ?? []);
      } finally {
        if (live) setSearching(false);
      }
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [query]);

  const found = place.status === "found";

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-extrabold">Set up {username}</h1>
        <p className="text-muted">Make your hunter yours, then set where your journey starts.</p>
      </div>

      <LookEditor look={look} onChange={setLook} />

      <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-line p-4" data-start>
        <div className="flex flex-col gap-1">
          <span className="font-bold">Your starting point is home</span>
          <span className="text-sm text-muted">
            Start where you are, or anywhere you like: pick a city or search for a place. You can move home once every 30 days.
          </span>
        </div>
        {found && (
          <p role="status" className="rounded-xl bg-ok/15 px-3 py-2 text-sm font-bold text-ok" data-start-chosen>
            🏠 {place.name}
          </p>
        )}
        <button
          type="button"
          onClick={locate}
          disabled={place.status === "locating"}
          className="h-11 rounded-xl bg-ink-2 px-4 font-bold text-paper hover:bg-line disabled:cursor-wait"
        >
          {place.status === "locating" ? "Finding you…" : "📍 Use my location"}
        </button>
        {place.status === "error" && <p role="alert" className="text-sm text-danger-text">{place.message}</p>}

        <span className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Or pick a city</span>
        <div className="flex flex-wrap gap-2" aria-label="Cities">
          {CITIES.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setPlace({ status: "found", name: c.name, lng: c.lng, lat: c.lat })}
              className={`h-9 rounded-full px-3 text-sm font-bold ring-1 ${found && place.name === c.name ? "bg-gold text-ink ring-gold" : "bg-ink-2 text-paper ring-line"}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <span className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Or search anywhere</span>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length < 3) setResults(null);
          }}
          placeholder="A town, a street, a landmark…"
          aria-label="Search for a starting place"
          className="h-11 rounded-xl border-[1.5px] border-line bg-ink-2 px-3 text-paper outline-none focus:border-gold"
        />
        {searching && <p className="text-xs text-muted">Searching…</p>}
        {results && !searching && (
          <ul className="flex flex-col gap-1" aria-label="Places found">
            {results.length === 0 && <li className="text-sm text-muted">Nothing found. Try another name.</li>}
            {results.map((r, i) => (
              <li key={`${r.name}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    setPlace({ status: "found", name: [r.name, r.detail].filter(Boolean).join(", "), lng: r.lng, lat: r.lat });
                    setResults(null);
                    setQuery("");
                  }}
                  className="w-full rounded-lg bg-ink-2 px-3 py-2 text-left text-sm hover:bg-line"
                >
                  <span className="font-bold">{r.name}</span>
                  {r.detail && <span className="block text-xs text-muted">{r.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <input type="hidden" name="look" value={JSON.stringify(look)} />
      <input type="hidden" name="lng" value={found ? place.lng : ""} />
      <input type="hidden" name="lat" value={found ? place.lat : ""} />

      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending || !found} className={primaryButton}>
        {pending ? "Saving…" : found ? "Start hunting" : "Choose where you start to continue"}
      </button>
    </form>
  );
}

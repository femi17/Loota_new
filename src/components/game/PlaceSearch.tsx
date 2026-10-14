"use client";

import { useEffect, useRef, useState } from "react";
import type { LngLat } from "@/game/geo";
import type { Place } from "@/game/places";

const metres = (a: LngLat, b: LngLat) => {
  const k = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lng - a.lng) * 111320 * k, (b.lat - a.lat) * 110574);
};
const distance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`);

/**
 * Type a place or address; pick a result to plot a route there. Places near the hunter come first.
 * `inline` lists the results below the box instead of floating over the map (inside a scrolling panel).
 */
export function PlaceSearch({ near, onPick, inline = false }: { near: () => LngLat; onPick: (place: Place) => void; inline?: boolean }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<(Place & { away: number })[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "none" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null); // the place chosen (no need to search it again)
  // The map's position changes constantly; read the latest when searching.
  const nearRef = useRef(near);
  useEffect(() => {
    nearRef.current = near;
  });

  // Search a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || q === picked) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("searching");
      const here = nearRef.current();
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&lng=${here.lng}&lat=${here.lat}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { places: Place[] };
        const found = data.places.map((p) => ({ ...p, away: metres(here, p) }));
        setPlaces(found);
        setStatus(found.length ? "idle" : "none");
        setOpen(true);
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, picked]);

  const pick = (place: Place) => {
    setPicked(place.name);
    setQuery(place.name);
    setOpen(false);
    onPick(place);
  };

  return (
    <div className="pointer-events-auto relative w-full max-w-md">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (places[0]) pick(places[0]);
        }}
        className="flex h-11 items-center gap-2 rounded-xl bg-ink px-3"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-muted">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setPicked(null);
            setQuery(e.target.value);
            if (e.target.value.trim().length < 3) {
              setPlaces([]);
              setOpen(false);
              setStatus("idle");
            }
          }}
          onFocus={() => places.length && setOpen(true)}
          placeholder="Search a place or address"
          aria-label="Search a place or address"
          enterKeyHint="go"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-paper outline-none placeholder:text-muted"
        />
        {status === "searching" && <span className="text-xs text-muted">Searching…</span>}
      </form>

      {(open || status === "none" || status === "error") && query.trim().length >= 3 && query !== picked && (
        <ul
          className={`${inline ? "mt-2" : "absolute inset-x-0 top-12 z-10 shadow-lg"} flex max-h-72 flex-col overflow-y-auto rounded-xl bg-ink p-1`}
          role="listbox"
          aria-label="Places found"
        >
          {status === "none" && <li className="p-3 text-sm text-muted">No places found. Try a street, area or landmark name.</li>}
          {status === "error" && <li className="p-3 text-sm text-muted">Place search isn&apos;t available right now. Tap the map instead.</li>}
          {status !== "error" &&
            places.map((place, i) => (
              <li key={`${place.lng},${place.lat},${i}`} role="option" aria-selected={false}>
                <button type="button" onClick={() => pick(place)} className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-ink-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-bold">{place.name}</span>
                    {place.detail && <span className="truncate text-xs text-muted">{place.detail}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{distance(place.away)}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

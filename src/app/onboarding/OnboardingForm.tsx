"use client";

import { useActionState, useState } from "react";
import { finishOnboarding } from "./actions";
import { LookEditor } from "@/components/LookEditor";
import { FormMessage, primaryButton } from "@/components/FormField";
import type { AvatarLook } from "@/lib/avatar";

type Place = { status: "idle" | "locating" | "error"; message?: string } | { status: "found"; lng: number; lat: number };

export function OnboardingForm({ username, initialLook }: { username: string; initialLook: AvatarLook }) {
  const [look, setLook] = useState(initialLook);
  const [place, setPlace] = useState<Place>({ status: "idle" });
  const [state, action, pending] = useActionState(finishOnboarding, undefined);

  function locate() {
    if (!navigator.geolocation) {
      setPlace({ status: "error", message: "This browser can't share your location." });
      return;
    }
    setPlace({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({
        status: "found",
        lng: Math.round(pos.coords.longitude * 1e5) / 1e5,
        lat: Math.round(pos.coords.latitude * 1e5) / 1e5,
      }),
      () => setPlace({ status: "error", message: "We couldn't get your location. Allow location access for this site and try again." }),
      { enableHighAccuracy: false, timeout: 15000 },
    );
  }

  const found = place.status === "found";

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-extrabold">Set up {username}</h1>
        <p className="text-muted">Make your hunter yours, then set where your journey starts.</p>
      </div>

      <LookEditor look={look} onChange={setLook} />

      <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-line p-4">
        <div className="flex flex-col gap-1">
          <span className="font-bold">Your starting point is home</span>
          <span className="text-sm text-muted">
            We read your location once to place you on the map. You can move home once every 30 days.
          </span>
        </div>
        {found ? (
          <p role="status" className="text-sm text-ok">Location found ({place.lat.toFixed(3)}, {place.lng.toFixed(3)})</p>
        ) : (
          <button
            type="button"
            onClick={locate}
            disabled={place.status === "locating"}
            className="h-11 rounded-xl bg-ink-2 px-4 font-bold text-paper hover:bg-line disabled:cursor-wait"
          >
            {place.status === "locating" ? "Finding you…" : "Use my location"}
          </button>
        )}
        {place.status === "error" && <p role="alert" className="text-sm text-danger-text">{place.message}</p>}
      </div>

      <input type="hidden" name="look" value={JSON.stringify(look)} />
      <input type="hidden" name="lng" value={found ? place.lng : ""} />
      <input type="hidden" name="lat" value={found ? place.lat : ""} />

      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending || !found} className={primaryButton}>
        {pending ? "Saving…" : found ? "Start hunting" : "Share your location to continue"}
      </button>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { finishOnboarding } from "./actions";
import { HunterFigure } from "@/components/HunterFigure";
import { FormMessage, primaryButton } from "@/components/FormField";
import { OUTFIT_COLOURS, SKIN_TONES, type AvatarLook } from "@/lib/avatar";

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
        <p className="text-muted">Choose your look and where your journey starts.</p>
      </div>

      <div className="relative flex h-48 items-end justify-center overflow-hidden rounded-2xl bg-map">
        <div aria-hidden="true" className="absolute left-[-20px] top-28 h-5 w-[120%] -rotate-6 bg-white" />
        <div aria-hidden="true" className="absolute bottom-4 h-4 w-28 rounded-[50%] bg-[#cfc6b4]" />
        <div className="relative mb-6">
          <HunterFigure look={look} width={96} label="Your hunter preview" />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted">Skin tone</legend>
        <div className="flex flex-wrap gap-3">
          {SKIN_TONES.map((s) => (
            <button
              key={s.color}
              type="button"
              aria-label={`Skin tone: ${s.label}`}
              aria-pressed={look.skin === s.color}
              onClick={() => setLook({ ...look, skin: s.color })}
              className={`size-11 rounded-full border-[3px] ${look.skin === s.color ? "border-gold" : "border-ink"}`}
              style={{ background: s.color }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-muted">Outfit colour</legend>
        <div className="flex flex-wrap gap-3">
          {OUTFIT_COLOURS.map((o) => (
            <button
              key={o.color}
              type="button"
              aria-label={`Outfit colour: ${o.label}`}
              aria-pressed={look.shirt === o.color}
              onClick={() => setLook({ ...look, shirt: o.color })}
              className={`size-11 rounded-xl border-[3px] ${look.shirt === o.color ? "border-gold" : "border-line"}`}
              style={{ background: o.color }}
            />
          ))}
        </div>
      </fieldset>

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

      <input type="hidden" name="skin" value={look.skin} />
      <input type="hidden" name="shirt" value={look.shirt} />
      <input type="hidden" name="lng" value={found ? place.lng : ""} />
      <input type="hidden" name="lat" value={found ? place.lat : ""} />

      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending || !found} className={primaryButton}>
        {pending ? "Saving…" : found ? "Start hunting" : "Share your location to continue"}
      </button>
    </form>
  );
}

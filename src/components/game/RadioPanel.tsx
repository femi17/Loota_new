"use client";

import { useState, useSyncExternalStore } from "react";
import { countryNow } from "@/game/locale";
import { NIGERIA_STATIONS, onRadio, radioOn, radioState, radioStation, radioVolume, type RadioState } from "@/game/radio";

const OFF: RadioState = { stations: NIGERIA_STATIONS, station: 0, status: "off", volume: 0.7 };

/** The radio's state, kept up to date (for the tool's button and the panel). */
export function useRadio() {
  return useSyncExternalStore(onRadio, radioState, () => OFF);
}

const STATUS: Record<RadioState["status"], string> = {
  off: "Off",
  tuning: "Tuning in…",
  on: "● Live",
  down: "Not answering: try another station",
};

/** "Canada" for "CA" (the hunter's country, for the heading over its stations). */
function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Loota Radio: what's playing (with previous, play/pause, next) in one slim row, the volume, and the stations, grouped by
 * country with a search when there are many. On a phone it's a sheet from the bottom over the whole map, so the list
 * has room (owner, 31 Oct 2026: "improve it so we can see the stations list").
 */
export function RadioPanel({ onClose }: { onClose: () => void }) {
  const r = useRadio();
  const [find, setFind] = useState("");
  const st = r.stations[r.station];
  const playing = r.status !== "off";
  const firstNigerian = r.stations.findIndex((s) => s.id === NIGERIA_STATIONS[0].id);
  const local = firstNigerian > 0 ? countryName(countryNow()) : null;
  const q = find.trim().toLowerCase();
  const shown = r.stations.map((s, i) => ({ s, i })).filter(({ s }) => !q || `${s.name} ${s.what}`.toLowerCase().includes(q));
  return (
    <div
      className="pointer-events-auto fixed inset-x-0 bottom-0 top-[14dvh] z-40 flex flex-col gap-3 rounded-t-3xl bg-ink p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-paper shadow-[0_-12px_40px_rgba(0,0,0,0.5)] ring-1 ring-line sm:static sm:z-auto sm:max-h-[70dvh] sm:w-full sm:max-w-md sm:rounded-2xl sm:pb-4 sm:shadow-none"
      role="dialog"
      aria-label="Loota Radio"
    >
      <div className="mx-auto -mt-1 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
      <div className="flex items-center justify-between">
        <p className="font-display text-lg font-extrabold">📻 Loota Radio</p>
        <button type="button" aria-label="Close" onClick={onClose} className="flex size-9 items-center justify-center rounded-lg bg-ink-2 text-paper">
          ✕
        </button>
      </div>

      {/* What's playing, and the controls, in one row */}
      <div className="flex items-center gap-2 rounded-xl bg-ink-2 p-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{st.name}</p>
          <p className={`truncate text-xs font-bold ${r.status === "on" ? "text-[#2EC4B6]" : r.status === "down" ? "text-[#FF8A80]" : "text-muted"}`} aria-live="polite" aria-label="Radio status">
            {STATUS[r.status]}
          </p>
        </div>
        <button type="button" aria-label="Previous station" onClick={() => radioStation(-1, true)} className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink text-base">
          ⏮
        </button>
        <button
          type="button"
          aria-label={playing ? "Turn the radio off" : "Turn the radio on"}
          aria-pressed={playing}
          onClick={() => radioOn(!playing)}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gold text-lg text-ink"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button type="button" aria-label="Next station" onClick={() => radioStation(1, true)} className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink text-base">
          ⏭
        </button>
      </div>

      <label className="flex items-center gap-3 text-xs text-muted">
        🔈
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={r.volume}
          onChange={(e) => radioVolume(Number(e.target.value))}
          aria-label="Radio volume"
          className="flex-1 accent-[#F4B41A]"
        />
        🔊
      </label>

      {r.stations.length > 8 && (
        <input
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder={`Find a station (${r.stations.length})`}
          aria-label="Find a station"
          className="h-10 rounded-xl bg-ink-2 px-3 text-sm text-paper placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-gold"
        />
      )}

      {/* The stations: where you are first, then Nigeria's */}
      <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1" aria-label="Stations">
        {local && !q && <li className="px-1 pt-1 text-xs font-bold uppercase tracking-wider text-gold">Stations in {local}</li>}
        {shown.map(({ s, i }) => (
          <li key={s.id}>
            {i === firstNigerian && i > 0 && !q && <p className="mb-1 mt-3 px-1 text-xs font-bold uppercase tracking-wider text-gold">Nigerian stations</p>}
            <button
              type="button"
              onClick={() => radioStation(i)}
              aria-current={i === r.station && playing ? "true" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${i === r.station ? "bg-gold/15 ring-1 ring-gold" : "bg-ink-2"}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{s.name}</span>
                <span className="block truncate text-xs text-muted">{s.what}</span>
              </span>
              <span className={`shrink-0 text-xs ${i === r.station && playing ? "text-gold" : "text-muted"}`} aria-hidden="true">
                {i === r.station && playing ? "▶ Playing" : "▶"}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-1 py-4 text-center text-xs text-muted">No station called “{find}”</li>}
      </ul>
      <p className="text-[11px] text-muted">Live from the stations. Plays while you move; about 60 MB of data an hour.</p>
    </div>
  );
}

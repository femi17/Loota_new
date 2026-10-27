"use client";

import { useSyncExternalStore } from "react";
import { STATIONS, onRadio, radioOn, radioState, radioStation, radioVolume, type RadioState } from "@/game/radio";

const OFF: RadioState = { station: 0, status: "off", volume: 0.7 };

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

/** Loota Radio: on/off, the station (next, previous, or any from the list) and the volume. */
export function RadioPanel({ onClose }: { onClose: () => void }) {
  const r = useRadio();
  const st = STATIONS[r.station];
  const playing = r.status !== "off";
  return (
    <div className="pointer-events-auto flex max-h-[64dvh] w-full max-w-md flex-col gap-3 rounded-2xl bg-ink p-4 text-sm text-paper ring-1 ring-line" role="dialog" aria-label="Loota Radio">
      <div className="flex items-center justify-between">
        <p className="font-display text-lg font-extrabold">📻 Loota Radio</p>
        <button type="button" aria-label="Close" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg bg-ink-2 text-paper">
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3 rounded-xl bg-ink-2 p-3">
        <div className="min-w-0 basis-full">
          <p className="truncate font-bold">{st.name}</p>
          <p className="truncate text-xs text-muted">{st.what}</p>
          <p className={`text-xs font-bold ${r.status === "on" ? "text-[#2EC4B6]" : r.status === "down" ? "text-[#FF8A80]" : "text-muted"}`} aria-live="polite" aria-label="Radio status">
            {STATUS[r.status]}
          </p>
        </div>
        <button type="button" aria-label="Previous station" onClick={() => radioStation(-1, true)} className="flex size-10 items-center justify-center rounded-lg bg-ink text-lg">
          ⏮
        </button>
        <button
          type="button"
          aria-label={playing ? "Turn the radio off" : "Turn the radio on"}
          aria-pressed={playing}
          onClick={() => radioOn(!playing)}
          className="flex size-12 items-center justify-center rounded-full bg-gold text-xl text-ink"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button type="button" aria-label="Next station" onClick={() => radioStation(1, true)} className="flex size-10 items-center justify-center rounded-lg bg-ink text-lg">
          ⏭
        </button>
      </div>

      <label className="flex items-center gap-3 text-xs text-muted">
        Volume
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
      </label>

      <ul className="flex flex-col gap-1 overflow-y-auto" aria-label="Stations">
        {STATIONS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => radioStation(i)}
              aria-current={i === r.station && playing ? "true" : undefined}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left ${i === r.station ? "bg-gold/15 ring-1 ring-gold" : "bg-ink-2"}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-bold">{s.name}</span>
                <span className="block truncate text-xs text-muted">{s.what}</span>
              </span>
              {i === r.station && playing && <span className="text-xs font-bold text-gold">Playing</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Live from the stations. It plays while you move, and uses about 60 MB of data an hour.</p>
    </div>
  );
}

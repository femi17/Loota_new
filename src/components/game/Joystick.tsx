"use client";

import { useState, useSyncExternalStore, type CSSProperties } from "react";

// The joystick (owner, 1–2 Nov 2026: "a joystick on mobile to move and turn… only needed on tablets and mobile
// phones"): on the map and in a key's quarter. It reports where the thumb is, −1 to 1 each way (y down); what that
// does is up to the screen it's on.

const HANDHELD = "(any-pointer: coarse), (max-width: 767px)";

/** A phone or tablet (any touch screen), or a window as narrow as a phone's. */
export function useHandheld() {
  return useSyncExternalStore(
    (changed) => {
      const q = window.matchMedia(HANDHELD);
      q.addEventListener("change", changed);
      return () => q.removeEventListener("change", changed);
    },
    () => window.matchMedia(HANDHELD).matches || navigator.maxTouchPoints > 0,
    () => false,
  );
}

export function Joystick({
  onMove,
  onEnd,
  className = "",
  style,
}: {
  onMove: (x: number, y: number) => void;
  onEnd: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [thumb, setThumb] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className={`pointer-events-auto size-28 touch-none select-none rounded-full bg-ink/45 ring-2 ring-paper/30 backdrop-blur-[2px] ${className}`}
      style={style}
      role="group"
      aria-label="Joystick: drag to walk and turn"
      data-joystick
      data-thumb={thumb ? `${thumb.x.toFixed(2)},${thumb.y.toFixed(2)}` : ""}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        const move = (cx: number, cy: number) => {
          const rad = r.width / 2;
          let x = (cx - (r.left + rad)) / rad, y = (cy - (r.top + rad)) / rad;
          const m = Math.hypot(x, y);
          if (m > 1) [x, y] = [x / m, y / m];
          setThumb({ x, y });
          onMove(x, y);
        };
        move(e.clientX, e.clientY);
        const el = e.currentTarget;
        const onPointerMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
        const onUp = () => {
          setThumb(null);
          onEnd();
          el.removeEventListener("pointermove", onPointerMove);
          el.removeEventListener("pointerup", onUp);
          el.removeEventListener("pointercancel", onUp);
        };
        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", onUp);
      }}
    >
      <span
        className="pointer-events-none absolute left-1/2 top-1/2 size-12 rounded-full bg-paper/90 shadow-lg ring-4 ring-gold/70"
        style={{ transform: `translate(calc(-50% + ${(thumb?.x ?? 0) * 32}px), calc(-50% + ${(thumb?.y ?? 0) * 32}px))` }}
        aria-hidden="true"
      />
    </div>
  );
}

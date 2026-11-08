/**
 * Full screen and sideways on a phone (owner, 8 Nov 2026: "on mobile, when a user clicks on free roam or joins a hunt,
 * can we make the hunt/play page a landscape mode in fullscreen. That way gives users more room to see the screen and
 * move"). Browsers only allow it from a tap, so it's asked for from the tap that opens the map (the lobby's buttons) or
 * the map's own "Full screen" offer. Android's Chrome does both; an iPhone's Safari does neither (it can only be asked
 * to turn the phone).
 */
import { useSyncExternalStore } from "react";

/** A phone (a touch screen whose short side is a phone's). */
export const isTouchPhone = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches && Math.min(window.screen.width, window.screen.height) <= 600;

/** Whether this browser can go full screen (not an iPhone's Safari). */
export const canFullscreen = () => typeof document !== "undefined" && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;

export const isFullscreen = () => typeof document !== "undefined" && !!document.fullscreenElement;

/** From a tap: full screen, then turned sideways. True when it went full screen. */
export async function playFullscreen(): Promise<boolean> {
  if (!isTouchPhone() || !canFullscreen()) return false;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch {
    return false;
  }
  try {
    // Only allowed while full screen; not every browser can.
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
  } catch {
    // Left as it is: the player can turn the phone.
  }
  return true;
}

/** Back to a normal screen: no longer turned sideways, out of full screen (the lobby; the help panel's switch). */
export async function leaveFullscreen() {
  try {
    (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
  } catch {
    // Not locked, or can't be.
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // Already out.
  }
}

const onFullscreenChange = (fn: () => void) => {
  document.addEventListener("fullscreenchange", fn);
  return () => document.removeEventListener("fullscreenchange", fn);
};
/** Whether the page is full screen now, kept up to date. */
export const useFullscreen = () => useSyncExternalStore(onFullscreenChange, isFullscreen, () => false);
/** Whether this is a phone that can go full screen (an Android phone; not an iPhone), for showing the switch. */
export const useCanFullscreen = () => useSyncExternalStore(noChange, () => isTouchPhone() && canFullscreen(), () => false);
const noChange = () => () => {};

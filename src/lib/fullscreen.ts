/**
 * Full screen and sideways on a phone (owner, 8 Nov 2026: "on mobile, when a user clicks on free roam or joins a hunt,
 * can we make the hunt/play page a landscape mode in fullscreen. That way gives users more room to see the screen and
 * move"). Browsers only allow it from a tap, so it's asked for from the tap that opens the map (the lobby's buttons) or
 * the map's own "Full screen" offer. Android's Chrome does both; an iPhone's Safari does neither (it can only be asked
 * to turn the phone).
 */

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

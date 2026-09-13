import { useEffect, useState } from "react";

/** Touch capability doesn't change at runtime, so this is a plain function,
 * not a hook — call it once (e.g. at module scope in a component) rather
 * than re-checking every render. */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/** True while the viewport is taller than it is wide — used to show the
 * "rotate your device" prompt. Tracks live via matchMedia rather than a
 * resize listener, since a real orientation change fires that event
 * reliably across browsers without any extra plumbing. */
export function useIsPortrait(): boolean {
  const [isPortrait, setIsPortrait] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const onChange = () => setIsPortrait(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isPortrait;
}

/** Best-effort fullscreen + landscape lock, wired to a real user gesture
 * (a button tap — browsers refuse both APIs without one). Wrapped in
 * try/catch throughout: iOS Safari has no Fullscreen API for arbitrary
 * elements at all, and Screen Orientation's lock() is Chromium-only and
 * only works once already in fullscreen — neither failure should ever
 * surface as an error, since the game is fully playable without either.
 */
export async function enterFullscreenLandscape() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    // iOS Safari, or the user/browser declined — the game still works,
    // just inside the normal page chrome.
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.("landscape");
  } catch {
    // Not supported (iOS, or not in fullscreen yet) — the rotate-device
    // prompt (see RotateDevicePrompt.tsx) is the fallback for everyone else.
  }
}

import { useEffect, useState } from "react";

/** Touch capability doesn't change at runtime, so this is a plain function,
 * not a hook — call it once (e.g. at module scope in a component) rather
 * than re-checking every render. */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

/** True while the viewport is taller than it is wide — used to show the
 * "rotate your device" prompt. Reads window.innerWidth/innerHeight
 * directly (not matchMedia's orientation query) and re-checks on both
 * resize and orientationchange: matchMedia was reported to occasionally
 * report a stale "portrait" reading right around a fullscreen transition,
 * which — combined with the prompt having no escape hatch — could cover
 * the entire game with nothing left clickable. See RotateDevicePrompt.tsx
 * for the other half of that fix (a dismiss button, always). */
export function useIsPortrait(): boolean {
  const [isPortrait, setIsPortrait] = useState(
    () => typeof window !== "undefined" && window.innerHeight > window.innerWidth,
  );

  useEffect(() => {
    const check = () => setIsPortrait(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  return isPortrait;
}

/** Tracks whether the page is currently in the Fullscreen API's fullscreen
 * state — used both to switch the fullscreen button between "enter" and
 * "exit", and as an extra guard so the rotate-device prompt never shows
 * while the player deliberately went fullscreen (see App.tsx). */
export function useIsFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return isFullscreen;
}

/**
 * A real toggle, not just "enter": tapping the fullscreen button again
 * while already fullscreen exits it. Without this half, a player who'd
 * gone fullscreen had no way back out short of a hardware back gesture —
 * exactly what was reported as "can't get out of fullscreen or the game."
 *
 * Both the fullscreen request and the orientation lock are wrapped in
 * try/catch throughout: iOS Safari has no Fullscreen API for arbitrary
 * elements at all, and Screen Orientation's lock() is Chromium-only and
 * only works once already fullscreen — neither failure should ever
 * surface as an error, since the game is fully playable without either.
 */
export async function toggleFullscreen() {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // Nothing more we can do — at least the button didn't throw.
    }
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // iOS Safari, or the user/browser declined — the game still works,
    // just inside the normal page chrome.
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.("landscape");
  } catch {
    // Not supported (iOS, or not in fullscreen yet) — the rotate-device
    // prompt is the fallback for everyone else, and it's dismissible.
  }
}

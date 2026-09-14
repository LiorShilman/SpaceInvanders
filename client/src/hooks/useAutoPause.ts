import { useEffect } from "react";
import { useGameStore } from "../state/gameStore";

/**
 * Auto-pauses the run the moment the tab/window loses focus or is hidden —
 * a phone call or switching apps/tabs shouldn't cost you a life or your run
 * while you're not looking. Deliberately does NOT auto-resume on refocus:
 * coming back to a "still playing, enemies still advancing" screen with no
 * warning is exactly the surprise this is meant to prevent, so resuming
 * always requires an explicit tap/click on the pause overlay (see HUD.tsx).
 */
export function useAutoPause() {
  useEffect(() => {
    const onBlur = () => useGameStore.getState().pause();
    const onVisibilityChange = () => {
      if (document.hidden) useGameStore.getState().pause();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}

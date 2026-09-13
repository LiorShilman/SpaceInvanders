import { useEffect, useRef } from "react";

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  forward: boolean;
  backward: boolean;
  fire: boolean;
}

const KEY_MAP: Record<string, keyof InputState> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  // Real Z-axis piloting, not just an X/Y plane — a separate pair of keys
  // since up/down (Y) is already spoken for aiming at different rows.
  KeyQ: "forward",
  KeyE: "backward",
  Space: "fire",
};

/**
 * Tracks pressed keys in a mutable ref so the render loop (useFrame) can read
 * input every frame without triggering React re-renders on every keystroke.
 */
export function useKeyboard(): React.RefObject<InputState> {
  const state = useRef<InputState>({
    left: false,
    right: false,
    up: false,
    down: false,
    forward: false,
    backward: false,
    fire: false,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = KEY_MAP[e.code];
      if (!key) return;
      e.preventDefault();
      state.current[key] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = KEY_MAP[e.code];
      if (!key) return;
      state.current[key] = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return state;
}

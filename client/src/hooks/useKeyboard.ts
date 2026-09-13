import { useEffect, useRef } from "react";

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
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

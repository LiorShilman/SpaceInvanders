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
  // since up/down (Y) is already spoken for aiming at different rows. Z/C
  // sit right below A/S/D, closer to the WASD cluster than Q/E are (and Q/E
  // read as an awkward reach on a Hebrew keyboard's physical layout).
  KeyZ: "forward",
  KeyC: "backward",
  Space: "fire",
};

/**
 * Tracks pressed keys AND the left mouse button in a mutable ref so the
 * render loop (useFrame) can read input every frame without triggering
 * React re-renders on every keystroke/click. (Formerly useKeyboard — renamed
 * once mouse fire was added, since "keyboard" stopped being accurate.)
 */
export function useInput(): React.RefObject<InputState> {
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

    // Left mouse button also fires — but only when the click actually
    // starts on the canvas itself, not on an overlaid HUD control (the
    // anaglyph toggle, "שחק שוב"). Those buttons don't call
    // stopPropagation(), so a plain window-level listener would otherwise
    // also arm "fire" on every click of them.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!(e.target instanceof HTMLCanvasElement)) return;
      e.preventDefault();
      state.current.fire = true;
    };
    // No target check on release — if the pointer left the canvas (or a
    // HUD button) before releasing, firing still needs to stop, or it gets
    // stuck on until the next unrelated click.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      state.current.fire = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return state;
}

import { useRef, useEffect } from "react";
import { unlockAudio } from "../audio/sound";

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  forward: boolean;
  backward: boolean;
  fire: boolean;
  // The grenade throw (see GRENADE in config/constants.ts) — a boolean
  // held-state exactly like `fire`, not edge-detected on keydown alone:
  // Scene's own long cooldown timer already paces it naturally regardless
  // of whether the key is tapped or held, the same way primary fire's own
  // (much shorter) cooldown already does.
  grenade: boolean;
}

// A single module-level object, not a per-hook useRef — there's only ever
// one ship/one set of controls in this game, and TouchControls.tsx (a
// plain HTML overlay, not a descendant of Scene.tsx) needs to write into
// the exact same object useInput() hands the render loop. A ref returned
// from a hook can't be reached from a sibling component without prop-
// drilling or context; a shared module singleton can, matching this
// codebase's existing appetite for module-level mutable state (e.g.
// Scene.tsx's _shieldDummy).
const inputState: InputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  forward: false,
  backward: false,
  fire: false,
  grenade: false,
};

/** Touch controls (and anything else outside the keyboard/mouse listeners
 * below) set input this way, instead of reaching into the object directly —
 * keeps this file the one place that knows the shape of InputState. */
export function setInputKey(key: keyof InputState, value: boolean) {
  inputState[key] = value;
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
  KeyG: "grenade",
};

/**
 * Tracks pressed keys AND the left mouse button in a mutable, shared object
 * so the render loop (useFrame) can read input every frame without
 * triggering React re-renders on every keystroke/click. (Formerly
 * useKeyboard — renamed once mouse fire was added, since "keyboard" stopped
 * being accurate; the object also now doubles as TouchControls' target —
 * see setInputKey above.)
 */
export function useInput(): React.RefObject<InputState> {
  const state = useRef<InputState>(inputState);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Browsers refuse to start any audio before a real user gesture —
      // this is the earliest one available, so every keydown tries to
      // unlock it (a no-op after the first successful call).
      unlockAudio();
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
      unlockAudio();
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

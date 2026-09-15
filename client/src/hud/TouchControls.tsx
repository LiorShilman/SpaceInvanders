import { useRef } from "react";
import { setInputKey } from "../hooks/useInput";
import { unlockAudio } from "../audio/sound";
import "./touch-controls.css";

// setPointerCapture can throw (a stale/already-released pointer id, or a
// browser that doesn't support capture for the current pointer type) —
// it's purely an optimization (keeps pointermove/up targeting this element
// even if the finger slides off it), never something the actual input
// state should depend on. An uncaught throw here would abort the rest of
// the handler, silently skipping the setInputKey call right after it —
// exactly the kind of bug where a button "just doesn't do anything" with
// no visible error.
function safeSetPointerCapture(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Ignored — see comment above.
  }
}

/**
 * Touch equivalent of useInput's keyboard/mouse handling — writes into the
 * exact same shared InputState object (see setInputKey) rather than its own
 * state, so Scene.tsx's render loop doesn't need to know or care whether a
 * given frame's input came from a keyboard, a mouse, or a finger.
 *
 * Three independent touch zones, each tracking its OWN pointerId so a
 * player can hold the fire button and drag the joystick with two different
 * fingers at once without them fighting over pointer capture:
 * - a drag joystick (bottom-start) for x/y movement,
 * - two small buttons for Z/C forward/backward piloting,
 * - one big fire button (bottom-end).
 */
export function TouchControls() {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const joystickPointerId = useRef<number | null>(null);

  function updateJoystick(clientX: number, clientY: number) {
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!base || !knob) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;

    // A deadzone before committing to a direction — otherwise the tiniest
    // thumb tremor right at center flickers movement keys on and off.
    const nx = dx / maxR;
    const ny = dy / maxR;
    const dead = 0.28;
    setInputKey("left", nx < -dead);
    setInputKey("right", nx > dead);
    setInputKey("up", ny < -dead); // screen-up is negative clientY
    setInputKey("down", ny > dead);
  }

  function resetJoystick() {
    const knob = knobRef.current;
    if (knob) knob.style.transform = "translate(0px, 0px)";
    setInputKey("left", false);
    setInputKey("right", false);
    setInputKey("up", false);
    setInputKey("down", false);
  }

  function onJoystickDown(e: React.PointerEvent) {
    unlockAudio();
    e.preventDefault();
    joystickPointerId.current = e.pointerId;
    updateJoystick(e.clientX, e.clientY);
    safeSetPointerCapture(e.currentTarget as HTMLElement, e.pointerId);
  }
  function onJoystickMove(e: React.PointerEvent) {
    if (e.pointerId !== joystickPointerId.current) return;
    e.preventDefault();
    updateJoystick(e.clientX, e.clientY);
  }
  function onJoystickUp(e: React.PointerEvent) {
    if (e.pointerId !== joystickPointerId.current) return;
    joystickPointerId.current = null;
    resetJoystick();
  }

  // Shared press/release handler factory for the plain hold-buttons
  // (forward/backward/fire) — each just maps to one InputState key for as
  // long as that specific pointer stays down on it.
  function holdButton(key: "forward" | "backward" | "fire" | "grenade") {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        unlockAudio();
        e.preventDefault();
        setInputKey(key, true);
        safeSetPointerCapture(e.currentTarget as HTMLElement, e.pointerId);
      },
      onPointerUp: (e: React.PointerEvent) => {
        e.preventDefault();
        setInputKey(key, false);
      },
      onPointerCancel: () => setInputKey(key, false),
    };
  }

  return (
    <div className="touch-controls">
      <div
        ref={baseRef}
        className="touch-joystick-base"
        onPointerDown={onJoystickDown}
        onPointerMove={onJoystickMove}
        onPointerUp={onJoystickUp}
        onPointerCancel={onJoystickUp}
      >
        <div ref={knobRef} className="touch-joystick-knob" />
      </div>

      <div className="touch-dive-buttons">
        <button className="touch-dive-btn" aria-label="קדימה" {...holdButton("forward")}>
          ▲
        </button>
        <button className="touch-dive-btn" aria-label="אחורה" {...holdButton("backward")}>
          ▼
        </button>
      </div>

      {/* Held exactly like the fire button above (see the `grenade` field's
          own comment in useInput.ts) — Scene's long cooldown paces actual
          throws on its own, so there's no need to edge-detect a tap here. */}
      <button className="touch-grenade-btn" aria-label="רימון" {...holdButton("grenade")}>
        💣
      </button>

      <button className="touch-fire-btn" aria-label="ירי" {...holdButton("fire")}>
        ירי
      </button>
    </div>
  );
}

import "./rotate-device-prompt.css";

/** Full-screen block shown while a touch device is held in portrait — the
 * game's whole arena (see ARENA/FORMATION in constants.ts) is tuned for a
 * wide view, and there's no reasonable portrait layout for it. Purely a
 * visual overlay (the simulation keeps running underneath), since an
 * orientation change fires the moment the player actually rotates — no
 * "continue" button needed, it just resolves itself. */
export function RotateDevicePrompt() {
  return (
    <div className="rotate-prompt">
      <div className="rotate-prompt-icon" aria-hidden="true">
        📱
      </div>
      <div className="rotate-prompt-text">סובבו את המכשיר למצב לרוחב כדי לשחק</div>
    </div>
  );
}

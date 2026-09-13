import "./rotate-device-prompt.css";

interface RotateDevicePromptProps {
  onDismiss: () => void;
}

/**
 * Full-screen block shown while a touch device looks like it's in portrait
 * — the game's whole arena (see ARENA/FORMATION in constants.ts) is tuned
 * for a wide view, and there's no reasonable portrait layout for it. Purely
 * a visual overlay (the simulation keeps running underneath); rotating the
 * device resolves it on its own via useIsPortrait.
 *
 * ALWAYS dismissible, though — the orientation reading this is based on can
 * be wrong (a real report: it briefly misread portrait right around a
 * fullscreen transition), and this overlay is otherwise fully opaque with
 * nothing else clickable underneath it. A guess that's occasionally wrong
 * must never be able to wall off the whole game with no way out.
 */
export function RotateDevicePrompt({ onDismiss }: RotateDevicePromptProps) {
  return (
    <div className="rotate-prompt">
      <div className="rotate-prompt-icon" aria-hidden="true">
        📱
      </div>
      <div className="rotate-prompt-text">סובבו את המכשיר למצב לרוחב כדי לשחק</div>
      <button className="rotate-prompt-dismiss" onClick={onDismiss}>
        המשך בכל זאת
      </button>
    </div>
  );
}

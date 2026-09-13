import { useEffect, useState } from "react";
import { useGameStore } from "../state/gameStore";
import { SHIP } from "../config/constants";
import "./hud.css";

interface HUDProps {
  anaglyph: boolean;
  onToggleAnaglyph: () => void;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const WEAPON_NAMES: Record<string, string> = {
  spread: "פיזור משולש",
  rapid: "אש מהירה",
};

export function HUD({ anaglyph, onToggleAnaglyph }: HUDProps) {
  const {
    status,
    health,
    score,
    wave,
    enemiesRemaining,
    bannerText,
    runStartedAt,
    lives,
    comboMultiplier,
    comboExpiresAt,
    weapon,
    weaponExpiresAt,
    reset,
    clearBanner,
  } = useGameStore();

  const healthPct = Math.round((health / SHIP.maxHealth) * 100);

  // Real wall-clock elapsed time (not the simulation's own clock — see the
  // note on runStartedAt in gameStore) — ticks every second on its own,
  // independent of the game's frame rate. The same tick also drives the
  // combo-multiplier and weapon-timer decay below (see comboExpiresAt/
  // weaponExpiresAt) — no reason for a second interval just for those.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "playing") return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [status]);
  const elapsed = formatClock(now - runStartedAt);

  // The store only resets comboMultiplier to 1 on the NEXT kill after the
  // window lapses — between kills it just sits there stale. The HUD is the
  // one place that actually needs "has it decayed yet," so it derives that
  // itself from comboExpiresAt rather than trusting the stored value.
  const displayMultiplier = now < comboExpiresAt ? comboMultiplier : 1;
  const weaponSecondsLeft = Math.max(0, Math.ceil((weaponExpiresAt - now) / 1000));

  // The wave-cleared banner is transient — it clears itself a couple of
  // seconds after appearing, rather than needing a dismiss button.
  useEffect(() => {
    if (!bannerText) return;
    const timer = setTimeout(clearBanner, 2200);
    return () => clearTimeout(timer);
  }, [bannerText, clearBanner]);

  return (
    <div className="hud">
      <div className="hud-bar">
        <div className="hud-stat">
          <span className="hud-label">
            כוח <span className="hud-label-value">{healthPct}%</span>
          </span>
          <div className="health-track">
            <div
              className="health-fill"
              style={{ width: `${healthPct}%` }}
              data-critical={healthPct <= 25}
            />
          </div>
        </div>
        <div className="hud-stat hud-stat--num">
          <span className="hud-label">חיים</span>
          <span className="hud-value hud-lives">
            {Array.from({ length: lives + 1 }, (_, i) => (
              <span key={i} className="hud-life-pip" />
            ))}
          </span>
        </div>
        <div className="hud-stat hud-stat--num">
          <span className="hud-label">ניקוד</span>
          <span className="hud-value">
            {score.toLocaleString("he-IL")}
            {displayMultiplier > 1 && (
              <span className="hud-combo" data-tier={displayMultiplier}>
                x{displayMultiplier}
              </span>
            )}
          </span>
        </div>
        <div className="hud-stat hud-stat--num">
          <span className="hud-label">גל {wave}</span>
          <span className="hud-value">{enemiesRemaining} נותרו</span>
        </div>
        <div className="hud-stat hud-stat--num">
          <span className="hud-label">זמן</span>
          <span className="hud-value hud-value--mono">{elapsed}</span>
        </div>
        {weapon !== "base" && (
          <div className="hud-stat hud-stat--num">
            <span className="hud-label">נשק</span>
            <span className="hud-value hud-value--weapon">
              {WEAPON_NAMES[weapon] ?? weapon} · {weaponSecondsLeft}ש
            </span>
          </div>
        )}
        <button className="anaglyph-toggle" onClick={onToggleAnaglyph} data-active={anaglyph}>
          🔴🔵 {anaglyph ? "תלת-ממד פעיל — כיבוי" : "משקפי אדום-כחול (3)"}
        </button>
      </div>

      {bannerText && (
        <div className="wave-banner" key={bannerText}>
          {bannerText}
        </div>
      )}

      {status === "gameover" && (
        <div className="hud-overlay">
          <div className="hud-panel">
            <h1>הפולשים חדרו</h1>
            <p>
              הגעת לגל <b>{wave}</b> · ניקוד סופי: <b>{score.toLocaleString("he-IL")}</b>
            </p>
            <button onClick={reset}>שחק שוב</button>
          </div>
        </div>
      )}

      <div className="hud-controls">
        <span className="hud-controls-pill">
          <span dir="ltr">WASD</span> / חצים — תנועה &nbsp;·&nbsp; <span dir="ltr">Z/C</span> — קדימה/אחורה
          &nbsp;·&nbsp; רווח / עכבר שמאלי — ירי
        </span>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { useGameStore } from "../state/gameStore";
import { SHIP } from "../config/constants";
import "./hud.css";

interface HUDProps {
  anaglyph: boolean;
  onToggleAnaglyph: () => void;
}

export function HUD({ anaglyph, onToggleAnaglyph }: HUDProps) {
  const { status, health, score, wave, enemiesRemaining, bannerText, reset, clearBanner } =
    useGameStore();

  const healthPct = Math.round((health / SHIP.maxHealth) * 100);

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
          <span className="hud-label">ניקוד</span>
          <span className="hud-value">{score.toLocaleString("he-IL")}</span>
        </div>
        <div className="hud-stat hud-stat--num">
          <span className="hud-label">גל {wave}</span>
          <span className="hud-value">{enemiesRemaining} נותרו</span>
        </div>
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
        WASD / חצים — תנועה &nbsp;·&nbsp; רווח — ירי
      </div>
    </div>
  );
}

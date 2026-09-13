import { useGameStore } from "../state/gameStore";
import { SHIP } from "../config/constants";
import "./hud.css";

export function HUD() {
  const { status, health, score, wave, enemiesRemaining, reset } = useGameStore();

  const healthPct = Math.round((health / SHIP.maxHealth) * 100);

  return (
    <div className="hud">
      <div className="hud-bar">
        <div className="hud-stat">
          <span className="hud-label">מגן</span>
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
      </div>

      {status !== "playing" && (
        <div className="hud-overlay">
          <div className="hud-panel">
            <h1>{status === "gameover" ? "הפולשים חדרו" : "הגל נבלם"}</h1>
            <p>
              ניקוד סופי: <b>{score.toLocaleString("he-IL")}</b>
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

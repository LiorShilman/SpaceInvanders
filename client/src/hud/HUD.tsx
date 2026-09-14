import { useEffect, useState } from "react";
import { useGameStore } from "../state/gameStore";
import { SHIP } from "../config/constants";
import { isMuted, setMuted } from "../audio/sound";
import "./hud.css";

interface HUDProps {
  anaglyph: boolean;
  onToggleAnaglyph: () => void;
  showFullscreenButton?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  showKeyboardHint?: boolean;
  // Icon-only toggle buttons — a phone in landscape is often only
  // 700-930px wide, and the full-text labels ("🔊 קול", "🔴🔵 משקפי
  // אדום-כחול (3)", "⛶ מסך מלא") alongside 6+ stats needed 1100px+,
  // pushing buttons at the row's end past the visible edge entirely.
  compact?: boolean;
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

export function HUD({
  anaglyph,
  onToggleAnaglyph,
  showFullscreenButton,
  isFullscreen = false,
  onToggleFullscreen,
  showKeyboardHint = true,
  compact = false,
}: HUDProps) {
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
    highScore,
    highWave,
    paused,
    bossActive,
    bossHealth,
    bossMaxHealth,
    reset,
    clearBanner,
    togglePause,
  } = useGameStore();

  const bossHealthPct = bossMaxHealth > 0 ? Math.round((bossHealth / bossMaxHealth) * 100) : 0;

  const healthPct = Math.round((health / SHIP.maxHealth) * 100);

  const [muted, setMutedState] = useState(isMuted);
  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

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
    <div className={compact ? "hud hud--compact" : "hud"}>
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
          <span className="hud-label">
            ניקוד <span className="hud-label-value">שיא: {highScore.toLocaleString("he-IL")}</span>
          </span>
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
          <span className="hud-label">גל</span>
          <span className="hud-value hud-value--wave">{wave}</span>
        </div>
        {/* Swapped for the boss health bar below during a boss wave — "40
            enemies remaining" has no equivalent meaning once the whole
            formation is replaced by one large target (see BOSS in
            config/constants.ts). */}
        {!bossActive && (
          <div className="hud-stat hud-stat--num">
            <span className="hud-label">נותרו</span>
            <span className="hud-value">{enemiesRemaining}</span>
          </div>
        )}
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
        {/* One flex group, one shared auto-margin — three separate buttons
            each carrying their own margin-inline-start: auto (the old
            layout) could each end up on a different wrapped line with the
            full row's free space added before just that one item, landing
            it somewhere in the middle of the screen instead of docked with
            its siblings. Grouping fixes that, and compact mode also gives
            every button the same fixed square size instead of shrink-
            wrapping to whatever its own icon count needs (1 vs 2 emoji
            otherwise made visibly different-sized buttons). */}
        <div className={compact ? "hud-toggle-group hud-toggle-group--compact" : "hud-toggle-group"}>
          <button className="anaglyph-toggle" onClick={toggleMuted} data-active={!muted}>
            {compact ? (muted ? "🔇" : "🔊") : muted ? "🔇 שקט" : "🔊 קול"}
          </button>
          <button className="anaglyph-toggle" onClick={onToggleAnaglyph} data-active={anaglyph}>
            {compact ? "🔴🔵" : <>🔴🔵 {anaglyph ? "תלת-ממד פעיל — כיבוי" : "משקפי אדום-כחול (3)"}</>}
          </button>
          {showFullscreenButton && (
            <button className="anaglyph-toggle" onClick={onToggleFullscreen} data-active={isFullscreen}>
              {compact ? "⛶" : isFullscreen ? "⛶ צא ממסך מלא" : "⛶ מסך מלא"}
            </button>
          )}
          {status === "playing" && (
            <button className="anaglyph-toggle" onClick={togglePause} data-active={paused}>
              {compact ? "⏸" : "⏸ השהה"}
            </button>
          )}
        </div>
      </div>

      {/* Persists for the whole fight (unlike the transient wave-banner
          above) — a boss health bar is the one stat worth keeping visible
          without a glance at the corner, same reasoning as the player's
          own health bar. */}
      {bossActive && status === "playing" && (
        <div className="boss-bar">
          <span className="boss-bar-label">
            בוס <span className="boss-bar-value">{bossHealthPct}%</span>
          </span>
          <div className="boss-bar-track">
            <div className="boss-bar-fill" style={{ width: `${bossHealthPct}%` }} />
          </div>
        </div>
      )}

      {bannerText && (
        <div className="wave-banner" key={bannerText}>
          {bannerText}
        </div>
      )}

      {paused && status === "playing" && (
        <div className="hud-overlay">
          <div className="hud-panel">
            <h1>מושהה</h1>
            <button onClick={togglePause}>המשך</button>
          </div>
        </div>
      )}

      {status === "gameover" && (
        <div className="hud-overlay">
          <div className="hud-panel">
            <h1>הפולשים חדרו</h1>
            <p>
              הגעת לגל <b>{wave}</b> · ניקוד סופי: <b>{score.toLocaleString("he-IL")}</b>
            </p>
            {/* The store already settled highScore against this run's final
                score before flipping to "gameover" (see damageShip/
                handleInvasion) — so by the time this renders, score having
                caught up to highScore means THIS run is what set it. */}
            {score > 0 && score >= highScore ? (
              <p className="hud-panel-record">שיא חדש! 🏆</p>
            ) : (
              <p className="hud-panel-sub">
                שיא: {highScore.toLocaleString("he-IL")} (גל {highWave})
              </p>
            )}
            <button onClick={reset}>שחק שוב</button>
          </div>
        </div>
      )}

      {showKeyboardHint && (
        <div className="hud-controls">
          <span className="hud-controls-pill">
            <span dir="ltr">WASD</span> / חצים — תנועה &nbsp;·&nbsp; <span dir="ltr">Z/C</span> — קדימה/אחורה
            &nbsp;·&nbsp; רווח / עכבר שמאלי — ירי
          </span>
        </div>
      )}
    </div>
  );
}

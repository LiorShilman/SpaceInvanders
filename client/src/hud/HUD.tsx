import { useEffect, useState } from "react";
import { ACHIEVEMENTS, useGameStore } from "../state/gameStore";
import { FLANKER, SHIP } from "../config/constants";
import { isMuted, setMuted } from "../audio/sound";
import "./hud.css";

// Widget's own pixel radius (must match the CSS width/2) — used to scale a
// blip's world-space offset into the widget's screen space.
const RADAR_PX_RADIUS = 45;

/** Maps a world-space (dx, dz) offset from the ship into the radar
 * widget's own pixel space, clamped to its edge (direction preserved) once
 * the real distance exceeds FLANKER.radarRange — the same "still shows,
 * just pinned to the rim" convention any minimap uses for a far-off
 * target. */
function radarOffset(dx: number, dz: number): { x: number; y: number } {
  const dist = Math.hypot(dx, dz) || 0.0001;
  const scale = (Math.min(dist, FLANKER.radarRange) / dist) * (RADAR_PX_RADIUS / FLANKER.radarRange);
  return { x: dx * scale, y: dz * scale };
}

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
    leaderboard,
    achievementToast,
    unlockedAchievements,
    radarBlips,
    paused,
    bossActive,
    bossHealth,
    bossMaxHealth,
    reset,
    clearBanner,
    clearAchievementToast,
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

  // Pure view state, not game state — which panel (if any) is open never
  // needs to survive a reset or be read from anywhere else, unlike
  // `paused` (which Scene's own simulation reads every frame).
  const [showAchievements, setShowAchievements] = useState(false);

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

  // Same transient pattern as the banner above, on its own independent
  // timer — an achievement toast and a wave/pickup banner can legitimately
  // be on screen at the same time (they render in different spots) and
  // shouldn't share one clock.
  useEffect(() => {
    if (!achievementToast) return;
    const timer = setTimeout(clearAchievementToast, 3500);
    return () => clearTimeout(timer);
  }, [achievementToast, clearAchievementToast]);

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
              data-critical={healthPct <= SHIP.criticalHealthPct * 100}
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
          <button
            className="anaglyph-toggle"
            onClick={() => {
              // Opening it while actually playing pauses the run — same
              // reasoning as auto-pause-on-blur: reading a panel that
              // covers the action while enemies keep advancing/firing
              // unseen is exactly the kind of "surprise" that shouldn't
              // happen. Never auto-resumes on close, for the same reason
              // auto-pause itself never does (see useAutoPause.ts).
              if (!showAchievements && status === "playing") useGameStore.getState().pause();
              setShowAchievements((v) => !v);
            }}
            data-active={showAchievements}
          >
            {compact ? "🏆" : "🏆 הישגים"}
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

      {achievementToast && (
        <div className="achievement-toast" key={achievementToast.id}>
          {achievementToast.label}
        </div>
      )}

      {/* Hidden while the achievements panel is open — that panel is the
          only reason this pause happened (see the toggle button above),
          and its own close button resumes the run itself; showing both
          overlays at once would stack two competing "resume" controls. */}
      {paused && status === "playing" && !showAchievements && (
        <div className="hud-overlay">
          <div className="hud-panel">
            <h1>מושהה</h1>
            <button onClick={togglePause}>המשך</button>
          </div>
        </div>
      )}

      {showAchievements && (
        <div className="hud-overlay">
          <div className="hud-panel hud-panel--achievements">
            <h1>הישגים</h1>
            <ul className="achievements-list">
              {ACHIEVEMENTS.map((a) => {
                const unlocked = unlockedAchievements.has(a.id);
                return (
                  <li
                    key={a.id}
                    className={unlocked ? "achievements-row achievements-row--unlocked" : "achievements-row"}
                  >
                    <span className="achievements-icon">{unlocked ? "🏆" : "🔒"}</span>
                    <span className="achievements-text">
                      <span className="achievements-label">{a.label}</span>
                      <span className="achievements-desc">{a.description}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <button
              onClick={() => {
                setShowAchievements(false);
                // An explicit close is a deliberate "back to the game" —
                // unlike auto-pause-on-blur (an involuntary interruption
                // that deliberately never auto-resumes), the player just
                // asked to return, so resume right away rather than
                // leaving them stuck paused with no visible way out.
                useGameStore.getState().resume();
              }}
            >
              סגור
            </button>
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
            {leaderboard.length > 0 && (
              <div className="hud-leaderboard">
                <div className="hud-leaderboard-title">חמישיית השיאים</div>
                <ol className="hud-leaderboard-list">
                  {leaderboard.map((entry, i) => (
                    <li
                      key={`${entry.date}-${i}`}
                      // Best-effort "this is the run that just ended" tell —
                      // matched by score+wave rather than the entry's own
                      // date, since that's the only pair HUD already has on
                      // hand here to compare against. A rare false positive
                      // (an identical earlier run) is a harmless cosmetic
                      // miss, not a functional one — the board itself is
                      // still exactly right either way.
                      className={
                        entry.score === score && entry.wave === wave
                          ? "hud-leaderboard-row hud-leaderboard-row--current"
                          : "hud-leaderboard-row"
                      }
                    >
                      <span className="hud-leaderboard-rank">{i + 1}</span>
                      <span className="hud-leaderboard-score">{entry.score.toLocaleString("he-IL")}</span>
                      <span className="hud-leaderboard-wave">גל {entry.wave}</span>
                    </li>
                  ))}
                </ol>
              </div>
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

      {/* A permanent instrument, not something that only appears once
          needed — always visible during play (bottom-right, mirroring the
          achievement toast's own bottom-left spot) so its existence is
          discoverable before a flanker ever forces the question "where did
          that shot come from." See FLANKER's own comment in
          config/constants.ts for why a flanker specifically needs this and
          nothing else in the game does: its whole wide leg is deliberately
          spent outside the camera's own view. */}
      {status === "playing" && (
        <div className="radar">
          <div className="radar-forward-tick" />
          <div className="radar-ship" />
          {radarBlips.map((b, i) => {
            const { x, y } = radarOffset(b.dx, b.dz);
            return (
              <div
                key={i}
                className={b.offscreen ? "radar-blip radar-blip--offscreen" : "radar-blip"}
                style={{ transform: `translate(${x}px, ${y}px)` }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

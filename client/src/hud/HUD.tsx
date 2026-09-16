import { useEffect, useState } from "react";
import { ACHIEVEMENTS, useGameStore } from "../state/gameStore";
import { COLORS, FLANKER, SHIP } from "../config/constants";
import { isMuted, setMuted } from "../audio/sound";
import "./hud.css";

// One row of the help panel's "threats" section: a color dot (matching the
// actual in-game color, not a generic bullet) plus a label/description pair
// — same shape as ACHIEVEMENTS, so a returning player can connect "that
// thing I saw in the fight" to its real name and color at a glance.
interface HelpEntry {
  color: string;
  label: string;
  desc: string;
}

const HELP_CONTROLS: { key: string; action: string }[] = [
  { key: "WASD / חצים", action: "תנועה" },
  { key: "Z / C", action: "קדימה / אחורה (עומק אמיתי)" },
  { key: "רווח / קליק שמאלי", action: "ירי" },
  { key: "G", action: "רימון (נשק שטח)" },
  { key: "3", action: "משקפי תלת-ממד אדום-כחול" },
  { key: "Esc", action: "השהיה" },
];

const HELP_THREATS: HelpEntry[] = [
  { color: COLORS.amber, label: "אויב רגיל", desc: "פגיעה אחת מספיקה" },
  { color: COLORS.enemyHeavyAccent, label: "אויב כבד", desc: "כחול, גדול יותר — דורש 2 פגיעות" },
  { color: COLORS.accent, label: "צלילה (Diver)", desc: "עוזב את הפורמציה וצולל ישר לעברכם" },
  {
    color: COLORS.enemyBolt,
    label: "הקפה (Flanker)",
    desc: "מקיף מרחוק, כמעט תמיד מחוץ לשדה הראייה — עקבו במכ\"ם בפינה הימנית-תחתונה",
  },
  {
    color: COLORS.weakPoint,
    label: "בוס (כל גל 5)",
    desc: "יש לו נקודת תורפה מסתובבת — פגיעה מהזווית הלא נכונה לא עושה נזק בכלל",
  },
  {
    color: COLORS.anomalyRing,
    label: "אנומליית כבידה",
    desc: "חור שחור זמני שמושך כדורים וספינה כאחד, ובולע כל מה שמתקרב מדי",
  },
];

const HELP_PICKUPS: HelpEntry[] = [
  { color: COLORS.pickupHealth, label: "בריאות", desc: "משחזר כוח" },
  { color: COLORS.pickupWeapon, label: "שדרוג נשק", desc: "פיזור משולש או אש מהירה, לזמן מוגבל" },
  { color: COLORS.pickupBomb, label: "פצצת נובה", desc: "נדיר מאוד — משמיד מיידית כל מה שעל המסך" },
];

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
    grenadeReadyAt,
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
    bossWeak,
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
  const [showHelp, setShowHelp] = useState(false);

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
  // Grenade cooldown countdown — same derivation shape as weaponSecondsLeft,
  // but here 0 means "ready to throw" (G) rather than "no timed weapon".
  const grenadeSecondsLeft = Math.max(0, Math.ceil((grenadeReadyAt - now) / 1000));
  const grenadeReady = grenadeSecondsLeft === 0;

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
        {/* Grenade readiness — G throws it (see GRENADE in
            config/constants.ts). Shows "מוכן" the moment it's armed, a
            plain countdown otherwise, same "ready vs. counting down" shape
            weaponSecondsLeft already uses for the timed-weapon stat. */}
        <div className="hud-stat hud-stat--num">
          <span className="hud-label">רימון (G)</span>
          <span className="hud-value hud-value--grenade" data-ready={grenadeReady}>
            {grenadeReady ? "מוכן" : `${grenadeSecondsLeft}ש`}
          </span>
        </div>
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
              // Same pause-while-open reasoning as the achievements button
              // below, and mutually exclusive with it — opening one closes
              // the other rather than letting both overlays stack.
              if (!showHelp && status === "playing") useGameStore.getState().pause();
              setShowHelp((v) => !v);
              setShowAchievements(false);
            }}
            data-active={showHelp}
          >
            {compact ? "❓" : "❓ עזרה"}
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
              setShowHelp(false);
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
          {/* Textual backup for the 3D weak-point marker itself (see
              WeakPoint.tsx) — the marker is the primary signal, but a
              glance at this pill confirms it without hunting for a small
              orbiting object on a busy screen. */}
          <span className="boss-weak-pill" data-weak={bossWeak}>
            {bossWeak ? "פגיע!" : "מוגן"}
          </span>
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

      {/* Hidden while the achievements or help panel is open — either one
          is the only reason this pause happened (see their own toggle
          buttons above), and each has its own close button that resumes
          the run itself; showing both overlays at once would stack two
          competing "resume" controls. */}
      {paused && status === "playing" && !showAchievements && !showHelp && (
        <div className="hud-overlay">
          <div className="hud-panel">
            <h1>מושהה</h1>
            <button onClick={togglePause}>המשך</button>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="hud-overlay">
          <div className="hud-panel hud-panel--help">
            <h1>עזרה</h1>
            <div className="help-body">
              <div className="help-section">
                <div className="help-section-title">בקרות</div>
                <div className="help-controls-grid">
                  {HELP_CONTROLS.map((c) => (
                    <div className="help-controls-row" key={c.key}>
                      <span className="help-key" dir="ltr">
                        {c.key}
                      </span>
                      <span className="help-action">{c.action}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="help-section">
                <div className="help-section-title">איומים</div>
                <ul className="help-list">
                  {HELP_THREATS.map((t) => (
                    <li className="help-row" key={t.label}>
                      <span className="help-dot" style={{ background: t.color, color: t.color }} />
                      <span className="help-text">
                        <span className="help-label">{t.label}</span>
                        <span className="help-desc">{t.desc}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="help-section">
                <div className="help-section-title">פריטים</div>
                <ul className="help-list">
                  {HELP_PICKUPS.map((p) => (
                    <li className="help-row" key={p.label}>
                      <span className="help-dot" style={{ background: p.color, color: p.color }} />
                      <span className="help-text">
                        <span className="help-label">{p.label}</span>
                        <span className="help-desc">{p.desc}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <button
              onClick={() => {
                setShowHelp(false);
                // Same "explicit close resumes right away" reasoning as
                // the achievements panel's own close button.
                useGameStore.getState().resume();
              }}
            >
              סגור
            </button>
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

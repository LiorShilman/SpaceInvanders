import { create } from "zustand";
import { BOSS, COMBO, SHIP } from "../config/constants";

// "cleared" was a dead end — no such terminal state anymore. Beating a wave
// spawns a new, harder one (see Scene's spawnWave); only running out of
// lives ends the run.
export type GameStatus = "playing" | "gameover";

export type WeaponKind = "base" | "spread" | "rapid";

const WEAPON_LABELS: Record<WeaponKind, string> = {
  base: "בסיסי",
  spread: "פיזור משולש",
  rapid: "אש מהירה",
};

const HIGH_SCORE_KEY = "nexus-high-score";
const HIGH_WAVE_KEY = "nexus-high-wave";
const LEADERBOARD_KEY = "nexus-leaderboard";
const LEADERBOARD_SIZE = 5;

function loadHighScore(): { score: number; wave: number } {
  try {
    return {
      score: Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0,
      wave: Number(localStorage.getItem(HIGH_WAVE_KEY)) || 0,
    };
  } catch {
    return { score: 0, wave: 0 }; // private browsing / storage disabled
  }
}

function saveHighScore(score: number, wave: number) {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(score));
    localStorage.setItem(HIGH_WAVE_KEY, String(wave));
  } catch {
    // Nothing to do if storage is unavailable — the in-memory value this
    // session still works, it just won't survive a reload.
  }
}

export interface LeaderboardEntry {
  score: number;
  wave: number;
  date: string; // ISO timestamp — HUD formats it for display
}

function loadLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive against a hand-edited or stale-shape localStorage value —
    // only keep entries that actually look like a LeaderboardEntry.
    return parsed
      .filter(
        (e): e is LeaderboardEntry =>
          typeof e === "object" && e !== null && typeof e.score === "number" && typeof e.wave === "number",
      )
      .slice(0, LEADERBOARD_SIZE);
  } catch {
    return []; // private browsing / storage disabled / corrupt JSON
  }
}

function saveLeaderboard(list: LeaderboardEntry[]) {
  try {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
  } catch {
    // Nothing to do if storage is unavailable — same as saveHighScore.
  }
}

/** Inserts this run's result into the top-LEADERBOARD_SIZE list by score
 * and persists it, but only if it actually cracked the list — a run that
 * doesn't place needs no write and returns the exact same array reference
 * (so callers can skip re-rendering on a no-op). Zero-score runs are never
 * recorded; an empty run isn't a "score" worth cluttering the board with. */
function settleLeaderboard(score: number, wave: number, prevList: LeaderboardEntry[]): LeaderboardEntry[] {
  if (score <= 0) return prevList;
  const entry: LeaderboardEntry = { score, wave, date: new Date().toISOString() };
  const next = [...prevList, entry].sort((a, b) => b.score - a.score).slice(0, LEADERBOARD_SIZE);
  if (!next.includes(entry)) return prevList; // didn't crack the top LEADERBOARD_SIZE
  saveLeaderboard(next);
  return next;
}

const ACHIEVEMENTS_KEY = "nexus-achievements";

function loadUnlockedAchievements(): Set<string> {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set(); // private browsing / storage disabled / corrupt JSON
  }
}

function saveUnlockedAchievements(ids: Set<string>) {
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify([...ids]));
  } catch {
    // Nothing to do if storage is unavailable — same as saveHighScore.
  }
}

interface GameState {
  status: GameStatus;
  health: number;
  score: number;
  wave: number;
  enemiesRemaining: number;
  bannerText: string | null;
  // Wall-clock timestamp (Date.now()), deliberately NOT the frame-accumulated
  // sim clock — the HUD timer should show real elapsed time even if the
  // simulation itself is running slow (heavy scene / low frame rate), so a
  // player can actually notice that mismatch instead of it being invisible.
  runStartedAt: number;
  // Extra chances left beyond the current one (see SHIP.startingLives).
  lives: number;
  comboMultiplier: number;
  // Wall-clock timestamp — the multiplier shown should decay to 1 once this
  // passes, even without another kill to trigger the reset (see HUD, which
  // computes the *displayed* multiplier from this rather than trusting
  // comboMultiplier to already have been reset).
  comboExpiresAt: number;
  weapon: WeaponKind;
  weaponExpiresAt: number; // 0 = no timed weapon active (plain "base")
  // Wall-clock timestamp — damageShip/handleInvasion both no-op while now()
  // is before this, and Scene lets enemy bolts pass through the ship
  // visually rather than colliding, for the same window.
  invulnerableUntil: number;
  // Persisted across runs (localStorage) — NOT part of `initial` below, so
  // reset() (a shallow merge, not a replace) never touches these.
  highScore: number;
  highWave: number;
  // Top LEADERBOARD_SIZE runs by score, newest-qualifying-run-inclusive —
  // same persistence rule as highScore/highWave above (not part of
  // `initial`, settled once as a run ends via settleLeaderboard).
  leaderboard: LeaderboardEntry[];
  // Which achievement ids have EVER been unlocked, across every run this
  // browser has played — same persistence rule as highScore/leaderboard
  // (not part of `initial`, survives reset()). unlockAchievement is the
  // only thing that ever adds to this.
  unlockedAchievements: Set<string>;
  // The one currently-showing "achievement unlocked" toast, or null — a
  // transient UI slot HUD auto-clears after its own animation, same
  // pattern as bannerText. A second unlock landing in the exact same tick
  // would overwrite this one before it ever renders (no queue) — accepted
  // as a rare, harmless edge case rather than engineering a toast queue
  // for achievements that are each a one-time, temporally distinct event.
  achievementToast: { id: string; label: string } | null;
  // Freezes Scene's whole simulation branch without ending the run — see
  // useAutoPause.ts for the tab-blur/visibility trigger, and HUD.tsx for
  // the manual toggle + overlay.
  paused: boolean;

  // Boss waves (see BOSS in config/constants.ts) replace the normal grid
  // formation entirely with one large, multi-hit enemy — HUD shows a boss
  // health bar instead of the usual "enemies remaining" stat whenever this
  // is true. bossHealth/bossMaxHealth exist purely for that bar; Scene's
  // own ref is still the source of truth the simulation itself reads.
  bossActive: boolean;
  bossHealth: number;
  bossMaxHealth: number;

  damageShip: (amount: number) => void;
  /** Scene calls this when the wave's front line crosses FORMATION.invadeZ.
   * Distinct from damageShip: this always costs a full life outright (no
   * partial-health step), and returns whether the run is still alive — if
   * so, Scene must also reset the whole wave, not just the ship, or the
   * still-broken-through formation would re-trigger this next frame. */
  handleInvasion: () => boolean;
  registerKill: (bonus?: number) => void;
  collectHealth: (amount: number) => void;
  collectWeapon: (kind: WeaponKind, durationMs: number) => void;
  /** Nova bomb collected — Scene does the actual screen-clear (see
   * triggerNovaBomb); this just announces it, same as collectHealth/
   * collectWeapon do for their own pickups. */
  collectNova: () => void;
  revertWeapon: () => void;
  setEnemiesRemaining: (count: number) => void;
  advanceWave: () => void;
  clearBanner: () => void;
  pause: () => void;
  resume: () => void;
  togglePause: () => void;
  // Called once when a boss wave spawns (health === maxHealth) and again on
  // every hit that lands (health decreasing) — see damageBoss for the hit
  // case specifically, this is the general setter Scene uses for both.
  setBoss: (active: boolean, health: number, maxHealth: number) => void;
  damageBoss: (amount: number) => void;
  /** The boss's health just reached 0 — awards its score in one flat shot
   * (deliberately NOT routed through registerKill's combo multiplier, which
   * doesn't fit a single one-off reward) and clears bossActive. */
  defeatBoss: (scoreReward: number) => void;
  /** Unlocks achievement `id` the first time it's ever earned, persists it,
   * and surfaces a one-off toast — a no-op on every later call once it's
   * already unlocked. Callers just call this unconditionally at the
   * moment an achievement's condition is met, rather than checking
   * unlockedAchievements themselves first. */
  unlockAchievement: (id: string, label: string) => void;
  clearAchievementToast: () => void;
  reset: () => void;
}

const initial = {
  status: "playing" as GameStatus,
  health: SHIP.maxHealth,
  score: 0,
  wave: 1,
  enemiesRemaining: 0,
  bannerText: null as string | null,
  runStartedAt: Date.now(),
  lives: SHIP.startingLives,
  comboMultiplier: 1,
  comboExpiresAt: 0,
  weapon: "base" as WeaponKind,
  weaponExpiresAt: 0,
  invulnerableUntil: 0,
  paused: false,
  bossActive: false,
  bossHealth: 0,
  bossMaxHealth: 0,
};

/** Compares against the currently-stored high score/wave, persists a new
 * one if either was beaten, and returns the (possibly updated) pair — used
 * right as a run ends, since that's the only moment this run's numbers are
 * truly final. */
function settleHighScore(score: number, wave: number, prevHigh: { highScore: number; highWave: number }) {
  const highScore = Math.max(prevHigh.highScore, score);
  const highWave = Math.max(prevHigh.highWave, wave);
  if (highScore !== prevHigh.highScore || highWave !== prevHigh.highWave) {
    saveHighScore(highScore, highWave);
  }
  return { highScore, highWave };
}

const storedHigh = loadHighScore();
const storedLeaderboard = loadLeaderboard();
const storedAchievements = loadUnlockedAchievements();

export const useGameStore = create<GameState>((set, get) => ({
  ...initial,
  highScore: storedHigh.score,
  highWave: storedHigh.wave,
  leaderboard: storedLeaderboard,
  unlockedAchievements: storedAchievements,
  achievementToast: null,

  damageShip: (amount) => {
    const s = get();
    if (s.status !== "playing") return;
    if (Date.now() < s.invulnerableUntil) return; // mid-respawn grace period
    const health = Math.max(0, s.health - amount);
    if (health > 0) {
      set({ health });
      return;
    }
    if (s.lives > 0) {
      const lives = s.lives - 1;
      set({
        lives,
        health: SHIP.maxHealth,
        invulnerableUntil: Date.now() + SHIP.respawnInvulnerability * 1000,
        bannerText: `הפגיעה הייתה קטלנית — נותרו ${lives} חיים`,
      });
    } else {
      const high = settleHighScore(s.score, s.wave, s);
      const leaderboard = settleLeaderboard(s.score, s.wave, s.leaderboard);
      set({ health: 0, status: "gameover", ...high, leaderboard });
    }
  },

  handleInvasion: () => {
    const s = get();
    if (s.status !== "playing") return false;
    if (Date.now() < s.invulnerableUntil) return false;
    if (s.lives > 0) {
      const lives = s.lives - 1;
      set({
        lives,
        health: SHIP.maxHealth,
        invulnerableUntil: Date.now() + SHIP.respawnInvulnerability * 1000,
        bannerText: `הגל פרץ! נותרו ${lives} חיים`,
      });
      return true;
    }
    const high = settleHighScore(s.score, s.wave, s);
    const leaderboard = settleLeaderboard(s.score, s.wave, s.leaderboard);
    set({ health: 0, status: "gameover", ...high, leaderboard });
    return false;
  },

  // Replaces the old flat addScore(100) — every kill now goes through the
  // combo multiplier. Kills within COMBO.windowMs of the last one keep
  // building the streak (capped); a gap that long resets it to 1 first.
  // `bonus` is added flat, on top of the multiplied kill score — Scene
  // passes DIVE.killBonus for a diving enemy, 0 (default) otherwise.
  registerKill: (bonus = 0) => {
    const s = get();
    const now = Date.now();
    const inWindow = now < s.comboExpiresAt;
    const multiplier = inWindow ? Math.min(s.comboMultiplier + 1, COMBO.maxMultiplier) : 1;
    set({
      score: s.score + COMBO.killScore * multiplier + bonus,
      comboMultiplier: multiplier,
      comboExpiresAt: now + COMBO.windowMs,
    });
  },

  collectHealth: (amount) => {
    const s = get();
    if (s.status !== "playing") return;
    set({
      health: Math.min(SHIP.maxHealth, s.health + amount),
      bannerText: `משקה בריאות נאסף (+${amount} כוח)`,
    });
  },

  collectWeapon: (kind, durationMs) =>
    set({
      weapon: kind,
      weaponExpiresAt: Date.now() + durationMs,
      bannerText: `נשק חדש: ${WEAPON_LABELS[kind]}`,
    }),

  collectNova: () => set({ bannerText: "פצצת נובה! 💥 כל האויבים הושמדו" }),

  // Scene calls this once its own timer sees the current weapon's time run
  // out — silent on purpose (no banner), unlike picking one up.
  revertWeapon: () => set({ weapon: "base", weaponExpiresAt: 0 }),

  setEnemiesRemaining: (count) => set({ enemiesRemaining: count }),

  // Score/health carry over — only the wave counter and a transient HUD
  // banner change here. Scene calls this once the last enemy in a wave
  // dies, then spawns the next (harder) wave itself. Warns ahead of time
  // when that next wave is a boss wave (see BOSS.waveInterval) — arriving
  // at a full-screen enemy with zero warning read as unfair rather than
  // exciting when this didn't distinguish the two.
  advanceWave: () =>
    set((s) => {
      const nextWave = s.wave + 1;
      const bannerText =
        nextWave % BOSS.waveInterval === 0
          ? `⚠ בוס מתקרב — גל ${nextWave}`
          : `גל ${s.wave} נהדף — גל ${nextWave} מתקרב`;
      return { wave: nextWave, bannerText };
    }),

  clearBanner: () => set({ bannerText: null }),

  pause: () => {
    if (get().status === "playing") set({ paused: true });
  },
  resume: () => set({ paused: false }),
  togglePause: () => {
    const s = get();
    if (s.status !== "playing") return; // nothing to pause on the game-over screen
    set({ paused: !s.paused });
  },

  setBoss: (active, health, maxHealth) => set({ bossActive: active, bossHealth: health, bossMaxHealth: maxHealth }),
  damageBoss: (amount) => set((s) => ({ bossHealth: Math.max(0, s.bossHealth - amount) })),
  // Bumps the wave counter itself (taking over advanceWave's usual job for
  // this one transition) rather than also calling advanceWave — that would
  // set ITS OWN banner text right after this one, silently discarding the
  // "boss defeated" message before anyone ever saw it (both happen inside
  // the same synchronous tick, so only the last set() would ever render).
  defeatBoss: (scoreReward) =>
    set((s) => {
      const nextWave = s.wave + 1;
      return {
        bossActive: false,
        bossHealth: 0,
        score: s.score + scoreReward,
        wave: nextWave,
        bannerText: `הבוס הובס! +${scoreReward} נקודות — גל ${nextWave} מתקרב`,
      };
    }),

  unlockAchievement: (id, label) => {
    const s = get();
    if (s.unlockedAchievements.has(id)) return;
    const next = new Set(s.unlockedAchievements);
    next.add(id);
    saveUnlockedAchievements(next);
    set({ unlockedAchievements: next, achievementToast: { id, label } });
  },
  clearAchievementToast: () => set({ achievementToast: null }),

  // Reuses `initial` but stamps a fresh start time — reset() can fire long
  // after module load (every "שחק שוב"), so the frozen initial.runStartedAt
  // would otherwise make the timer start already stale. highScore/highWave
  // aren't part of `initial`, so this shallow merge leaves them untouched.
  reset: () => set({ ...initial, runStartedAt: Date.now() }),
}));

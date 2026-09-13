import { create } from "zustand";
import { COMBO, SHIP } from "../config/constants";

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

  damageShip: (amount: number) => void;
  /** Scene calls this when the wave's front line crosses FORMATION.invadeZ.
   * Distinct from damageShip: this always costs a full life outright (no
   * partial-health step), and returns whether the run is still alive — if
   * so, Scene must also reset the whole wave, not just the ship, or the
   * still-broken-through formation would re-trigger this next frame. */
  handleInvasion: () => boolean;
  registerKill: () => void;
  collectHealth: (amount: number) => void;
  collectWeapon: (kind: WeaponKind, durationMs: number) => void;
  revertWeapon: () => void;
  setEnemiesRemaining: (count: number) => void;
  advanceWave: () => void;
  clearBanner: () => void;
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
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initial,

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
      set({ health: 0, status: "gameover" });
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
    set({ health: 0, status: "gameover" });
    return false;
  },

  // Replaces the old flat addScore(100) — every kill now goes through the
  // combo multiplier. Kills within COMBO.windowMs of the last one keep
  // building the streak (capped); a gap that long resets it to 1 first.
  registerKill: () => {
    const s = get();
    const now = Date.now();
    const inWindow = now < s.comboExpiresAt;
    const multiplier = inWindow ? Math.min(s.comboMultiplier + 1, COMBO.maxMultiplier) : 1;
    set({
      score: s.score + COMBO.killScore * multiplier,
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

  // Scene calls this once its own timer sees the current weapon's time run
  // out — silent on purpose (no banner), unlike picking one up.
  revertWeapon: () => set({ weapon: "base", weaponExpiresAt: 0 }),

  setEnemiesRemaining: (count) => set({ enemiesRemaining: count }),

  // Score/health carry over — only the wave counter and a transient HUD
  // banner change here. Scene calls this once the last enemy in a wave
  // dies, then spawns the next (harder) wave itself.
  advanceWave: () =>
    set((s) => ({ wave: s.wave + 1, bannerText: `גל ${s.wave} נהדף — גל ${s.wave + 1} מתקרב` })),

  clearBanner: () => set({ bannerText: null }),

  // Reuses `initial` but stamps a fresh start time — reset() can fire long
  // after module load (every "שחק שוב"), so the frozen initial.runStartedAt
  // would otherwise make the timer start already stale.
  reset: () => set({ ...initial, runStartedAt: Date.now() }),
}));

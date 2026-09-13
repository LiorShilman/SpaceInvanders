import { create } from "zustand";
import { SHIP } from "../config/constants";

// "cleared" was a dead end — no such terminal state anymore. Beating a wave
// spawns a new, harder one (see Scene's spawnWave); only running out of
// health ends the run.
export type GameStatus = "playing" | "gameover";

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
  damageShip: (amount: number) => void;
  addScore: (points: number) => void;
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
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initial,

  damageShip: (amount) => {
    if (get().status !== "playing") return;
    const health = Math.max(0, get().health - amount);
    set({ health, status: health <= 0 ? "gameover" : "playing" });
  },

  addScore: (points) => set((s) => ({ score: s.score + points })),

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

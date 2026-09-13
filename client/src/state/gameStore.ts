import { create } from "zustand";
import { SHIP } from "../config/constants";

export type GameStatus = "playing" | "cleared" | "gameover";

interface GameState {
  status: GameStatus;
  health: number;
  score: number;
  wave: number;
  enemiesRemaining: number;
  damageShip: (amount: number) => void;
  addScore: (points: number) => void;
  setEnemiesRemaining: (count: number) => void;
  clearWave: () => void;
  reset: () => void;
}

const initial = {
  status: "playing" as GameStatus,
  health: SHIP.maxHealth,
  score: 0,
  wave: 1,
  enemiesRemaining: 0,
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

  clearWave: () => {
    if (get().status !== "playing") return;
    set({ status: "cleared" });
  },

  reset: () => set({ ...initial }),
}));

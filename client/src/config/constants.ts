// Phosphor palette — matches docs/GAME_PLAN.md visual language. Neon accents
// (phosphor/amber) mark energy — weapons, engines, cores; hull tones are dark
// desaturated metal so real shading/lighting reads on the geometry instead of
// everything being flat, self-lit color.
export const COLORS = {
  background: "#0a0d0a",
  phosphor: "#57e089",
  phosphorDim: "#2f6b48",
  // Enemy accent: was a dated, low-saturation amber/orange. Replaced with a
  // hot magenta-red — reads as a genuine "hostile alien energy" color and
  // sits as a strong complementary contrast against the ship's green,
  // instead of two muted warm tones competing.
  amber: "#ff2e63",
  amberDim: "#6b0f30",
  text: "#d9e5d1",
  hull: "#2a3230",
  hullDark: "#171c1a",
  enemyHull: "#2b1620",
  enemyHullDark: "#160a10",
  rimLight: "#6fa8ff",
} as const;

// Arena bounds the player ship can move within (world units). Must cover the
// formation's full sway-inclusive width/height (see FORMATION below) or the
// ship can physically never aim at the edge columns / top rows it can't
// reach — this has bitten us twice now, so: halfWidth must be >=
// (maxCol * spacingX + row-stagger + jitter margin) + swayAmplitude, and
// maxY must be >= the top row's y + jitter margin.
export const ARENA = {
  halfWidth: 13,
  minY: 0.5,
  maxY: 9.9,
  shipZ: 8,
} as const;

export const SHIP = {
  speed: 9, // units/sec
  fireCooldown: 0.22, // seconds between shots
  maxHealth: 100,
};

export const PROJECTILE = {
  playerSpeed: 22,
  enemySpeed: 10,
  playerDamage: 1, // one hit kills a Grunt (health = 1)
  enemyDamage: 12,
  poolSize: 80,
};

export const FORMATION = {
  // The original arcade wave is 11x5 (55 invaders); we don't quite match
  // that (bigger, more detailed models need more breathing room per unit
  // than 1978's sprites did), but 8x5 = 40 is a real step up from a token
  // 6x4 grid.
  rows: 5,
  cols: 8,
  // Wide enough for the enemy model at its 1.8x display scale (see Enemy.tsx)
  // not to overlap its neighbors.
  spacingX: 2.4,
  spacingY: 1.7,
  // A static per-enemy depth offset (tried: center columns bulging forward,
  // higher rows receding) was reverted — whichever enemy fired, if it wasn't
  // in the "front" slot of that shape, its shot visibly spawned from behind
  // its neighbors. Real 3D variety belongs in actual behavior (diving,
  // flanking — Phase 2 in docs/GAME_PLAN.md), not a fixed static bulge that
  // fights against readable firing. The grid is flat in Z again.
  startZ: -32, // more runway between ship and wave than the original -22
  invadeZ: 5, // if the front row reaches this, the wave has broken through
  swaySpeed: 0.6,
  swayAmplitude: 3.5,
  advanceSpeed: 0.4, // units/sec creeping toward the player (tuned to the longer runway above)
  enemyFireIntervalMin: 1.8,
  enemyFireIntervalMax: 4.5,
};

// Destructible bunkers between the ship and the wave — block both sides'
// fire, chip away block by block. The one piece of the original arcade
// layout that was missing entirely.
export const SHIELD = {
  count: 4,
  cols: 5,
  rows: 4,
  blockSize: 0.42,
  z: 3, // between the ship (8) and the invade line (5)
  baseY: 1.4,
  hitRadius: 0.34,
  // 1 = block present. Bottom-middle notch cut out, echoing the arcade
  // bunkers' eroded silhouette.
  pattern: [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 0, 1, 1],
  ],
};

export const HIT_RADIUS = {
  playerProjectileVsEnemy: 0.75,
  enemyProjectileVsShip: 0.85,
};

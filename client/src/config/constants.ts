// Phosphor palette — matches docs/GAME_PLAN.md visual language.
export const COLORS = {
  background: "#0a0d0a",
  phosphor: "#57e089",
  phosphorDim: "#2f6b48",
  amber: "#e2a23f",
  text: "#d9e5d1",
} as const;

// Arena bounds the player ship can move within (world units).
export const ARENA = {
  halfWidth: 7,
  minY: 0.5,
  // Must reach at least the formation's top row (see FORMATION below) or the
  // ship can physically never aim high enough to hit it.
  maxY: 7,
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
  rows: 4,
  cols: 6,
  spacingX: 1.8,
  spacingY: 1.3,
  // Gives the formation real volume instead of a flat plane: the center
  // columns bulge toward the player, and higher rows recede further back —
  // like a shallow, curved amphitheater wall facing the ship. Kept modest:
  // too deep and an edge column's row-0 shooter sits far enough behind the
  // center bulge that its shots read as coming from behind the formation.
  archDepth: 1.1,
  rowDepth: 0.35,
  startZ: -32, // more runway between ship and wave than the original -22
  invadeZ: 5, // if the front row reaches this, the wave has broken through
  swaySpeed: 0.6,
  swayAmplitude: 4,
  advanceSpeed: 0.4, // units/sec creeping toward the player (tuned to the longer runway above)
  enemyFireIntervalMin: 1.8,
  enemyFireIntervalMax: 4.5,
};

export const HIT_RADIUS = {
  playerProjectileVsEnemy: 0.75,
  enemyProjectileVsShip: 0.85,
};

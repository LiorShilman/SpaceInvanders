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
  // Enemy weapon fire: was the same amber as their own body/eye/ring — no
  // way to visually tell "enemy" from "enemy's shot" apart at a glance. A
  // hot orange keeps the same warm/hostile family without being identical.
  enemyBolt: "#ff8c3d",
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
  shipZ: 8, // default spawn depth
  // Real forward/back piloting range (Z/C), not just an X/Y plane. Closer
  // (toward minZ) shortens bolt travel time — easier to lead the swaying
  // formation — at the cost of less reaction time to incoming fire; minZ
  // stays a little above the shields (z=3) and the invade line (z=5) so
  // standing at the limit doesn't feel like clipping into either.
  minZ: 6,
  maxZ: 13,
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
  // Was 12 (needing ~8 hits to die) — with shields now blocking a real
  // share of incoming fire, so few enemy bolts were reaching the ship at
  // all that health barely moved. Raised so the hits that do land actually
  // matter: ~4-5 now kill.
  enemyDamage: 22,
  // Was 80 (x2 pools = 160 meshes) — at most FORMATION.cols (8) enemy shots
  // and a handful of player shots are ever in flight at once, so this was
  // pure unused mesh/draw-call overhead. 40 each still leaves generous
  // headroom.
  poolSize: 40,
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
  // If the (flat, single-z) formation reaches this, the wave has broken
  // through. Was a bare 5 — only 1 unit before ARENA.minZ (6), which reads
  // like a safety margin but isn't one, and not by a small amount either.
  // This is a forward-facing perspective camera near the ship: apparent size
  // grows with 1/(distance to camera), so the last stretch of the approach
  // compresses dramatically — screenshots confirmed the formation already
  // visually swallowing the shields and the ship by z=-5..0, a good 8-11
  // units of raw z before it would reach anything close to ARENA.minZ. A
  // small buffer off minZ (as a flat linear gap) can't fix a problem that's
  // fundamentally non-linear in z. -8 was the empirically-checked cutoff:
  // the formation's front row just brushes the shield tops there, still
  // read as "closing in," not "already on top of you."
  invadeZ: ARENA.minZ - 14, // = -8
  swaySpeed: 0.6,
  swayAmplitude: 3.5,
  advanceSpeed: 0.4, // units/sec creeping toward the player (tuned to the longer runway above)
  enemyFireIntervalMin: 1.8,
  enemyFireIntervalMax: 4.5,
};

// Each cleared wave respawns a new one — harder, not the same — via these
// per-wave multipliers (wave 1 is the baseline FORMATION values above).
export const WAVE_SCALING = {
  advanceSpeedGrowth: 1.12, // x per wave
  fireIntervalShrink: 0.94, // x per wave, floored below
  minFireIntervalMin: 0.6,
  minFireIntervalMax: 1.2,
};

// Destructible bunkers between the ship and the wave — chip away block by
// block as they absorb incoming enemy fire. The one piece of the original
// arcade layout that was missing entirely.
//
// Enemy bolts travel at a fixed height (the shooting enemy's row — no arc),
// so a shield only has any chance of intercepting fire from rows whose
// height it actually spans. A short, arcade-proportioned bunker (4 rows,
// ~1.3 units tall) only reached row 0 — every other row's fire sailed clean
// over it, which is why hardly anything seemed to dent the shields. Taller
// on purpose: tall enough to span rows 0-1, so a meaningful share of enemy
// fire is interceptable, not just the bottom row's. (This wouldn't have
// been free before player fire was made to pass through shields — a taller
// shield back then would have blocked the player's own aim at even more
// rows. Now it costs nothing.)
const SHIELD_ROWS = 7;
export const SHIELD = {
  count: 4,
  cols: 5,
  rows: SHIELD_ROWS,
  blockSize: 0.42,
  // A fixed collision plane bolts pass through en route to the ship — not
  // tied to the formation's own advancing z, so it doesn't need to sit in
  // any particular order relative to FORMATION.invadeZ (see there).
  z: 3,
  baseY: 1.7,
  hitRadius: 0.34,
  // 1 = block present. A notch open at the bottom two rows' middle column,
  // echoing the arcade bunkers' eroded-tunnel silhouette.
  pattern: Array.from({ length: SHIELD_ROWS }, (_, row) =>
    row >= SHIELD_ROWS - 2 ? [1, 1, 0, 1, 1] : [1, 1, 1, 1, 1],
  ),
};

export const HIT_RADIUS = {
  playerProjectileVsEnemy: 0.75,
  enemyProjectileVsShip: 0.85,
};

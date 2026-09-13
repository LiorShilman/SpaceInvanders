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
  // Pickups: a third hue family, distinct from both the ship's green and the
  // enemies' magenta-red, so a drifting capsule reads as "neither of those"
  // at a glance. Both weapon kinds (spread/rapid) share one color — which
  // one you got is a HUD/banner detail, not something the pickup's own color
  // needs to carry.
  pickupHealth: "#48d1ff",
  pickupWeapon: "#c77dff",
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
  shipZ: 8, // default spawn depth — behind the shields (SHIELD.z = 3), i.e. protected
  // Real forward/back piloting range (Z/C), not just an X/Y plane. Closer
  // (toward minZ) shortens bolt travel time — easier to lead the swaying
  // formation — at the cost of less reaction time to incoming fire.
  //
  // minZ deliberately reaches past SHIELD.z (3), not just up to it: an
  // enemy bolt is blocked by a shield only if the shield sits somewhere
  // between where the bolt was FIRED and where the SHIP currently is (bolts
  // always travel from the formation toward increasing z, so whichever of
  // shield-z / ship-z comes first along that path is what the bolt reaches
  // first). Push forward (Z) past z=3 and the shields end up behind you —
  // no protection, but you're right on top of the action and every shot
  // lands almost instantly. Pull back (C) past z=3 and they're in front of
  // you again, screening incoming fire like normal. A real tactical choice
  // tied to actual position, not just a cosmetic depth range.
  minZ: -2,
  maxZ: 13,
} as const;

export const SHIP = {
  speed: 9, // units/sec
  fireCooldown: 0.22, // seconds between shots
  maxHealth: 100,
  // Extra chances beyond the current one — 2 means 3 total attempts per run.
  // Losing the last of your health with lives left respawns you in place
  // (same wave, same score) rather than ending the run outright.
  startingLives: 2,
  // Grace period after a respawn where the ship ignores enemy fire entirely
  // (bolts pass through) — otherwise a respawn into a still-dense bolt
  // pattern could burn the next life within the same second.
  respawnInvulnerability: 2,
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

// Drops from killed enemies — a capsule drifts toward the ship's current
// position and must be flown into, not auto-collected. The gentle x/y
// homing is an assist (the field is wide and fast-paced), not autopilot: it
// only pulls toward wherever the ship happens to be *right now*, so still
// flying into its actual path is what closes the gap in time.
export const PICKUP = {
  dropChance: 0.12,
  // Faster than any wave's own advanceSpeed so a capsule reliably reaches
  // the ship's operating range within its lifetime even at wave 1.
  speed: 3.4,
  homingRate: 1.1, // x/y lerp factor per second, toward the ship's live position
  radius: 1.05, // catch distance (ship <-> capsule)
  lifetime: 9, // seconds before an uncaught capsule despawns
  healthRestore: 30,
  // Pickup.tsx's own geometry (0.42-radius shell) is already a bit bigger
  // than a bolt, but not by enough to read as "a different kind of object
  // in the world" at a glance next to the ship's thin 0.05-radius beam or
  // the enemy's ~0.16-radius plasma glob — this scales the whole spawned
  // group up further so a capsule is unmistakably a pickup, not just
  // another shot flying past.
  visualScale: 1.7,
};

// Temporary alternate fire modes granted by a weapon-crate pickup — revert
// to the plain single shot (SHIP.fireCooldown) once the timer runs out.
export const WEAPON = {
  duration: 18, // seconds a picked-up weapon lasts
  spread: {
    cooldown: 0.3, // slower than base — 3 bolts per trigger, not 1
    offsets: [-0.6, 0, 0.6], // parallel bolts, not diverging — see Scene.tsx
  },
  rapid: {
    cooldown: 0.09,
  },
};

// Score combo: killing enemies without a gap longer than windowMs keeps
// building the multiplier (capped); missing that window resets it to 1 on
// the next kill. Pure skill-reward, no pickup needed for this one.
export const COMBO = {
  windowMs: 2500,
  maxMultiplier: 4,
  killScore: 100,
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
  // The wave's own physical stopping point — shields (SHIELD.z = 3) are a
  // real wall, not just something that happens to intercept bolts, so the
  // formation shouldn't be able to fly through/past their position any
  // more than an enemy bolt can. -8 (not simply "= SHIELD.z", which would
  // let the models visually clip straight through the shield geometry
  // before the formation's own position even nominally reaches it) is the
  // same value empirically checked via screenshots for FORMATION.invadeZ
  // earlier — at 1.8x scale, the models' own visual footprint already eats
  // several units past their nominal center, and z=-8 was where the front
  // row just brushes the shield tops without overlapping them. That old
  // invadeZ has since been replaced by a real proximity check
  // (HIT_RADIUS.enemyVsShip) for when a life is actually lost; this cap is
  // a separate, purely physical one — the wave holds at the wall
  // regardless of whether anyone's currently in danger from it.
  frontLineZ: -8,
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
  // tied to the formation's own advancing z at all.
  z: 3,
  baseY: 1.7,
  hitRadius: 0.34,
  // 1 = block present. A notch open at the bottom two rows' middle column,
  // echoing the arcade bunkers' eroded-tunnel silhouette.
  pattern: Array.from({ length: SHIELD_ROWS }, (_, row) =>
    row >= SHIELD_ROWS - 2 ? [1, 1, 0, 1, 1] : [1, 1, 1, 1, 1],
  ),
};

// Each bunker's wall glow tints toward this scale by its OWN remaining
// block fraction (not a global average across all 4) — a glance at any one
// shield tells you how much protection it still has left, instead of a
// fixed color that reads identically whether it's untouched or one hit from
// gone. "damaged" reuses the same amber as the ship's own critical-health
// tint (hud.css) — one consistent "getting dangerous" color across the HUD
// and the 3D scene, rather than two different unrelated warning hues.
export const SHIELD_HEALTH_COLORS = {
  healthy: COLORS.phosphor, // > 66% of this bunker's blocks remain
  damaged: "#e2a23f", // > 33% remain
  critical: "#ff4d4d", // <= 33% remain
};

export const HIT_RADIUS = {
  playerProjectileVsEnemy: 0.75,
  enemyProjectileVsShip: 0.85,
  // "The wave broke through" used to be a fixed z-depth check on the
  // formation's own position — completely blind to where the SHIP actually
  // was. The formation sways side to side (FORMATION.swayAmplitude) and,
  // depending on the wave's shape, can leave its remaining enemies bunched
  // far to one side; the old check fired the instant that depth was
  // crossed regardless of whether any live enemy was anywhere near the
  // ship, which could end a run (or cost a life) with the visible battle
  // nowhere close to you. This is the real thing that should matter
  // instead: an actual alive enemy has to reach within this distance of
  // the ship. Enemy models are ~1.8x scale, noticeably bigger than a
  // projectile, so this is generously larger than either hit radius above
  // — a real "it ran you over," not a graze.
  enemyVsShip: 2,
};

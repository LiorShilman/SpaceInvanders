// Phosphor palette — matches docs/GAME_PLAN.md visual language. Neon accents
// (phosphor/amber) mark energy — weapons, engines, cores; hull tones are dark
// desaturated metal so real shading/lighting reads on the geometry instead of
// everything being flat, self-lit color.
export const COLORS = {
  background: "#0a0d0a",
  // Reserved for the SHIP ITSELF (Ship.tsx's own glow, its bolts, the spark
  // when it takes a hit) — deliberately NOT used anywhere else anymore.
  // Green phosphor read as a CRT-terminal callback everywhere it touched —
  // fine as the ship's own identity, but pervasive across the HUD, the
  // targeting reticle, shields and the background nebula it was reading as
  // dated nostalgia rather than the "amazing, modern" look this project
  // has aimed for since day one. See `accent` below for what replaced it
  // in every one of those other places.
  phosphor: "#57e089",
  phosphorDim: "#2f6b48",
  // The general UI/ambient accent — HUD text and borders, buttons, the
  // targeting reticle/aim line, shields' healthy tint, half the background
  // nebula. An electric cyan reads as modern sci-fi tech (Tron/HUD-diagram
  // territory) rather than retro-terminal, and pairs as a cool complement
  // against both the ship's green and the enemies' hot magenta-red.
  // Matches pickupHealth exactly on purpose — "cool cyan = helpful/
  // informational" is now one consistent association across the whole game
  // rather than a coincidence.
  accent: "#48d1ff",
  accentDim: "#1c5f73",
  // Shields' own hue — distinct from BOTH the ship's green and the general
  // UI's cyan (`accent`), rather than sharing accent and quietly recreating
  // the exact "one color owns the whole screen" problem this whole recolor
  // was meant to fix, just with cyan instead of green. A cool indigo-blue
  // reads as "energy barrier / force field," a well-worn sci-fi convention
  // of its own (distinct from "targeting/informational" cyan).
  shieldHealthy: "#7c9eff",
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
  // Only Ship.tsx uses these now (shields moved to their own dedicated
  // colors above) — brightened a bit from #2a3230/#171c1a specifically
  // because the ship's hull surfaces were reading as near-black outside
  // the glowing canopy/engine parts: at the metalness those materials used
  // (0.6-0.8, i.e. mirror-like), a surface this dark barely picks up
  // ambient/diffuse light at all and depends on a precise specular
  // highlight to show anything — see Ship.tsx's own reduced metalness for
  // the other half of that fix.
  hull: "#3a4642",
  hullDark: "#212f2a",
  // Brightened for the same reason as hull/hullDark above — a dark surface
  // at moderate-high metalness reads as near-black outside a precise
  // specular highlight, leaving only the emissive eye/ring/turret glow
  // visible and the actual body shape unclear.
  enemyHull: "#3d2230",
  enemyHullDark: "#241220",
  // The Heavy variant (see ENEMY_VARIANTS.heavy): a cold steel-blue hull
  // and a saturated cobalt-blue glow, deliberately nothing like the warm
  // magenta-red/amber every other enemy uses, so it's recognizable from
  // across the whole formation at a glance — not just by its slightly
  // bigger silhouette, which direct feedback found too subtle to spot in
  // time. Reinforces the "armored/reinforced" read the bigger scale
  // already gives, on a genuinely different footing (color) rather than
  // stacking a second size-only cue. The accent was originally a pale,
  // near-white icy blue (#bfe4ff) — more feedback called that too bright/
  // washed-out against the rest of the game's saturated neon palette
  // (every other accent, amber/cyan/violet/gold, is a deep, fully-
  // saturated hue, never a pale tint) — this deeper cobalt matches that
  // same intensity while keeping the "cold blue vs. warm red" contrast
  // that's the actual disambiguating signal.
  enemyHeavyHull: "#2a3550",
  enemyHeavyHullDark: "#161b2c",
  enemyHeavyAccent: "#3d7dff",
  rimLight: "#6fa8ff",
  // Pickups: a third hue family, distinct from both the ship's green and the
  // enemies' magenta-red, so a drifting capsule reads as "neither of those"
  // at a glance. Both weapon kinds (spread/rapid) share one color — which
  // one you got is a HUD/banner detail, not something the pickup's own color
  // needs to carry.
  pickupHealth: "#48d1ff",
  pickupWeapon: "#c77dff",
  // The nova bomb (see PICKUP.bombShareOfDrops) is deliberately a THIRD
  // family again, not a variant of either existing pickup hue — a warm
  // gold reads as "rare/premium" and stands well apart from cyan
  // (informational), violet (buff) and the enemies' own magenta-red.
  pickupBomb: "#ffd76a",
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
  // Health fraction at/below which "in real danger" kicks in — drives both
  // the HUD health bar's own critical (amber) tint and the ship's own
  // critical-health warning pulse (see Scene.tsx), one shared value so the
  // two always agree. Was 0.25 — direct feedback called that too late
  // (nearly dead before any warning at all); 0.4 gives a real window to
  // react while it's still "getting dangerous," not "already almost over."
  criticalHealthPct: 0.4,
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
  // Nova bomb: a rare third kind, layered on top of the existing 50/50
  // health/weapon split rather than its own separate roll — this fraction
  // of an already-rolled drop is a bomb instead (so its overall odds per
  // kill are dropChance * bombShareOfDrops, roughly 0.7%). Collecting one
  // instantly detonates rather than being equipped: every alive regular
  // enemy dies outright (see Scene.tsx's triggerNovaBomb), and an active
  // boss takes a flat chunk of damage instead of being immune just because
  // it isn't a "regular enemy."
  bombShareOfDrops: 0.06,
  novaBossDamage: 8,
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

// A second enemy type for content variety within the ordinary grid, not
// just a formation-wide difficulty knob: a Heavy takes 2 hits instead of
// the regular grunt's 1, rendered visibly bigger (a real silhouette
// difference, not a color one — see Enemies.tsx's own comment on why a
// per-instance color was avoided) rather than a distinct model, so it
// still reads as "one of them" scaled up, the same relationship Boss.tsx
// has to a regular enemy. Scene.tsx computes the actual per-wave fraction
// (see waveDifficulty's own sibling for this, alongside it) — pure tuning
// data lives here, the formula lives with the rest of the wave-shaping
// logic.
export const ENEMY_VARIANTS = {
  heavy: {
    hp: 2,
    scale: 1.35,
    // Extra flat score on top of the normal combo-scored kill — same
    // "harder target, bigger reward" logic as DIVE.killBonus.
    killBonus: 60,
    // Wave 1 stays entirely Heavy-free (FORMATION's own comment: "wave 1 is
    // exactly the FORMATION baseline") — this fraction grows by this much
    // per wave after that, capped so even a very late wave never becomes
    // ALL Heavies.
    fractionGrowthPerWave: 0.06,
    maxFraction: 0.3,
  },
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
  advanceSpeedGrowth: 1.12, // x per wave, capped below
  fireIntervalShrink: 0.94, // x per wave, floored below
  minFireIntervalMin: 0.6,
  minFireIntervalMax: 1.2,
  // The fire-rate curve above already has a floor it settles into — the
  // advance-speed curve had no equivalent ceiling, so it kept compounding
  // exponentially forever (1.12^(wave-1): ~8x by wave 20, ~27x by wave 30).
  // Past a certain point that stops reading as "harder" and starts reading
  // as "the formation teleports to the front line the instant it spawns,"
  // which the proximity-based invasion check (HIT_RADIUS.enemyVsShip)
  // doesn't actually need to be survivable — capped at 4x the wave-1
  // baseline (reached around wave 13), late enough for the early/mid game
  // to keep escalating meaningfully, high enough that it's still a real
  // late-game gut check rather than a soft cap that undersells the
  // difficulty entirely.
  maxAdvanceSpeedMultiplier: 4,
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
  healthy: COLORS.shieldHealthy, // > 66% of this bunker's blocks remain
  damaged: "#e2a23f", // > 33% remain
  critical: "#ff4d4d", // <= 33% remain
};

// Enemy diving/flanking: periodically, one alive enemy breaks off from the
// formation's shared sway/advance and flies its own attack run at the ship
// before looping back to its slot — the "Diver/Flanker" behavior from
// docs/GAME_PLAN.md's original outline. Deliberately reuses existing
// systems rather than inventing new ones: a diver that actually reaches the
// ship costs a life through the exact same HIT_RADIUS.enemyVsShip proximity
// check the stationary formation already triggers, and its one attack shot
// is a normal pooled enemy bolt, just fired from wherever it actually is
// mid-dive instead of from a column's shared schedule.
export const DIVE = {
  // A global cooldown between dive LAUNCHES (not one per enemy) — keeps how
  // often "something is diving" reads consistently regardless of how many
  // enemies are left alive in the wave. Wave 1 baseline; Scene.tsx's own
  // waveDifficulty() shrinks this per wave the same way it already does
  // for enemy fire rate (see cooldownShrinkPerWave/minCooldownMin/Max
  // below) — divers were the one escalating system that stayed completely
  // flat regardless of wave number, which read as inconsistent once every
  // other system (advance speed, fire rate, Heavy fraction) kept ramping.
  cooldownMin: 4,
  cooldownMax: 7.5,
  cooldownShrinkPerWave: 0.94, // matches WAVE_SCALING.fireIntervalShrink
  minCooldownMin: 1.5,
  minCooldownMax: 3,
  // No diver in the first few seconds of a fresh wave (or right after a
  // life-loss push-back) — gives the player a moment to read the formation
  // before anything breaks off it.
  graceAfterWaveStart: 3,
  maxConcurrent: 2,
  duration: 3.2, // seconds for a full dive-out-and-return loop
  // How strongly the swoop pulls toward the ship's own position at the
  // midpoint (t = 0.5) — 1 would put it exactly on top of the ship; kept
  // just under so it reads as "swooping past," not a guaranteed collision.
  peakPull: 0.82,
  lateralWiggle: 1.3, // extra side-to-side flourish, purely cosmetic
  // Fires its one dedicated attack shot at the peak of the swoop (when it's
  // actually near the ship), not on the normal per-column schedule — see
  // Scene.tsx, which pulls a diving enemy out of its column's normal
  // rotation for exactly this reason.
  firePhase: 0.5,
  maxTilt: 0.55, // radians of nose-down pitch + bank — purely cosmetic
  // Extra score for downing an enemy mid-dive: exposed and moving fast, same
  // "harder target, bigger reward" logic as the combo multiplier.
  killBonus: 50,
};

// Boss waves: every BOSS.waveInterval-th wave replaces the normal grid
// formation entirely with one large, multi-hit enemy — the last item from
// docs/GAME_PLAN.md's Phase 2 outline. Deliberately reuses as much of the
// existing per-frame machinery as possible rather than building a parallel
// system: its barrage is just ordinary pooled enemy bolts (the existing
// "enemy bolts vs ship" loop needs no changes at all to handle them), and
// "the boss rammed the ship" reuses the exact same handleInvasion()
// life-loss path the regular formation's own proximity check already uses.
export const BOSS = {
  waveInterval: 5,
  // Hits to kill on its first appearance (wave 5); grows on every repeat
  // encounter (wave 10, 15, ...) the same escalating-difficulty way
  // WAVE_SCALING does for the ordinary formation. Shared by both variants
  // below — the fight's difficulty knob is health, not per-variant tuning.
  baseHealth: 24,
  healthGrowthPerEncounter: 10,
  // Stops noticeably further back than the regular formation's own
  // frontLineZ (-8) — a much bigger, slower target needs more runway for
  // its attacks to actually be dodgeable rather than instantly on top of
  // the ship the moment it arrives.
  frontLineZ: -16,
  // A visible "winding up" tell in the second before each attack — a
  // slow, ever-growing swell (see Scene.tsx's own use of this) rather than
  // the attack just appearing with zero warning, so dodging it is a real
  // read-and-react skill instead of a memorization/luck check.
  telegraphDuration: 0.45,
  telegraphPulse: 0.1,
  // Generously sized to its own visualScale below — a big target, meant to
  // be easy to land shots on (the challenge is surviving its attacks and
  // movement, not pixel-precise aim).
  hitRadius: 2.1,
  // "Rammed the ship" proximity — bigger than HIT_RADIUS.enemyVsShip to
  // match its much larger visual footprint, but frontLineZ above already
  // keeps this a rare edge case rather than the fight's main danger.
  contactRadius: 3,
  killScore: 800,
  visualScale: 4.2,
  // Two alternating variants (see Boss.tsx for their shared-model,
  // different-accent visual side of this) — odd encounters (wave 5, 15,
  // 25, ...) get the Sentinel, even ones (wave 10, 20, 30, ...) get the
  // Harrier. Genuinely different fights, not a reskinned health bar: the
  // Sentinel is a slower area-denial turret firing a wide barrage from
  // range; the Harrier moves faster and more erratically and fires a
  // single precision-aimed shot (spawned at the ship's own current
  // position rather than the boss's — see Scene.tsx) instead of a spread,
  // trading "dodge a wide pattern" for "dodge one accurate shot while
  // being harder to predict yourself."
  variants: {
    sentinel: {
      sweepSpeed: 3.2,
      advanceSpeed: 0.5,
      fireIntervalMin: 1.1,
      fireIntervalMax: 2,
      spreadCount: 5, // bolts per barrage, fanned across spreadWidth
      spreadWidth: 3.6,
      aimed: false,
    },
    harrier: {
      sweepSpeed: 5.5,
      advanceSpeed: 0.7,
      fireIntervalMin: 0.7,
      fireIntervalMax: 1.3,
      spreadCount: 1,
      spreadWidth: 0,
      aimed: true,
    },
  },
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

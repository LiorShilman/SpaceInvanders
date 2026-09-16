import { createRef, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ANOMALY,
  ARENA,
  BOSS,
  COLORS,
  DIVE,
  ENEMY_VARIANTS,
  FLANKER,
  FORMATION,
  GRENADE,
  HIT_RADIUS,
  PICKUP,
  PROJECTILE,
  SHIELD,
  SHIP,
  WAVE_ENTRANCE_DURATION,
  WAVE_SCALING,
  WEAPON,
  WEAKPOINT,
} from "../config/constants";
import { useGameStore, type WeaponKind } from "../state/gameStore";
import { sound } from "../audio/sound";
import { useInput } from "../hooks/useInput";
import { Ship } from "./Ship";
import { Enemies, type EnemiesHandle } from "./Enemies";
import { Boss, type BossVariant } from "./Boss";
import { Projectile } from "./Projectile";
import { EnemyBolt } from "./EnemyBolt";
import { Grenade } from "./Grenade";
import { Pickup } from "./Pickup";
import { Shields, type ShieldTierMeshes } from "./Shields";
import { Starfield } from "./Starfield";
import { Nebula } from "./Nebula";
import { Explosions, useExplosions } from "./Explosions";
import { AimLine, LockReticle, AIM_LINE_LENGTH } from "./Sight";
import { WeakPoint } from "./WeakPoint";
import { Anomaly } from "./Anomaly";

// How close (in x/y only, ignoring depth) an enemy needs to be to the ship's
// current firing lane before the lock reticle latches onto it. Must be <=
// HIT_RADIUS.playerProjectileVsEnemy — it was 1.0 against a 0.75 hit radius,
// so the reticle could show "locked on" in the 0.75-1.0 gap where shots
// fired right now would still whiff. A "locked" reticle should be a promise
// that firing this instant lands, not just "roughly lined up."
const LOCK_RADIUS = HIT_RADIUS.playerProjectileVsEnemy;

const ENEMY_COUNT = FORMATION.rows * FORMATION.cols;

/**
 * Grid layout, centered on the formation's local origin, flat in Z — see the
 * note on FORMATION in config/constants.ts for why. Not a rigid rectangle
 * either: alternating rows zigzag a quarter-column each way (symmetric, so
 * the bounding box doesn't grow — an earlier one-directional stagger pushed
 * odd rows further out than ARENA.halfWidth could ever reach) and every
 * enemy gets a small random nudge, so the wave reads as an organic swarm
 * rather than a spreadsheet.
 */
function buildFormationLayout(): [number, number, number][] {
  const layout: [number, number, number][] = [];
  const maxCol = (FORMATION.cols - 1) / 2;
  for (let row = 0; row < FORMATION.rows; row++) {
    const stagger = (row % 2 === 0 ? -1 : 1) * FORMATION.spacingX * 0.25;
    for (let col = 0; col < FORMATION.cols; col++) {
      // Capped low enough that two neighbors' worst-case combined jitter
      // can't close the gap to less than the enemy model's own ~1.8-unit
      // display diameter (see Enemy.tsx's 1.8x scale) — a wider jitter
      // range looked organic in isolation but let adjacent bodies overlap.
      const jitterX = (Math.random() - 0.5) * FORMATION.spacingX * 0.18;
      const jitterY = (Math.random() - 0.5) * FORMATION.spacingY * 0.18;
      const x = (col - maxCol) * FORMATION.spacingX + stagger + jitterX;
      const y = 2.4 + row * FORMATION.spacingY + jitterY;
      layout.push([x, y, 0]);
    }
  }
  return layout;
}

/**
 * Which grid slots actually hold an enemy for a given wave — the layout
 * positions above are always the same full rows x cols grid, but each wave
 * cycles through a different silhouette instead of always filling the whole
 * grid, so wave 2 doesn't look like wave 1 with a fresh coat of paint.
 * ENEMY_COUNT stays the fixed array/instance size; a mask just leaves some
 * slots permanently unused for that wave (their column simply never fires
 * from them — see the enemy-firing loop, already handles empty columns).
 */
type WaveShape = (row: number, col: number) => boolean;

const WAVE_SHAPES: WaveShape[] = [
  // Full block — the classic wave.
  () => true,
  // Wedge: a narrower point facing the ship (row 0), flaring out toward the
  // back rows — kept from getting too sparse overall (was 22/40; tuning
  // aims every shape at roughly 30-40 now, not 20-40, so the "harder wave,
  // fewer targets" contrast doesn't read as the wave getting easier).
  (row, col) => {
    const center = (FORMATION.cols - 1) / 2;
    const halfWidth = (row / (FORMATION.rows - 1)) * center * 0.6 + 1.8;
    return Math.abs(col - center) <= halfWidth;
  },
  // Diamond.
  (row, col) => {
    const centerRow = (FORMATION.rows - 1) / 2;
    const centerCol = (FORMATION.cols - 1) / 2;
    const dist = Math.abs(row - centerRow) / centerRow + Math.abs(col - centerCol) / centerCol;
    return dist <= 1.5;
  },
  // Twin clusters, split by a gap down the middle.
  (_row, col) => {
    const centerCol = (FORMATION.cols - 1) / 2;
    return Math.abs(col - centerCol) >= 1.1;
  },
  // Ring — a hollow center. Widened outward (not shrunk inward) to gain
  // enemies without losing the hole — a smaller inner radius on a 5-row
  // grid barely excludes anything and stops reading as a ring at all.
  (row, col) => {
    const centerRow = (FORMATION.rows - 1) / 2;
    const centerCol = (FORMATION.cols - 1) / 2;
    const dx = (col - centerCol) / centerCol;
    const dy = (row - centerRow) / centerRow;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist >= 0.5 && dist <= 1.3;
  },
];

/** Flat mask (indexed like layout: row*cols+col) for the given wave number. */
function buildWaveMask(wave: number): boolean[] {
  const shape = WAVE_SHAPES[(wave - 1) % WAVE_SHAPES.length];
  const mask: boolean[] = [];
  for (let row = 0; row < FORMATION.rows; row++) {
    for (let col = 0; col < FORMATION.cols; col++) {
      mask.push(shape(row, col));
    }
  }
  return mask;
}

/** Static world positions for every surviving shield block, across all
 * SHIELD.count bunkers — shields don't move, so unlike the formation this
 * doesn't need a parent group's transform applied at render time. */
function buildShieldLayout(): [number, number, number][] {
  const blocks: [number, number, number][] = [];
  const spacing = (ARENA.halfWidth * 2) / (SHIELD.count + 1);
  for (let s = 0; s < SHIELD.count; s++) {
    const shieldX = -ARENA.halfWidth + spacing * (s + 1);
    for (let row = 0; row < SHIELD.rows; row++) {
      for (let col = 0; col < SHIELD.cols; col++) {
        if (!SHIELD.pattern[row][col]) continue;
        const x = shieldX + (col - (SHIELD.cols - 1) / 2) * SHIELD.blockSize;
        const y = SHIELD.baseY + (SHIELD.rows - 1 - row) * SHIELD.blockSize;
        blocks.push([x, y, SHIELD.z]);
      }
    }
  }
  return blocks;
}

// Reused across calls — setMatrixAt only reads it synchronously, so one
// shared object avoids allocating a THREE.Object3D per shield hit/reset.
/**
 * Retints every part of the ship marked userData.shipAccent (wing strakes,
 * canopy glow, engine glow, the ship's own point light — see Ship.tsx) to
 * `hex`. Called whenever the held weapon changes, so a buff is visible on
 * the ship itself at a glance, not just in a HUD badge. Traversing the
 * whole ship is cheap here since this only runs on state changes (pickup
 * collected, buff expired, run reset), never per-frame.
 */
function setShipAccentColor(ship: THREE.Group, hex: string) {
  ship.traverse((obj) => {
    if (!obj.userData.shipAccent) return;
    if (obj instanceof THREE.Mesh) {
      const mat = obj.material as THREE.MeshStandardMaterial;
      mat.emissive.set(hex);
    } else if (obj instanceof THREE.PointLight) {
      obj.color.set(hex);
    }
  });
}

/**
 * Toggles WeakPoint.tsx's "aligned" halo — this runs every frame during a
 * boss fight (unlike setShipAccentColor above, which only fires on state
 * changes), so it's kept to a cheap visibility flip plus a scale write
 * rather than touching any material.
 */
function setWeakPointAligned(marker: THREE.Group, aligned: boolean, pulseT: number) {
  marker.traverse((obj) => {
    if (!obj.userData.weakAligned) return;
    obj.visible = aligned;
    if (aligned) obj.scale.setScalar(1 + Math.sin(pulseT * 10) * 0.15);
  });
}

/**
 * Nudges `pos` toward the active anomaly's `center` (see ANOMALY in
 * config/constants.ts) by `pullPerSec` scaled by how close `pos` already
 * is (stronger nearer the center, zero at/beyond pullRadius) — shared by
 * player/enemy bolts and any detached (diving/flanking) enemy position,
 * the only kinds of position this simple system ever needs to curve.
 * Mutates `pos` in place; returns true the instant it crosses into the
 * event horizon — the caller decides what "consumed" means for its own
 * kind (a bolt is destroyed, a detached enemy is killed).
 */
function applyAnomalyPull(pos: THREE.Vector3, center: THREE.Vector3, pullPerSec: number, delta: number): boolean {
  const dx = center.x - pos.x;
  const dy = center.y - pos.y;
  const dz = center.z - pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist >= ANOMALY.pullRadius) return false;
  if (dist <= ANOMALY.eventHorizon) return true;
  const strength = (1 - dist / ANOMALY.pullRadius) * pullPerSec * delta;
  pos.x += (dx / dist) * strength;
  pos.y += (dy / dist) * strength;
  pos.z += (dz / dist) * strength;
  return false;
}

const _shieldDummy = new THREE.Object3D();

/** Shows or hides one shield instance (destroyed blocks scale to zero —
 * instancedMesh has no per-instance visibility flag). `rotation` gives each
 * block its own fixed tilt so the wall doesn't read as a uniform grid of
 * identical crystals; irrelevant (and omittable) when hiding. Caller must
 * set `mesh.instanceMatrix.needsUpdate = true` after a batch of these. */
function setShieldInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  pos: [number, number, number] | null,
  rotation?: [number, number, number],
) {
  if (pos) {
    _shieldDummy.position.set(pos[0], pos[1], pos[2]);
    _shieldDummy.rotation.set(rotation?.[0] ?? 0, rotation?.[1] ?? 0, rotation?.[2] ?? 0);
    _shieldDummy.scale.set(1, 1, 1);
  } else {
    _shieldDummy.position.set(0, 0, 0);
    _shieldDummy.rotation.set(0, 0, 0);
    _shieldDummy.scale.set(0, 0, 0);
  }
  _shieldDummy.updateMatrix();
  mesh.setMatrixAt(i, _shieldDummy.matrix);
}

// Tier index: 0 = healthy (> 66% of a bunker's blocks remain), 1 = damaged
// (> 33%), 2 = critical (<= 33%) — matches the mesh order returned by
// <Shields>'s ShieldTierMeshes (healthy/damaged/critical).
function shieldTierForFraction(fraction: number): 0 | 1 | 2 {
  if (fraction > 0.66) return 0;
  if (fraction > 0.33) return 1;
  return 2;
}

/** "Back out" easing: overshoots slightly past 1 before settling exactly at
 * 1 when t=1 — used for the wave/boss entrance scale-in (see
 * WAVE_ENTRANCE_DURATION) so a fresh wave reads as physically "snapping
 * into place" rather than a flat linear or ease-out grow. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Per-wave difficulty: wave 1 is exactly the FORMATION baseline. */
function waveDifficulty(wave: number) {
  const growth = Math.min(
    WAVE_SCALING.maxAdvanceSpeedMultiplier,
    Math.pow(WAVE_SCALING.advanceSpeedGrowth, wave - 1),
  );
  const shrink = Math.pow(WAVE_SCALING.fireIntervalShrink, wave - 1);
  const diveShrink = Math.pow(DIVE.cooldownShrinkPerWave, wave - 1);
  return {
    advanceSpeed: FORMATION.advanceSpeed * growth,
    fireMin: Math.max(WAVE_SCALING.minFireIntervalMin, FORMATION.enemyFireIntervalMin * shrink),
    fireMax: Math.max(WAVE_SCALING.minFireIntervalMax, FORMATION.enemyFireIntervalMax * shrink),
    // Divers launch more often at higher waves, same escalating-difficulty
    // spirit as the fire-rate shrink above — was flat regardless of wave
    // number, which read as inconsistent once every other system here
    // kept ramping.
    diveCooldownMin: Math.max(DIVE.minCooldownMin, DIVE.cooldownMin * diveShrink),
    diveCooldownMax: Math.max(DIVE.minCooldownMax, DIVE.cooldownMax * diveShrink),
  };
}

interface Pool {
  // Object3D, not Mesh — the player's Projectile forwards a <mesh>, but the
  // enemy's bolt (see EnemyBolt.tsx) is a small <group> of two meshes for a
  // richer plasma-glob look. Both are Object3Ds; nothing in this pool's own
  // movement/collision code needs anything Mesh-specific (no material
  // access here).
  refs: React.RefObject<THREE.Object3D | null>[];
  active: boolean[];
  dir: number; // +1 (toward player) or -1 (toward formation)
  speed: number;
}

function makePool(size: number, dir: number, speed: number): Pool {
  return {
    refs: Array.from({ length: size }, () => createRef<THREE.Object3D>()),
    active: Array.from({ length: size }, () => false),
    dir,
    speed,
  };
}

function spawn(pool: Pool, position: THREE.Vector3) {
  const i = pool.active.indexOf(false);
  if (i === -1) return; // pool exhausted — drop the shot rather than grow at runtime
  const mesh = pool.refs[i].current;
  if (!mesh) return;
  pool.active[i] = true;
  mesh.visible = true;
  mesh.position.copy(position);
}

type PickupKind = "health" | "weapon" | "bomb";
type PickupSlot = {
  // The root of a <Pickup> group, which contains all three visual variants
  // as named children — see Pickup.tsx. Not a single mesh: a pooled slot is
  // reused across kinds, and telling them apart by shape (not just color)
  // needed real, differently-shaped children to toggle between.
  ref: React.RefObject<THREE.Group | null>;
  active: boolean;
  kind: PickupKind;
  weaponKind: WeaponKind; // only meaningful when kind === "weapon"
  age: number;
};

// A handful of concurrent capsules is generous — dropChance is 12% per
// kill, and each despawns within PICKUP.lifetime seconds either way.
const PICKUP_POOL_SIZE = 8;

function makePickupPool(size: number): PickupSlot[] {
  return Array.from({ length: size }, () => ({
    ref: createRef<THREE.Group>(),
    active: false,
    kind: "health" as PickupKind,
    weaponKind: "base" as WeaponKind,
    age: 0,
  }));
}

export function Scene() {
  const input = useInput();
  const { camera } = useThree();

  const shipRef = useRef<THREE.Group>(null);
  const formationRef = useRef<THREE.Group>(null);
  const aimLineRef = useRef<THREE.Mesh>(null);
  const lockReticleRef = useRef<THREE.Group>(null);
  const explosions = useExplosions();
  const enemiesRef = useRef<EnemiesHandle>(null);
  const layout = useMemo(buildFormationLayout, []);

  const shieldLayout = useMemo(buildShieldLayout, []);
  // One fixed random tilt per block, generated once — see setShieldInstance.
  const shieldRotations = useMemo(
    () =>
      shieldLayout.map(
        () => [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI] as [number, number, number],
      ),
    [shieldLayout],
  );
  const shieldMeshRef = useRef<ShieldTierMeshes>(null);
  const shieldAlive = useRef<boolean[]>(Array.from({ length: shieldLayout.length }, () => true));
  // Which of the 3 tier meshes each block currently lives in (0/1/2 =
  // healthy/damaged/critical) — needed to know where to hide it when it
  // dies or moves to a different tier (see moveShieldBlockToTier).
  const shieldBlockTier = useRef<number[]>(Array.from({ length: shieldLayout.length }, () => 0));
  const blocksPerShield = shieldLayout.length / SHIELD.count;
  // Remaining alive-block count per bunker — drives that bunker's tier
  // independently of every other bunker.
  const shieldBunkerAlive = useRef<number[]>(Array.from({ length: SHIELD.count }, () => blocksPerShield));

  const enemyAlive = useRef<boolean[]>(Array.from({ length: ENEMY_COUNT }, () => true));
  // Hits remaining before death — 1 for an ordinary grunt, ENEMY_VARIANTS.
  // heavy.hp for a Heavy (see enemyIsHeavy). Only meaningful while
  // enemyAlive is true for that slot; spawnWave resets both together.
  const enemyHealth = useRef<number[]>(Array.from({ length: ENEMY_COUNT }, () => 1));
  const enemyIsHeavy = useRef<boolean[]>(Array.from({ length: ENEMY_COUNT }, () => false));
  // A Heavy that's taken a non-lethal hit (down to its last hit point) —
  // blinked every frame in the per-enemy visibility loop below so a chip
  // reads as a persistent, ongoing "this one is wounded" state instead of
  // just a one-off spark that's easy to miss mid-fight. Meaningless for a
  // regular one-hit grunt (nothing ever survives a hit to reach this).
  const enemyChipped = useRef<boolean[]>(Array.from({ length: ENEMY_COUNT }, () => false));
  // At most one shooter per column at a time (a random alive enemy in that
  // column, picked fresh each time) — one timer per column, not per enemy,
  // so at most FORMATION.cols shots are ever in the air from the wave at
  // once instead of up to ENEMY_COUNT independent emitters firing in an
  // unreadable blur.
  const columnNextFire = useRef<number[]>(Array.from({ length: FORMATION.cols }, () => 0));
  const aliveCount = useRef(ENEMY_COUNT);

  // Diving/flanking (see DIVE in config/constants.ts): diveState tracks
  // which enemies are currently mid-dive and their own launch data;
  // diveWorldPos mirrors just the CURRENT frame's computed world position
  // for whichever of those are active, null otherwise — every other spot
  // that needs an enemy's world position (invasion check, lock reticle,
  // player-bolt hit-test) reads this first and only falls back to the
  // ordinary formation-relative math when it's null. nextDiveAt is a single
  // global cooldown gate, not one per enemy.
  const diveState = useRef<
    Array<{ startTime: number; startPos: THREE.Vector3; lateralSign: 1 | -1; fired: boolean } | null>
  >(Array.from({ length: ENEMY_COUNT }, () => null));
  const diveWorldPos = useRef<Array<THREE.Vector3 | null>>(Array.from({ length: ENEMY_COUNT }, () => null));
  const nextDiveAt = useRef(DIVE.graceAfterWaveStart);

  // Flanking (see FLANKER in config/constants.ts) — the other half of
  // "Diver/Flanker," a materially different attack shape from a dive, not
  // a reskin of it: same overall ref pattern (state + a mirrored current
  // world position + a single global cooldown gate), kept as its own
  // fully separate set of refs rather than merged into the dive ones,
  // since an enemy is never doing both at once and the two have unrelated
  // durations/geometry.
  const flankState = useRef<
    Array<{ startTime: number; startPos: THREE.Vector3; side: 1 | -1; fired: boolean } | null>
  >(Array.from({ length: ENEMY_COUNT }, () => null));
  const flankWorldPos = useRef<Array<THREE.Vector3 | null>>(Array.from({ length: ENEMY_COUNT }, () => null));
  const nextFlankAt = useRef(FLANKER.graceAfterWaveStart);
  // Radar (see gameStore's radarBlips): throttled to ~12Hz rather than
  // updated every frame — see radarBlips' own comment for why. Scratch
  // Frustum/Matrix4 reused every tick instead of allocated fresh.
  const radarUpdateAccum = useRef(0);
  const radarFrustum = useRef(new THREE.Frustum());
  const radarProjScreenMatrix = useRef(new THREE.Matrix4());

  // Boss waves (see BOSS in config/constants.ts): every BOSS.waveInterval-th
  // wave replaces the normal grid entirely with this one large, multi-hit
  // enemy. These refs are the simulation's own source of truth — bossActive/
  // bossHealth/bossMaxHealth are mirrored into the store purely so HUD can
  // render a health bar, the same split as every other ref-vs-store value
  // in this file (e.g. aliveCount vs. enemiesRemaining).
  const bossRef = useRef<THREE.Group>(null);
  const bossActive = useRef(false);
  const bossHealth = useRef(0);
  const bossNextFireAt = useRef(0);
  const bossSweepDir = useRef<1 | -1>(1);
  // Which of BOSS.variants is fighting (see its own comment in
  // constants.ts) — a ref for the simulation's own per-frame movement/fire
  // logic (needs to be authoritative the instant a new boss spawns, with
  // zero React-render lag), mirrored into bossVariantVisual purely to
  // drive the <Boss variant={...}> prop, the same ref-vs-state split
  // bossHealth/bossActive already have with the store.
  const bossVariant = useRef<BossVariant>("sentinel");
  const [bossVariantVisual, setBossVariantVisual] = useState<BossVariant>("sentinel");
  // A short, sharp "recoil" scale-pop on every landed hit — distinct pacing
  // from the slow telegraph swell above (this decays over ~0.15s instead of
  // building over ~0.45s), giving a hit on the boss the same kind of
  // tactile "that connected" feedback a regular enemy's own explosion+kill
  // already has, which chipping away at one big health pool otherwise
  // lacks entirely. Simtime-based, like bossNextFireAt — 0 means inactive.
  const bossHitFlashUntil = useRef(0);

  // The boss's rotating flank (see WEAKPOINT in config/constants.ts).
  // weakPointRef is the standalone marker's own transform (positioned each
  // frame alongside the boss's own movement below); bossWeakAligned is
  // this frame's answer to "is the ship currently inside the vulnerable
  // arc" — computed once per frame in the boss block and read later the
  // same frame by every place that applies player damage to the boss
  // (ordinary bolts, the grenade), so they never compute it independently
  // or risk drifting out of sync with each other.
  const weakPointRef = useRef<THREE.Group>(null);
  const bossWeakAligned = useRef(false);
  // Edge-detected mirror into the store (see setBossWeak) — only written
  // on an actual flip, not every frame, so a boss fight doesn't re-render
  // the whole HUD 60x/sec for a value that's usually unchanged frame to
  // frame (same reasoning radarBlips' own throttling comment gives).
  const bossWeakAlignedStored = useRef(false);

  // The gravity anomaly (see ANOMALY in config/constants.ts). Its own
  // position IS anomalyRef.current.position — no separate shadow copy,
  // same as Boss/Ship (a single object needs no detached-position array).
  const anomalyRef = useRef<THREE.Group>(null);
  const anomalyActive = useRef(false);
  const nextAnomalyAt = useRef(ANOMALY.graceAfterWaveStart);
  const anomalySpawnedAt = useRef(0); // simTime it appeared — drives the entrance grow-in
  const anomalyUntil = useRef(0); // simTime it despawns at — drives the shrink-out
  // Contact damage applies once per appearance (then a hard knockback
  // keeps the ship from sitting inside it), not every frame it happens to
  // be within the event horizon.
  const anomalyShipHit = useRef(false);

  // Camera shake: a decaying "trauma" scalar (0..1, see addShake) rather
  // than a one-shot animation — several hits landing close together should
  // compound into a bigger shake, not restart a fixed-length effect from
  // scratch each time. camShakeOffset is the actual position displacement
  // applied last frame, subtracted back out at the start of the next one —
  // camera.position is otherwise the smooth chase-camera's own lerp
  // accumulator (see the camera block at the bottom of useFrame), and
  // without undoing it first, each frame's shake would permanently drift
  // that accumulator instead of just wobbling the visible result.
  const camShake = useRef(0);
  const camShakeOffset = useRef(new THREE.Vector3());

  /** Adds to the current shake trauma (capped at 1) — bigger events (a lost
   * life, a defeated boss) pass a bigger amount than a glancing hit. */
  function addShake(amount: number) {
    camShake.current = Math.min(1, camShake.current + amount);
  }

  // A brief white flash on the ship's own accent parts (see setShipAccentColor)
  // when a glancing hit costs health but not a whole life — the one damage
  // outcome that otherwise left the ship completely visually unchanged (a
  // lost life already gets the much stronger respawn-invulnerability blink;
  // this fills the gap below that). 0 = no flash in progress; otherwise a
  // wall-clock deadline to revert back to whatever accent color SHOULD be
  // showing (base phosphor, or the active weapon's tint).
  const hitFlashUntil = useRef(0);

  /** Triggers the brief white hit-flash (see hitFlashUntil's own comment). */
  function addHitFlash(ship: THREE.Group, now: number) {
    hitFlashUntil.current = now + 120;
    setShipAccentColor(ship, "#ffffff");
  }

  /** Whichever accent color should be showing right now absent any
   * transient effect (hit-flash, critical pulse) — base phosphor, or the
   * current weapon buff's tint. Shared by every place that needs to revert
   * back to "normal" rather than duplicating the same ternary. */
  function baseAccentColor(): string {
    return weaponRef.current.kind === "base" ? COLORS.phosphor : COLORS.pickupWeapon;
  }

  // Tracks whether the critical-health pulse (below) was active last frame,
  // purely so health recovering back out of critical (a health pickup, a
  // fresh respawn) reverts the accent exactly once instead of leaving it
  // stuck on whatever shade the pulse last landed on.
  const wasCritical = useRef(false);

  // Hitstop ("bullet time"): the whole simulation crawls to near-standstill
  // for a brief wall-clock window — reserved for the single biggest,
  // rarest moment in a run (defeating a boss) rather than every hit, so it
  // reads as "that mattered" instead of constantly interrupting a
  // fast-paced shooter's own flow. Scaling `delta` itself (see its
  // computation at the top of useFrame) is deliberately the ONE place this
  // is implemented — every system already reads delta for its own
  // per-frame movement, so slowing it down there automatically slows
  // everything (ship, bolts, the boss's own explosion, even the camera
  // shake this same moment also triggers) without needing to touch any of
  // those systems individually.
  const hitstopUntil = useRef(0);

  const playerBolts = useRef<Pool>(makePool(PROJECTILE.poolSize, -1, PROJECTILE.playerSpeed));
  const enemyBolts = useRef<Pool>(makePool(PROJECTILE.poolSize, 1, PROJECTILE.enemySpeed));
  const pickups = useRef<PickupSlot[]>(makePickupPool(PICKUP_POOL_SIZE));

  // The player's own grenade throw (see GRENADE in config/constants.ts) —
  // reuses the same Pool/spawn machinery as the bolt pools above (it's
  // still just "a thing that flies in a straight line and gets culled
  // eventually"), but grenadeLaunchZ tracks each active slot's own launch
  // depth separately, since a grenade needs to know how far IT SPECIFICALLY
  // has traveled to detonate on its own fuse (GRENADE.maxRange) — the
  // ordinary bolt pools only ever cull relative to a fixed world position,
  // never "distance since this one was fired."
  const grenadePool = useRef<Pool>(makePool(GRENADE.poolSize, -1, GRENADE.speed));
  const grenadeLaunchZ = useRef<number[]>(Array.from({ length: GRENADE.poolSize }, () => 0));
  const grenadeCooldown = useRef(0);

  // The currently-held weapon and when it expires — mirrored into the store
  // (see collectWeapon/revertWeapon) purely so the HUD can display it;
  // Scene's own firing logic reads this ref, not the store, every frame.
  const weaponRef = useRef<{ kind: WeaponKind; expiresAt: number }>({ kind: "base", expiresAt: 0 });

  const fireCooldown = useRef(0);
  const simTime = useRef(0);
  // simTime-based deadline for the wave-entrance scale-in (see
  // WAVE_ENTRANCE_DURATION and easeOutBack) — set by spawnWave, read every
  // frame until it elapses. Only a fresh spawnWave triggers this, not the
  // life-loss push-back reset (that's the same wave's own enemies just
  // repositioned back to start, not new content arriving).
  const waveEntranceUntil = useRef(0);
  const prevStatus = useRef<string | null>(null);
  // Recomputed by spawnWave() each wave — read by the sway/advance formula
  // and the enemy-fire scheduler instead of the raw FORMATION constants, so
  // later waves genuinely escalate (see WAVE_SCALING).
  const currentDifficulty = useRef(waveDifficulty(1));

  /** Full run reset: called on first mount and whenever "שחק שוב" follows a
   * game over. Resets the ship and the score/health/wave in the store —
   * spawnWave (below) handles everything wave-specific. */
  function resetRun(ship: THREE.Group, formation: THREE.Group) {
    ship.position.set(0, (ARENA.minY + ARENA.maxY) / 2, ARENA.shipZ);
    ship.rotation.set(0, 0, 0);
    weaponRef.current = { kind: "base", expiresAt: 0 };
    setShipAccentColor(ship, COLORS.phosphor);
    hitFlashUntil.current = 0;
    wasCritical.current = false;
    useGameStore.getState().reset();
    spawnWave(formation, 1);
  }

  /**
   * Arms one wave: a fresh enemy grid, shields repaired, ammo cleared, and
   * difficulty scaled to `wave`. Called for wave 1 by resetRun above, and
   * again — without touching the ship, score or health — every time the
   * player clears a wave (see the player-bolt hit-test below). This is the
   * one thing that was missing for the game to not just stop after a single
   * wave: beating it now escalates into the next one instead of ending.
   */
  function spawnWave(formation: THREE.Group, wave: number) {
    formation.position.set(0, 0, FORMATION.startZ);
    currentDifficulty.current = waveDifficulty(wave);

    if (wave >= 10) useGameStore.getState().unlockAchievement("wave_10");
    if (wave >= 20) useGameStore.getState().unlockAchievement("wave_20");

    // A boss wave (see BOSS.waveInterval) replaces the grid entirely — an
    // all-false mask reuses the exact same per-slot hide loop below instead
    // of a separate code path, so every regular-enemy system (column fire,
    // diving, the small-enemy hit-test) naturally does nothing this wave
    // simply because enemyAlive is false everywhere, with no extra
    // conditions needed in any of those loops.
    const isBossWave = wave % BOSS.waveInterval === 0;
    const mask = isBossWave ? Array<boolean>(ENEMY_COUNT).fill(false) : buildWaveMask(wave);

    // Heavy variant selection (see ENEMY_VARIANTS.heavy): a random subset of
    // this wave's alive slots, sized by a fraction that grows with wave
    // number. None during a boss wave — mask is all-false, so aliveIndices
    // ends up empty and heavyTarget is 0.
    const heavyFraction = Math.min(
      ENEMY_VARIANTS.heavy.maxFraction,
      Math.max(0, (wave - 1) * ENEMY_VARIANTS.heavy.fractionGrowthPerWave),
    );
    const aliveIndices: number[] = [];
    for (let i = 0; i < ENEMY_COUNT; i++) if (mask[i]) aliveIndices.push(i);
    const heavyTarget = Math.round(aliveIndices.length * heavyFraction);
    // Fisher-Yates on a copy, then take the front heavyTarget — unbiased,
    // and simple enough for a ~40-item array with no need for anything
    // fancier.
    for (let i = aliveIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [aliveIndices[i], aliveIndices[j]] = [aliveIndices[j], aliveIndices[i]];
    }
    const heavySet = new Set(aliveIndices.slice(0, heavyTarget));

    let waveCount = 0;
    for (let i = 0; i < ENEMY_COUNT; i++) {
      enemyAlive.current[i] = mask[i];
      const isHeavy = mask[i] && heavySet.has(i);
      enemyIsHeavy.current[i] = isHeavy;
      enemyHealth.current[i] = mask[i] ? (isHeavy ? ENEMY_VARIANTS.heavy.hp : 1) : 0;
      enemyChipped.current[i] = false;
      enemiesRef.current?.setEnemy(
        i,
        mask[i] ? layout[i] : null,
        undefined,
        isHeavy ? ENEMY_VARIANTS.heavy.scale : 1,
        isHeavy,
      );
      if (mask[i]) waveCount++;
    }
    aliveCount.current = waveCount;
    useGameStore.getState().setEnemiesRemaining(waveCount);

    // Every tier mesh is sized to the FULL block count (see Shields.tsx),
    // but a block only ever explicitly occupies one tier at a time —
    // moveShieldBlockToTier only ever touches the tier a block is
    // LEAVING, so on this very first setup (nothing has "left" anything
    // yet) the damaged/critical meshes' matching indices are never
    // touched at all. InstancedMesh does NOT default uninitialized
    // instances to hidden — an untouched instanceMatrix is all zeros,
    // which is a degenerate transform, not a scaled-to-nothing one, and
    // rendered as a small stray artifact rather than nothing. Explicitly
    // clearing every index in the OTHER two tiers here (not just relying
    // on the diff-based mover) guarantees every instance in every tier
    // mesh has a real, defined transform before anything ever renders.
    const tiers = shieldMeshRef.current;
    for (let i = 0; i < shieldLayout.length; i++) {
      shieldAlive.current[i] = true;
      shieldBlockTier.current[i] = 0;
      if (tiers) {
        if (tiers.damaged) setShieldInstance(tiers.damaged, i, null);
        if (tiers.critical) setShieldInstance(tiers.critical, i, null);
        if (tiers.healthy) setShieldInstance(tiers.healthy, i, shieldLayout[i], shieldRotations[i]);
      }
    }
    if (tiers) {
      if (tiers.healthy) tiers.healthy.instanceMatrix.needsUpdate = true;
      if (tiers.damaged) tiers.damaged.instanceMatrix.needsUpdate = true;
      if (tiers.critical) tiers.critical.instanceMatrix.needsUpdate = true;
    }
    for (let b = 0; b < SHIELD.count; b++) {
      shieldBunkerAlive.current[b] = blocksPerShield;
    }

    const { fireMin, fireMax } = currentDifficulty.current;
    for (let col = 0; col < FORMATION.cols; col++) {
      columnNextFire.current[col] = fireMin + Math.random() * (fireMax - fireMin);
    }

    for (const pool of [playerBolts.current, enemyBolts.current]) {
      for (let i = 0; i < pool.refs.length; i++) {
        pool.active[i] = false;
        const mesh = pool.refs[i].current;
        if (mesh) mesh.visible = false;
      }
    }

    // A carried-over weapon pickup is deliberately NOT cleared here (only in
    // resetRun) — a timed weapon should span a wave clear, not evaporate the
    // instant the next wave spawns. Leftover capsules, on the other hand,
    // don't belong to any particular wave and are just cleared out.
    for (const slot of pickups.current) {
      slot.active = false;
      const mesh = slot.ref.current;
      if (mesh) mesh.visible = false;
    }

    fireCooldown.current = 0;
    simTime.current = 0;
    waveEntranceUntil.current = WAVE_ENTRANCE_DURATION;

    // Every enemy's transform was just explicitly set above (alive or
    // hidden) regardless of whatever it was doing in the previous wave, so
    // no extra setEnemy call is needed here — just the bookkeeping, plus a
    // fresh grace period before the new wave's first diver can launch.
    for (let e = 0; e < ENEMY_COUNT; e++) {
      diveState.current[e] = null;
      diveWorldPos.current[e] = null;
      flankState.current[e] = null;
      flankWorldPos.current[e] = null;
    }
    nextDiveAt.current = DIVE.graceAfterWaveStart + Math.random() * (DIVE.cooldownMax - DIVE.cooldownMin);
    nextFlankAt.current = FLANKER.graceAfterWaveStart + Math.random() * (FLANKER.cooldownMax - FLANKER.cooldownMin);
    nextAnomalyAt.current = ANOMALY.graceAfterWaveStart + Math.random() * (ANOMALY.cooldownMax - ANOMALY.cooldownMin);

    if (isBossWave) {
      // The anomaly is a normal-wave-only hazard (see ANOMALY's own
      // comment) — piling its pull on top of the weak-point mechanic and
      // the boss's own barrage would be overwhelming, not "more wow." Any
      // instance still running from the previous wave ends immediately.
      if (anomalyRef.current) anomalyRef.current.visible = false;
      anomalyActive.current = false;
      // Health grows on every repeat encounter (wave 10, 15, ...), same
      // escalating-difficulty spirit as WAVE_SCALING for the ordinary
      // formation — encounterNumber is 1 the first time (wave 5), 2 the
      // second (wave 10), etc.
      const encounterNumber = wave / BOSS.waveInterval;
      const maxHealth = BOSS.baseHealth + (encounterNumber - 1) * BOSS.healthGrowthPerEncounter;
      // Alternates every encounter — see BOSS.variants' own comment for
      // why these are genuinely different fights, not a reskin.
      const variantName: BossVariant = encounterNumber % 2 === 0 ? "harrier" : "sentinel";
      const variant = BOSS.variants[variantName];
      bossVariant.current = variantName;
      setBossVariantVisual(variantName);
      bossActive.current = true;
      bossHealth.current = maxHealth;
      bossHitFlashUntil.current = 0;
      bossSweepDir.current = Math.random() < 0.5 ? -1 : 1;
      // Scheduled the same way columnNextFire is just above: a raw value,
      // implicitly relative to the simTime.current = 0 this function just
      // set.
      bossNextFireAt.current = variant.fireIntervalMin + Math.random() * (variant.fireIntervalMax - variant.fireIntervalMin);
      if (bossRef.current) {
        bossRef.current.visible = true;
        bossRef.current.scale.setScalar(BOSS.visualScale);
        bossRef.current.rotation.set(0, 0, 0);
        bossRef.current.position.set(0, (ARENA.minY + ARENA.maxY) / 2, FORMATION.startZ);
      }
      if (weakPointRef.current) weakPointRef.current.visible = true;
      bossWeakAligned.current = false;
      bossWeakAlignedStored.current = false;
      useGameStore.getState().setBoss(true, maxHealth, maxHealth);
      useGameStore.getState().setBossWeak(false);
    } else {
      bossActive.current = false;
      if (bossRef.current) bossRef.current.visible = false;
      if (weakPointRef.current) weakPointRef.current.visible = false;
      bossWeakAligned.current = false;
      bossWeakAlignedStored.current = false;
      useGameStore.getState().setBoss(false, 0, 0);
      useGameStore.getState().setBossWeak(false);
    }
  }

  /**
   * Moves block `i` into tier mesh `newTier` (0/1/2 = healthy/damaged/
   * critical, matching ShieldTierMeshes' order) — hidden (scaled to zero)
   * in whichever tier it's leaving, shown with its real transform in the
   * one it's entering. Also used to just (re-)show a block in its current
   * tier (oldTier === newTier is a harmless no-op on the "leaving" side).
   */
  function moveShieldBlockToTier(i: number, newTier: number) {
    const tiers = shieldMeshRef.current;
    if (!tiers) return;
    const tierMeshes = [tiers.healthy, tiers.damaged, tiers.critical];
    const oldTier = shieldBlockTier.current[i];
    if (oldTier !== newTier) {
      const oldMesh = tierMeshes[oldTier];
      if (oldMesh) {
        setShieldInstance(oldMesh, i, null);
        oldMesh.instanceMatrix.needsUpdate = true;
      }
    }
    const newMesh = tierMeshes[newTier];
    if (newMesh) {
      setShieldInstance(newMesh, i, shieldLayout[i], shieldRotations[i]);
      newMesh.instanceMatrix.needsUpdate = true;
    }
    shieldBlockTier.current[i] = newTier;
  }

  /** Hides block `i` (destroyed) in whichever tier mesh it currently lives in. */
  function hideShieldBlock(i: number) {
    const tiers = shieldMeshRef.current;
    if (!tiers) return;
    const tierMeshes = [tiers.healthy, tiers.damaged, tiers.critical];
    const mesh = tierMeshes[shieldBlockTier.current[i]];
    if (mesh) {
      setShieldInstance(mesh, i, null);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Absorbs a shot — from either side, same as the arcade original — into
   * whichever alive shield block it's touching. Returns true (and consumes
   * that block) on a hit, so the caller knows to stop the bolt there instead
   * of letting it continue toward the ship or the wave.
   */
  function tryHitShield(x: number, y: number, z: number): boolean {
    if (!shieldMeshRef.current) return false;
    for (let i = 0; i < shieldLayout.length; i++) {
      if (!shieldAlive.current[i]) continue;
      const [bx, by, bz] = shieldLayout[i];
      const dx = x - bx;
      const dy = y - by;
      const dz = z - bz;
      if (dx * dx + dy * dy + dz * dz <= SHIELD.hitRadius ** 2) {
        shieldAlive.current[i] = false;
        hideShieldBlock(i);

        // A hit changes the WHOLE bunker's tier (by its new remaining
        // fraction), not just the block that got hit — every other
        // still-alive block in this bunker needs to move tiers with it.
        const bunkerIndex = Math.floor(i / blocksPerShield);
        shieldBunkerAlive.current[bunkerIndex] -= 1;
        const fraction = shieldBunkerAlive.current[bunkerIndex] / blocksPerShield;
        const tier = shieldTierForFraction(fraction);
        const start = bunkerIndex * blocksPerShield;
        for (let j = start; j < start + blocksPerShield; j++) {
          if (!shieldAlive.current[j]) continue;
          moveShieldBlockToTier(j, tier);
        }

        sound.shieldHit();
        return true;
      }
    }
    return false;
  }

  /**
   * Rolls PICKUP.dropChance at an enemy's death position — most kills drop
   * nothing. When one does, it's a rare nova bomb (see PICKUP.
   * bombShareOfDrops) or, far more often, health (restore some) or a
   * weapon crate (spread or rapid, picked at random), 50/50 either way.
   */
  function spawnPickup(position: THREE.Vector3) {
    if (Math.random() >= PICKUP.dropChance) return;
    const slot = pickups.current.find((p) => !p.active);
    const group = slot?.ref.current;
    if (!slot || !group) return;

    slot.active = true;
    slot.age = 0;
    if (Math.random() < PICKUP.bombShareOfDrops) {
      slot.kind = "bomb";
    } else if (Math.random() < 0.5) {
      slot.kind = "health";
    } else {
      slot.kind = "weapon";
      slot.weaponKind = Math.random() < 0.5 ? "spread" : "rapid";
    }

    group.visible = true;
    group.position.copy(position);
    group.scale.setScalar(PICKUP.visualScale);
    // All three variants live under the same pooled group (see Pickup.tsx)
    // — toggle which one shows rather than mutating a shared material
    // color, since they differ in actual shape, not just tint.
    const healthVisual = group.getObjectByName("health-visual");
    const weaponVisual = group.getObjectByName("weapon-visual");
    const bombVisual = group.getObjectByName("bomb-visual");
    if (healthVisual) healthVisual.visible = slot.kind === "health";
    if (weaponVisual) weaponVisual.visible = slot.kind === "weapon";
    if (bombVisual) bombVisual.visible = slot.kind === "bomb";
  }

  /**
   * Applies one player-bolt hit to alive enemy `e` — factored out of the
   * live per-frame hit-test loop so a dev-only debug hook
   * (window.__nexusDebug.applyPlayerHitDebug) can call the exact same
   * logic directly. That hook exists because manually placing a bolt and
   * waiting a frame for the live 3D collision to land is unreliable in
   * this project's own headless-testing environment — the bolt's own
   * per-frame movement (up to ~0.7 units at PROJECTILE.playerSpeed) can
   * carry it back out of HIT_RADIUS.playerProjectileVsEnemy within the
   * same frame it was placed, on top of clamped-but-still-coarse frame
   * deltas under software rendering. See tryHitShieldDebug for the same
   * pattern already used for shields.
   *
   * A non-lethal hit on a Heavy (see ENEMY_VARIANTS.heavy) just chips it —
   * no kill, no score, no pickup roll, no alive-count change, and its
   * transform is untouched since only its health changed. Anything else
   * dies outright, exactly as every enemy always has. `forceLethal` and
   * `noDrop` exist solely for the nova bomb (see triggerNovaBomb), which
   * needs every hit to be a kill regardless of remaining Heavy health, and
   * needs kills not to roll further pickup drops of their own.
   */
  function applyEnemyHit(
    formation: THREE.Group,
    e: number,
    options?: { forceLethal?: boolean; noDrop?: boolean; extraBonus?: number },
  ) {
    const dive = diveWorldPos.current[e];
    const flank = flankWorldPos.current[e];
    const detached = dive ?? flank;
    const local = layout[e];
    const ex = detached ? detached.x : formation.position.x + local[0];
    const ey = detached ? detached.y : formation.position.y + local[1];
    const ez = detached ? detached.z : formation.position.z + local[2];

    const wasHeavy = enemyIsHeavy.current[e];
    enemyHealth.current[e] -= options?.forceLethal ? enemyHealth.current[e] : 1;
    if (enemyHealth.current[e] > 0) {
      // Chipped, not downed — flagged for the per-frame blink loop below
      // (see enemyChipped's own comment) so the damage reads as an ongoing
      // state a player can notice mid-fight, not just this one spark.
      enemyChipped.current[e] = true;
      explosions.trigger(new THREE.Vector3(ex, ey, ez), COLORS.amberDim);
      sound.enemyHit();
      return;
    }

    enemyChipped.current[e] = false;
    enemyAlive.current[e] = false;
    enemiesRef.current?.setEnemy(e, null);
    // Downing an enemy mid-dive or mid-flank gets a distinct flash color
    // (instead of the usual amber) and a score bonus — see DIVE.killBonus/
    // FLANKER.killBonus's own comments for why: exposed and moving fast is
    // a harder, more deserving target, and a Flanker's bonus is bigger
    // since it's also the harder one to even see coming. A Heavy's own
    // killBonus stacks with either if it happened to be diving/flanking
    // too (an enemy is never doing both of those at once, so at most one
    // of the two dive/flank bonuses ever applies).
    const wasDiving = dive !== null;
    const wasFlanking = flank !== null;
    explosions.trigger(
      new THREE.Vector3(ex, ey, ez),
      wasFlanking ? COLORS.enemyBolt : wasDiving ? COLORS.accent : COLORS.amber,
    );
    sound.enemyHit();
    if (wasDiving) {
      diveState.current[e] = null;
      diveWorldPos.current[e] = null;
    }
    if (wasFlanking) {
      flankState.current[e] = null;
      flankWorldPos.current[e] = null;
    }

    const bonus =
      (wasDiving ? DIVE.killBonus : 0) +
      (wasFlanking ? FLANKER.killBonus : 0) +
      (wasHeavy ? ENEMY_VARIANTS.heavy.killBonus : 0) +
      (options?.extraBonus ?? 0);
    useGameStore.getState().registerKill(bonus);
    useGameStore.getState().unlockAchievement("first_kill");
    if (wasHeavy) useGameStore.getState().unlockAchievement("first_heavy");
    if (!options?.noDrop) spawnPickup(new THREE.Vector3(ex, ey, ez));
    aliveCount.current -= 1;
    useGameStore.getState().setEnemiesRemaining(aliveCount.current);
    if (aliveCount.current <= 0) {
      useGameStore.getState().advanceWave();
      spawnWave(formation, useGameStore.getState().wave);
      sound.waveClear();
    }
  }

  /**
   * Shared by both ways a boss can die: the ordinary per-bolt hit-test and
   * the nova bomb's own flat damage chunk (see triggerNovaBomb). Kept as
   * one function so the two never drift out of sync on what "defeating the
   * boss" actually does.
   */
  function defeatBossNow(formation: THREE.Group) {
    const boss = bossRef.current;
    if (!boss) return;
    explosions.trigger(boss.position.clone(), COLORS.accent);
    boss.visible = false;
    bossActive.current = false;
    if (weakPointRef.current) weakPointRef.current.visible = false;
    bossWeakAligned.current = false;
    bossWeakAlignedStored.current = false;
    useGameStore.getState().setBossWeak(false);
    useGameStore.getState().defeatBoss(BOSS.killScore);
    useGameStore.getState().unlockAchievement("first_boss");
    spawnWave(formation, useGameStore.getState().wave);
    sound.waveClear();
    addShake(0.9);
    // Bullet time for the single biggest moment in a run — see
    // hitstopUntil's own comment for why this is reserved for exactly this
    // event and nothing more frequent.
    hitstopUntil.current = Date.now() + 450;
  }

  /**
   * A hit that reached the boss from the wrong angle while WEAKPOINT gating
   * is active (see bossWeakAligned) — the shot/blast still connects (the
   * bolt is consumed, the grenade still detonates), but does 0 damage.
   * Deliberately its own distinct, dull feedback (COLORS.deflect, a flat
   * "clink" rather than enemyHit's punchier impact sound) so it reads as
   * "that did nothing, wrong angle" rather than a smaller hit or a bug.
   */
  function deflectBossHit(position: THREE.Vector3) {
    explosions.trigger(position, COLORS.deflect);
    sound.bossDeflect();
  }

  /**
   * Nova bomb (see PICKUP.bombShareOfDrops): an instant screen-clear rather
   * than an equipped buff. Every alive regular enemy dies outright, reusing
   * applyEnemyHit's own kill path (explosion, sound, scoring, wave-clear
   * check) via forceLethal — noDrop stops one bomb from cascading into a
   * pile of further pickup drops. An active boss takes a flat chunk of
   * damage instead of being immune just because it isn't a "regular enemy."
   */
  function triggerNovaBomb(formation: THREE.Group) {
    for (let e = 0; e < ENEMY_COUNT; e++) {
      if (!enemyAlive.current[e]) continue;
      const beforeCount = aliveCount.current;
      applyEnemyHit(formation, e, { forceLethal: true, noDrop: true });
      // If that kill emptied the wave, applyEnemyHit's own wave-clear check
      // already spawned a brand new one — aliveCount jumps back UP to the
      // new wave's full count instead of continuing to decrement, which is
      // how that's detected here (rather than duplicating the check).
      // enemyAlive/layout now describe THAT new wave, not the one this
      // loop was iterating; continuing would kill enemies the player never
      // even saw. Stop immediately.
      if (aliveCount.current > beforeCount) break;
    }
    if (bossActive.current && bossRef.current) {
      bossHealth.current = Math.max(0, bossHealth.current - PICKUP.novaBossDamage);
      useGameStore.getState().damageBoss(PICKUP.novaBossDamage);
      bossHitFlashUntil.current = simTime.current + 0.15;
      explosions.trigger(bossRef.current.position.clone(), COLORS.pickupBomb);
      if (bossHealth.current <= 0) defeatBossNow(formation);
    }
    addShake(0.7);
    sound.novaBomb();
    useGameStore.getState().collectNova();
    useGameStore.getState().unlockAchievement("first_nova");
  }

  /**
   * A grenade detonating at `center` — one flat point of damage (via the
   * ordinary applyEnemyHit, so Heavy chipping/dive-flank bonuses/scoring/
   * pickup rolls/the wave-clear check all still apply exactly as they do
   * for a normal bolt) to every alive enemy within GRENADE.blastRadius,
   * plus a flat chunk of boss damage if one's active and in range. Value
   * is "several hits from one well-aimed throw," not "stronger than a
   * bolt" — deliberately weaker per-target than the nova bomb, which
   * force-kills regardless of remaining Heavy health.
   */
  function detonateGrenade(formation: THREE.Group, center: THREE.Vector3) {
    // The shockwave ring is what actually sells "this hit an AREA" — it
    // traces GRENADE.blastRadius itself, so it's visually obvious which
    // enemies were inside it and which weren't, rather than relying on a
    // couple of small particle bursts at one point to imply that on their
    // own (see the shockwave/burst distinction in Explosions.tsx).
    explosions.triggerShockwave(center, GRENADE.blastRadius, COLORS.grenade);
    explosions.trigger(center, COLORS.grenade);
    explosions.trigger(center, COLORS.amber);
    explosions.trigger(center, "#fff2df"); // hot near-white core, same accent EnemyBolt uses
    sound.grenadeExplode();
    addShake(0.45);

    for (let e = 0; e < ENEMY_COUNT; e++) {
      if (!enemyAlive.current[e]) continue;
      const detached = diveWorldPos.current[e] ?? flankWorldPos.current[e];
      const local = layout[e];
      const ex = detached ? detached.x : formation.position.x + local[0];
      const ey = detached ? detached.y : formation.position.y + local[1];
      const ez = detached ? detached.z : formation.position.z + local[2];
      const dx = center.x - ex;
      const dy = center.y - ey;
      const dz = center.z - ez;
      if (dx * dx + dy * dy + dz * dz > GRENADE.blastRadius ** 2) continue;
      const beforeCount = aliveCount.current;
      applyEnemyHit(formation, e);
      // Same cascade guard as triggerNovaBomb — a wave-clear mid-loop
      // invalidates the rest of this pass' enemy indices (see its own
      // comment for the full reasoning).
      if (aliveCount.current > beforeCount) break;
    }

    if (bossActive.current && bossRef.current) {
      const dx = center.x - bossRef.current.position.x;
      const dy = center.y - bossRef.current.position.y;
      const dz = center.z - bossRef.current.position.z;
      if (dx * dx + dy * dy + dz * dz <= GRENADE.blastRadius ** 2) {
        // Same weak-point gating as an ordinary bolt (see its own comment
        // above) — the blast still happens, but only damages the boss
        // itself while the ship is positioned in its vulnerable arc.
        if (!bossWeakAligned.current) {
          deflectBossHit(bossRef.current.position.clone());
        } else {
          bossHealth.current = Math.max(0, bossHealth.current - GRENADE.bossDamage);
          useGameStore.getState().damageBoss(GRENADE.bossDamage);
          bossHitFlashUntil.current = simTime.current + 0.15;
          if (bossHealth.current <= 0) defeatBossNow(formation);
        }
      }
    }
  }

  useFrame((_state, rawDelta) => {
    const clampedDelta = Math.min(rawDelta, 1 / 30); // clamp to avoid huge steps on tab-switch
    // Hitstop: see hitstopUntil's own comment — crawl to ~4% speed for a
    // brief window right after a boss dies, rather than the usual full rate.
    const delta = Date.now() < hitstopUntil.current ? clampedDelta * 0.04 : clampedDelta;
    const { status, paused } = useGameStore.getState();
    const ship = shipRef.current;
    const formation = formationRef.current;
    if (!ship || !formation) return;

    // Runs once on mount, and again every time "שחק שוב" brings status back
    // to "playing" — otherwise the next run would start with last run's dead
    // enemies, drifted formation and spent ammo pool still in place.
    if (status === "playing" && prevStatus.current !== "playing") {
      resetRun(ship, formation);
    }
    prevStatus.current = status;

    // paused freezes the ENTIRE simulation branch below (movement, firing,
    // enemy advance, every timer) without touching status — the run is
    // still "playing" underneath, just not ticking. Kept as a completely
    // separate flag from status rather than a third GameStatus value so
    // every existing `status === "playing"` check elsewhere (HUD,
    // gameStore) keeps meaning exactly what it already did.
    if (status === "playing" && !paused) {
      simTime.current += delta;

      // Wall-clock, not simTime — respawn invulnerability is a real-time
      // grace period (see SHIP.respawnInvulnerability), independent of how
      // fast the simulation itself is running.
      const now = Date.now();
      const invulnerable = now < useGameStore.getState().invulnerableUntil;
      // Blink the whole ship while invulnerable — the classic arcade "just
      // respawned" tell, and the only visible sign a player gets that shots
      // are currently passing through them for free.
      ship.visible = invulnerable ? Math.floor(now / 100) % 2 === 0 : true;

      if (import.meta.env.DEV) {
        // Console/debugging convenience only — never included in a
        // production build (see also __gameStore in main.tsx).
        (window as unknown as { __nexusDebug?: unknown }).__nexusDebug = {
          simTime: simTime.current,
          simTimeRef: simTime,
          aliveCount: aliveCount.current,
          shipRef: ship,
          formationRef: formation,
          spawnWaveDebug: (wave: number) => spawnWave(formation, wave),
          layout,
          enemyAliveArr: enemyAlive.current,
          enemyHealthArr: enemyHealth.current,
          enemyIsHeavyArr: enemyIsHeavy.current,
          enemyChippedArr: enemyChipped.current,
          diveStateArr: diveState.current,
          diveWorldPosArr: diveWorldPos.current,
          nextDiveAtRef: nextDiveAt,
          flankStateArr: flankState.current,
          flankWorldPosArr: flankWorldPos.current,
          nextFlankAtRef: nextFlankAt,
          currentDifficultyRef: currentDifficulty,
          waveEntranceUntilRef: waveEntranceUntil,
          formationScaleRef: formation.scale,
          bossRef,
          bossActiveRef: bossActive,
          bossHealthRef: bossHealth,
          bossNextFireAtRef: bossNextFireAt,
          bossHitFlashUntilRef: bossHitFlashUntil,
          hitstopUntilRef: hitstopUntil,
          camShakeRef: camShake,
          camera,
          lockReticleRef: lockReticleRef.current,
          weaponRef,
          pickupsRef: pickups.current,
          playerBoltsRef: playerBolts.current,
          enemyBoltsRef: enemyBolts.current,
          columnNextFireArr: columnNextFire.current,
          shieldLayoutRef: shieldLayout,
          shieldAliveArr: shieldAlive.current,
          shieldMeshRef: shieldMeshRef.current,
          blocksPerShield,
          tryHitShieldDebug: tryHitShield,
          applyPlayerHitDebug: (e: number) => applyEnemyHit(formation, e),
          triggerNovaBombDebug: () => triggerNovaBomb(formation),
          grenadePoolRef: grenadePool.current,
          grenadeLaunchZArr: grenadeLaunchZ.current,
          grenadeCooldownRef: grenadeCooldown,
          detonateGrenadeDebug: (center: THREE.Vector3) => detonateGrenade(formation, center),
          weakPointRef: weakPointRef.current,
          bossWeakAlignedRef: bossWeakAligned,
          anomalyRef: anomalyRef.current,
          anomalyActiveRef: anomalyActive,
          nextAnomalyAtRef: nextAnomalyAt,
          anomalyUntilRef: anomalyUntil,
          forceSpawnAnomalyDebug: () => {
            nextAnomalyAt.current = simTime.current;
          },
        };
      }

      // --- ship movement -------------------------------------------------
      const move = new THREE.Vector3(
        (input.current.right ? 1 : 0) - (input.current.left ? 1 : 0),
        (input.current.up ? 1 : 0) - (input.current.down ? 1 : 0),
        // Z/C: real forward/back piloting, not just an X/Y plane. Forward
        // (-Z) is toward the wave.
        (input.current.backward ? 1 : 0) - (input.current.forward ? 1 : 0),
      );
      if (move.lengthSq() > 0) {
        ship.position.x += move.x * SHIP.speed * delta;
        ship.position.y += move.y * SHIP.speed * delta;
        ship.position.z += move.z * SHIP.speed * delta;
        ship.position.x = THREE.MathUtils.clamp(ship.position.x, -ARENA.halfWidth, ARENA.halfWidth);
        ship.position.y = THREE.MathUtils.clamp(ship.position.y, ARENA.minY, ARENA.maxY);
        ship.position.z = THREE.MathUtils.clamp(ship.position.z, ARENA.minZ, ARENA.maxZ);
      }
      ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -move.x * 0.35, 0.15);
      // A slight forward pitch when diving in, back pitch when pulling out —
      // one more piece of "this is a real cockpit," not a flat plane sled.
      ship.rotation.x = THREE.MathUtils.lerp(ship.rotation.x, move.z * 0.2, 0.15);

      // --- gravity anomaly: pulls the ship off course while active (see
      // ANOMALY in config/constants.ts) — a real force to fight with
      // movement, not just a visual. Contact within its event horizon
      // costs a flat chunk of health once per appearance (anomalyShipHit)
      // plus a hard push straight back out, rather than repeatedly
      // damaging every frame the ship happens to sit inside it.
      if (anomalyActive.current && anomalyRef.current) {
        const center = anomalyRef.current.position;
        const adx = center.x - ship.position.x;
        const ady = center.y - ship.position.y;
        const adz = center.z - ship.position.z;
        const adist = Math.sqrt(adx * adx + ady * ady + adz * adz);
        if (adist < ANOMALY.pullRadius) {
          if (adist <= ANOMALY.eventHorizon) {
            if (!anomalyShipHit.current) {
              anomalyShipHit.current = true;
              useGameStore.getState().damageShip(ANOMALY.shipContactDamage);
              sound.anomalyConsume();
              addShake(0.5);
            }
            // Direction is undefined at (or extremely near) dead center —
            // fall back to a fixed push-back direction rather than
            // dividing by ~0, which would otherwise send the ship flying
            // to infinity for one frame.
            const pushDist = ANOMALY.eventHorizon + 1.5;
            const dirX = adist > 0.0001 ? adx / adist : 0;
            const dirY = adist > 0.0001 ? ady / adist : 0;
            const dirZ = adist > 0.0001 ? adz / adist : 1;
            ship.position.x = center.x - dirX * pushDist;
            ship.position.y = center.y - dirY * pushDist;
            ship.position.z = center.z - dirZ * pushDist;
          } else {
            const strength = (1 - adist / ANOMALY.pullRadius) * ANOMALY.shipPullPerSec * delta;
            ship.position.x += (adx / adist) * strength;
            ship.position.y += (ady / adist) * strength;
            ship.position.z += (adz / adist) * strength;
          }
          ship.position.x = THREE.MathUtils.clamp(ship.position.x, -ARENA.halfWidth, ARENA.halfWidth);
          ship.position.y = THREE.MathUtils.clamp(ship.position.y, ARENA.minY, ARENA.maxY);
          ship.position.z = THREE.MathUtils.clamp(ship.position.z, ARENA.minZ, ARENA.maxZ);
        }
      }

      // --- weapon expiry: a timed pickup reverts to the base weapon once
      // its clock runs out. Silent by design (see revertWeapon).
      if (weaponRef.current.kind !== "base" && now >= weaponRef.current.expiresAt) {
        weaponRef.current = { kind: "base", expiresAt: 0 };
        setShipAccentColor(ship, COLORS.phosphor);
        useGameStore.getState().revertWeapon();
      }

      // --- hit-flash revert: back to whichever accent color should
      // actually be showing right now (base, or the current weapon's tint)
      // once the brief white flash window (see addHitFlash) ends. Runs
      // after the weapon-expiry check above so a flash that happens to
      // straddle the exact same frame a weapon expires still ends up
      // showing the correct post-expiry color, not a stale one.
      if (hitFlashUntil.current > 0 && now >= hitFlashUntil.current) {
        hitFlashUntil.current = 0;
        setShipAccentColor(ship, baseAccentColor());
      }

      // --- critical-health warning pulse: a continuous, on-the-ship signal
      // once health drops to the same critical threshold the HUD's own
      // health bar already uses (SHIP.criticalHealthPct) — a glance at the
      // ship itself should read "in real danger," not just a number in the
      // corner. Skipped for the split second the brief hit-flash is
      // already showing (see addHitFlash) so the two never fight over the
      // exact same parts; wasCritical makes sure recovering back out of
      // critical (a health pickup, a fresh respawn) reverts the accent
      // exactly once instead of leaving it stuck on the last pulsed shade.
      const health = useGameStore.getState().health;
      const isCritical = health > 0 && health / SHIP.maxHealth <= SHIP.criticalHealthPct;
      if (isCritical && hitFlashUntil.current === 0) {
        const pulseT = (Math.sin(now * 0.012) + 1) / 2; // 0..1
        const warnColor = new THREE.Color(baseAccentColor()).lerp(new THREE.Color("#ff3b3b"), 0.15 + pulseT * 0.7);
        setShipAccentColor(ship, `#${warnColor.getHexString()}`);
        wasCritical.current = true;
      } else if (wasCritical.current && hitFlashUntil.current === 0) {
        setShipAccentColor(ship, baseAccentColor());
        wasCritical.current = false;
      }

      // --- player firing ---------------------------------------------------
      fireCooldown.current -= delta;
      if (input.current.fire && fireCooldown.current <= 0) {
        const heldWeapon = weaponRef.current.kind;
        if (heldWeapon === "spread") {
          fireCooldown.current = WEAPON.spread.cooldown;
          for (const offsetX of WEAPON.spread.offsets) {
            spawn(
              playerBolts.current,
              new THREE.Vector3(ship.position.x + offsetX, ship.position.y, ship.position.z - 1),
            );
          }
        } else {
          fireCooldown.current = heldWeapon === "rapid" ? WEAPON.rapid.cooldown : SHIP.fireCooldown;
          spawn(
            playerBolts.current,
            new THREE.Vector3(ship.position.x, ship.position.y, ship.position.z - 1),
          );
        }
        sound.playerFire(); // once per trigger pull, not once per bolt (spread fires 3 at once)
      }

      // --- grenade throw -----------------------------------------------------
      // A boolean held-state on a long cooldown, exactly like primary fire's
      // own (much shorter) one — held or tapped, the cooldown alone paces
      // how often it can actually go off either way.
      grenadeCooldown.current -= delta;
      if (input.current.grenade && grenadeCooldown.current <= 0) {
        grenadeCooldown.current = GRENADE.cooldown;
        const slot = grenadePool.current.active.indexOf(false);
        if (slot !== -1) {
          grenadeLaunchZ.current[slot] = ship.position.z;
          spawn(grenadePool.current, new THREE.Vector3(ship.position.x, ship.position.y, ship.position.z - 1));
          sound.grenadeThrow();
          // Mirrors the cooldown to the store purely for the HUD readout
          // (see grenadeReadyAt's own comment) — Scene's own ref above
          // stays the authoritative timer the simulation itself checks.
          useGameStore.getState().throwGrenade();
        }
      }

      // --- formation sway + advance ----------------------------------------
      formation.position.x = Math.sin(simTime.current * FORMATION.swaySpeed) * FORMATION.swayAmplitude;
      // Capped at frontLineZ — the wave physically can't advance past the
      // shields any more than a bolt can pass through one. Without this,
      // nothing stopped the formation's own position from growing forever
      // (the invasion check below only ever asked "is an enemy near the
      // ship," never "did the wave itself pass through a wall it should
      // have been physically blocked by").
      formation.position.z = Math.min(
        FORMATION.startZ + simTime.current * currentDifficulty.current.advanceSpeed,
        FORMATION.frontLineZ,
      );

      // --- wave entrance: the whole formation scales in from nothing right
      // after spawning (see WAVE_ENTRANCE_DURATION/easeOutBack) instead of
      // just instantly appearing fully formed — a brief "arrival" beat. A
      // parent-group scale, not a per-enemy one: cheap (one write instead
      // of 40), and composes automatically with each instance's own
      // already-correct local transform (Heavy scale, dive tilt, etc.)
      // without touching any of that per-enemy logic at all.
      if (simTime.current < waveEntranceUntil.current) {
        const entranceT = THREE.MathUtils.clamp(simTime.current / waveEntranceUntil.current, 0, 1);
        formation.scale.setScalar(easeOutBack(entranceT));
      } else {
        formation.scale.setScalar(1);
      }

      // --- gravity anomaly: spawn on cooldown, animate its lifecycle ----------
      // See ANOMALY's own comment in config/constants.ts for the overall
      // design — a normal-wave-only hazard, gated off entirely during a
      // boss wave (see the isBossWave branch in spawnWave, which
      // force-ends any instance still running and never lets a new one
      // begin while bossActive stays true).
      if (
        !anomalyActive.current &&
        !bossActive.current &&
        aliveCount.current > 0 &&
        simTime.current >= nextAnomalyAt.current
      ) {
        anomalyActive.current = true;
        anomalySpawnedAt.current = simTime.current;
        anomalyUntil.current = simTime.current + ANOMALY.duration;
        anomalyShipHit.current = false;
        if (anomalyRef.current) {
          anomalyRef.current.visible = true;
          anomalyRef.current.position.set(
            (Math.random() * 2 - 1) * ARENA.halfWidth * 0.7,
            THREE.MathUtils.lerp(ARENA.minY + 1, ARENA.maxY - 1, Math.random()),
            THREE.MathUtils.lerp(-14, 6, Math.random()),
          );
        }
        sound.anomalySpawn();
        useGameStore.getState().announceAnomaly();
      } else if (anomalyActive.current) {
        if (simTime.current >= anomalyUntil.current) {
          anomalyActive.current = false;
          if (anomalyRef.current) anomalyRef.current.visible = false;
          nextAnomalyAt.current =
            simTime.current + ANOMALY.cooldownMin + Math.random() * (ANOMALY.cooldownMax - ANOMALY.cooldownMin);
        } else if (anomalyRef.current) {
          // Grow in, hold, shrink out — the same easeOutBack "arrival" beat
          // a wave/boss entrance uses, mirrored on the way out too since
          // this hazard actually needs to visibly leave rather than just
          // vanishing outright.
          const sinceSpawn = simTime.current - anomalySpawnedAt.current;
          const untilDespawn = anomalyUntil.current - simTime.current;
          let entranceMul = 1;
          if (sinceSpawn < ANOMALY.entranceDuration) {
            entranceMul = easeOutBack(THREE.MathUtils.clamp(sinceSpawn / ANOMALY.entranceDuration, 0, 1));
          } else if (untilDespawn < ANOMALY.entranceDuration) {
            entranceMul = THREE.MathUtils.clamp(untilDespawn / ANOMALY.entranceDuration, 0, 1);
          }
          anomalyRef.current.scale.setScalar(ANOMALY.visualScale * Math.max(0.01, entranceMul));
        }
      }

      // --- enemy diving/flanking: launch a new one on cooldown ---------------
      // See DIVE's own comment in config/constants.ts for the overall shape.
      // A global cooldown gate, not one per enemy — how often "something is
      // diving" reads the same regardless of how many enemies are left.
      if (simTime.current >= nextDiveAt.current) {
        let activeDives = 0;
        for (let e = 0; e < ENEMY_COUNT; e++) if (diveState.current[e]) activeDives++;
        if (activeDives < DIVE.maxConcurrent) {
          const candidates: number[] = [];
          for (let e = 0; e < ENEMY_COUNT; e++) {
            if (enemyAlive.current[e] && !diveState.current[e]) candidates.push(e);
          }
          if (candidates.length > 0) {
            const chosen = candidates[Math.floor(Math.random() * candidates.length)];
            const local = layout[chosen];
            diveState.current[chosen] = {
              startTime: simTime.current,
              startPos: new THREE.Vector3(
                formation.position.x + local[0],
                formation.position.y + local[1],
                formation.position.z + local[2],
              ),
              lateralSign: Math.random() < 0.5 ? -1 : 1,
              fired: false,
            };
          }
        }
        // Rescheduled unconditionally even when no candidate was free (every
        // slot alive already diving, or the whole wave dead) — the next
        // check just tries again later rather than spamming this branch's
        // O(ENEMY_COUNT) scan every single frame.
        {
          const { diveCooldownMin, diveCooldownMax } = currentDifficulty.current;
          nextDiveAt.current = simTime.current + diveCooldownMin + Math.random() * (diveCooldownMax - diveCooldownMin);
        }
      }

      // --- enemy diving/flanking: advance every in-progress dive --------------
      // Diving enemies leave the formation group's shared transform behind
      // (its sway/advance no longer applies to them — see the launch block
      // above), so each needs its own explicit per-frame instance update
      // instead. diveWorldPos is written here and read by every other block
      // below that needs an enemy's actual current position.
      for (let e = 0; e < ENEMY_COUNT; e++) {
        const dive = diveState.current[e];
        if (!dive) continue;
        if (!enemyAlive.current[e]) {
          // Killed mid-dive (by the player-bolt hit-test further down, on an
          // earlier frame) — already hidden there; just stop tracking it.
          diveState.current[e] = null;
          diveWorldPos.current[e] = null;
          continue;
        }
        const t = (simTime.current - dive.startTime) / DIVE.duration;
        if (t >= 1) {
          // Loop complete — snap back exactly onto the formation's own
          // layout slot (the curve already ends there at t=1; this just
          // removes any floating-point drift) and stop updating it — it
          // rides on the formation group's transform again from here on.
          diveState.current[e] = null;
          diveWorldPos.current[e] = null;
          enemiesRef.current?.setEnemy(
            e,
            layout[e],
            undefined,
            enemyIsHeavy.current[e] ? ENEMY_VARIANTS.heavy.scale : 1,
            enemyIsHeavy.current[e],
          );
          continue;
        }

        const local = layout[e];
        // The formation keeps moving while this dive is in progress, so the
        // "return to slot" endpoint has to track its LIVE position, not a
        // frozen one from launch time.
        const target = new THREE.Vector3(
          formation.position.x + local[0],
          formation.position.y + local[1],
          formation.position.z + local[2],
        );
        const pos = dive.startPos.clone().lerp(target, t);
        // 0 at both ends, 1 at the midpoint — how far this frame pulls off
        // the straight launch->return line toward the ship itself.
        const swoop = Math.sin(t * Math.PI);
        const divePoint = new THREE.Vector3(
          ship.position.x + dive.lateralSign * 1.4,
          ship.position.y + 1.2,
          ship.position.z + 2.5,
        );
        pos.lerp(divePoint, swoop * DIVE.peakPull);
        // A small extra wiggle, fading out toward the return — pure flair,
        // doesn't affect where the curve actually ends up.
        pos.x += Math.sin(t * Math.PI * 2) * DIVE.lateralWiggle * (1 - t);

        diveWorldPos.current[e] = pos;
        // setEnemy's pos/tilt are in the formation GROUP's own local space
        // (see Enemies.tsx), same as every stationary member's layout
        // entry — subtract the group's current position to convert this
        // frame's world-space curve point back into that space.
        enemiesRef.current?.setEnemy(
          e,
          [pos.x - formation.position.x, pos.y - formation.position.y, pos.z - formation.position.z],
          [swoop * DIVE.maxTilt, 0, dive.lateralSign * swoop * DIVE.maxTilt * 0.6],
          enemyIsHeavy.current[e] ? ENEMY_VARIANTS.heavy.scale : 1,
          enemyIsHeavy.current[e],
        );

        // One dedicated attack shot per dive, fired from wherever it
        // actually is at the peak of the swoop — not on the normal
        // per-column schedule (see the enemy-firing loop below, which
        // excludes diving enemies from its column rotation for exactly
        // this reason).
        if (!dive.fired && t >= DIVE.firePhase) {
          dive.fired = true;
          spawn(enemyBolts.current, pos.clone());
          sound.enemyFire();
        }
      }

      // --- enemy flanking: launch a new one on cooldown -----------------------
      // See FLANKER's own comment in config/constants.ts for the overall
      // shape — a materially different attack from a dive, not a reskin.
      if (simTime.current >= nextFlankAt.current) {
        let activeFlanks = 0;
        for (let e = 0; e < ENEMY_COUNT; e++) if (flankState.current[e]) activeFlanks++;
        if (activeFlanks < FLANKER.maxConcurrent) {
          const candidates: number[] = [];
          for (let e = 0; e < ENEMY_COUNT; e++) {
            // Excludes anything already diving too — an enemy only ever
            // does one detached attack run at a time.
            if (enemyAlive.current[e] && !diveState.current[e] && !flankState.current[e]) candidates.push(e);
          }
          if (candidates.length > 0) {
            const chosen = candidates[Math.floor(Math.random() * candidates.length)];
            const local = layout[chosen];
            flankState.current[chosen] = {
              startTime: simTime.current,
              startPos: new THREE.Vector3(
                formation.position.x + local[0],
                formation.position.y + local[1],
                formation.position.z + local[2],
              ),
              side: Math.random() < 0.5 ? -1 : 1,
              fired: false,
            };
          }
        }
        nextFlankAt.current =
          simTime.current + FLANKER.cooldownMin + Math.random() * (FLANKER.cooldownMax - FLANKER.cooldownMin);
      }

      // --- enemy flanking: advance every in-progress flank --------------------
      for (let e = 0; e < ENEMY_COUNT; e++) {
        const flank = flankState.current[e];
        if (!flank) continue;
        if (!enemyAlive.current[e]) {
          // Killed mid-flank — already hidden by the hit-test further down
          // on an earlier frame; just stop tracking it.
          flankState.current[e] = null;
          flankWorldPos.current[e] = null;
          continue;
        }
        const t = (simTime.current - flank.startTime) / FLANKER.duration;
        if (t >= 1) {
          flankState.current[e] = null;
          flankWorldPos.current[e] = null;
          enemiesRef.current?.setEnemy(
            e,
            layout[e],
            undefined,
            enemyIsHeavy.current[e] ? ENEMY_VARIANTS.heavy.scale : 1,
            enemyIsHeavy.current[e],
          );
          continue;
        }

        const local = layout[e];
        // Same "the formation keeps moving, track it live" reasoning as
        // the dive's own target — the return endpoint has to be wherever
        // the slot actually is by the time this flank finishes, not where
        // it was at launch.
        const target = new THREE.Vector3(
          formation.position.x + local[0],
          formation.position.y + local[1],
          formation.position.z + local[2],
        );
        const pos = flank.startPos.clone().lerp(target, t);

        // Two non-overlapping phase windows, each its own full 0->1->0
        // envelope (NOT sharing a blend budget with the other — an earlier
        // version diluted the wide leg's own pull strength by the cut-in's
        // constant, which left it barely leaving the formation's own
        // lane at all): the first half swings wide to one side, the
        // second cuts in close to the ship, and both fade back to 0 at
        // their own window's edges so the base lerp toward the (live,
        // still-moving) formation slot above already handles a clean
        // start/end with no jump.
        if (t <= 0.5) {
          // The wide leg: pulls FAR out to one side and almost all the way
          // to the ship's own depth — deliberately NOT a point behind/
          // above it like a dive's own swoop, and deliberately close to
          // the ship's z rather than lingering out at the formation's own
          // distant depth: the camera's view cone is much NARROWER (in
          // absolute world units) near the ship than it is far downrange,
          // so the same lateral throw that would still read as easily
          // visible out at the formation's depth reliably clears the
          // frustum entirely out here — which is the one thing this whole
          // maneuver (and the radar built for it) actually depends on.
          const wideT = Math.sin((t / 0.5) * Math.PI);
          const widePoint = new THREE.Vector3(
            flank.side * (ARENA.halfWidth + FLANKER.wideOffset),
            ship.position.y,
            THREE.MathUtils.lerp(flank.startPos.z, ship.position.z, 0.92),
          );
          pos.lerp(widePoint, wideT * 0.92);
        } else {
          // The cut-in: a real attack pass close alongside the ship once
          // it's already out at its widest, not a detour that just
          // happens to wander back to its own slot on its own. Peaks
          // around t=0.75 (the midpoint of this second window) and fades
          // back out by t=1, so it peels away again rather than parking
          // next to the ship.
          const cutT = Math.sin(((t - 0.5) / 0.5) * Math.PI);
          const approachPoint = new THREE.Vector3(ship.position.x + flank.side * 1.6, ship.position.y, ship.position.z + 1);
          pos.lerp(approachPoint, cutT * FLANKER.approachPull);
        }

        flankWorldPos.current[e] = pos;
        // A bank/yaw into the turn — a different tilt axis from the dive's
        // own nose-down pitch, so the two attack types read as visually
        // distinct even at a glance.
        enemiesRef.current?.setEnemy(
          e,
          [pos.x - formation.position.x, pos.y - formation.position.y, pos.z - formation.position.z],
          [0, flank.side * 0.3, flank.side * 0.4],
          enemyIsHeavy.current[e] ? ENEMY_VARIANTS.heavy.scale : 1,
          enemyIsHeavy.current[e],
        );

        if (!flank.fired && t >= FLANKER.firePhase) {
          flank.fired = true;
          spawn(enemyBolts.current, pos.clone());
          sound.enemyFire();
        }
      }

      // --- gravity anomaly: consumes any diving/flanking enemy whose own
      // attack run brings it within the event horizon (see ANOMALY's own
      // comment in constants.ts). Deliberately a proximity check, NOT a
      // gradual pull like the ship/bolts get above: diveWorldPos/
      // flankWorldPos are recomputed FRESH every frame straight from each
      // attack's own start-position/timing formula (see the dive/flank
      // advance loops above) with no memory of anything nudging them the
      // previous frame, so mutating them here would just get silently
      // discarded on the very next frame — there's no persistent velocity
      // to actually accumulate a pull into. A regular (non-diving/
      // flanking) formation enemy is skipped for the same reason FLANKER/
      // DIVE's own consumers skip it: it shares the formation's one
      // transform and has no independent position to test at all.
      if (anomalyActive.current && anomalyRef.current) {
        const center = anomalyRef.current.position;
        for (let e = 0; e < ENEMY_COUNT; e++) {
          if (!enemyAlive.current[e]) continue;
          const detached = diveWorldPos.current[e] ?? flankWorldPos.current[e];
          if (!detached) continue;
          const dx = center.x - detached.x;
          const dy = center.y - detached.y;
          const dz = center.z - detached.z;
          if (dx * dx + dy * dy + dz * dz > ANOMALY.enemyCaptureRadius ** 2) continue;
          const beforeCount = aliveCount.current;
          sound.anomalyConsume();
          applyEnemyHit(formation, e, { forceLethal: true, noDrop: true, extraBonus: ANOMALY.suckedKillBonus });
          // Same cascade guard as triggerNovaBomb/detonateGrenade — see
          // their own comments for the full reasoning.
          if (aliveCount.current > beforeCount) break;
        }
      }

      // --- chipped-enemy blink: an ongoing "wounded" tell -------------------
      // A Heavy that survived a hit (see enemyChipped's own comment) blinks
      // every frame instead of just having flashed a spark once — a chip is
      // easy to miss mid-fight otherwise, especially against a scale bump
      // that's already there for every Heavy regardless of health. Diving
      // ones are left alone here: the dive-update loop above already gives
      // them its own per-frame attention, and layering a second competing
      // visibility toggle on the exact same instance would just fight it.
      for (let e = 0; e < ENEMY_COUNT; e++) {
        if (!enemyChipped.current[e] || !enemyAlive.current[e] || diveState.current[e]) continue;
        const blinkOn = Math.floor(simTime.current * 6) % 2 === 0;
        enemiesRef.current?.setEnemy(e, blinkOn ? layout[e] : null, undefined, ENEMY_VARIANTS.heavy.scale, true);
      }

      // --- boss wave: sweep, advance, and barrage fire ------------------------
      // See BOSS's own comment in config/constants.ts. Its barrage is just
      // ordinary pooled enemy bolts — the existing "enemy bolts: move, cull,
      // hit-test against ship" loop further down needs no changes at all to
      // handle them.
      if (bossActive.current && bossRef.current) {
        const boss = bossRef.current;
        const variant = BOSS.variants[bossVariant.current];
        // Side-to-side sweep, reversing at the arena's own bounds (minus a
        // margin for its own visual footprint) rather than a fixed patrol
        // width — automatically follows whatever ARENA.halfWidth is tuned
        // to instead of needing its own separately-tuned constant. Speed
        // is per-variant — the Harrier sweeps noticeably faster.
        const margin = ARENA.halfWidth * 0.25;
        boss.position.x += bossSweepDir.current * variant.sweepSpeed * delta;
        if (boss.position.x > ARENA.halfWidth - margin) {
          boss.position.x = ARENA.halfWidth - margin;
          bossSweepDir.current = -1;
        } else if (boss.position.x < -(ARENA.halfWidth - margin)) {
          boss.position.x = -(ARENA.halfWidth - margin);
          bossSweepDir.current = 1;
        }
        boss.position.z = Math.min(boss.position.z + variant.advanceSpeed * delta, BOSS.frontLineZ);
        // A small bob and a slow yaw. The yaw used to be purely cosmetic
        // (kept what would otherwise read as a flat sprite gliding on
        // rails feeling alive) — it's now also what the weak point marker
        // rides (see below), reusing this one rotation as the single
        // source of truth for "which way is the boss's flank facing"
        // rather than adding a second, disconnected accumulator.
        boss.rotation.y += delta * 0.15;
        boss.position.y = (ARENA.minY + ARENA.maxY) / 2 + Math.sin(simTime.current * 0.8) * 0.6;

        // Three independent scale effects combine multiplicatively into
        // one final transform: the wave-entrance scale-in just below, the
        // slow telegraph swell building toward each attack, and the sharp
        // per-hit recoil pop (see bossHitFlashUntil's own comment) —
        // unrelated timings, so none of them reset or fight each other by
        // sharing a single scale write.
        let scaleMultiplier = 1;

        // Entrance: see WAVE_ENTRANCE_DURATION/easeOutBack's own comment on
        // the grunt formation's identical use of this — same "snaps into
        // place" arrival beat, just multiplied in here instead of written
        // to a separate parent group, since the boss has no such group of
        // its own.
        if (simTime.current < waveEntranceUntil.current) {
          const entranceT = THREE.MathUtils.clamp(simTime.current / waveEntranceUntil.current, 0, 1);
          scaleMultiplier *= easeOutBack(entranceT);
        }

        // Telegraph: a visible "winding up" swell in the last
        // BOSS.telegraphDuration seconds before each attack — an
        // ever-growing scale pulse (transform-only, same trick as the
        // Heavy variant's own bigger scale, so no material plumbing is
        // needed) that peaks exactly at the instant it fires, then snaps
        // back to normal. Gives a real read-and-react dodge window instead
        // of the attack just appearing with zero warning.
        const timeToFire = bossNextFireAt.current - simTime.current;
        if (timeToFire > 0 && timeToFire <= BOSS.telegraphDuration) {
          const chargeT = 1 - timeToFire / BOSS.telegraphDuration;
          scaleMultiplier *= 1 + BOSS.telegraphPulse * chargeT * chargeT;
        }

        const hitFlashRemaining = bossHitFlashUntil.current - simTime.current;
        if (hitFlashRemaining > 0) {
          scaleMultiplier *= 1 + 0.12 * (hitFlashRemaining / 0.15);
        }

        boss.scale.setScalar(BOSS.visualScale * scaleMultiplier);

        // --- weak point: orbits with the boss's own yaw, and gates whether
        // player damage actually lands (see WEAKPOINT in constants.ts and
        // deflectBossHit above). Computed once here, read later this same
        // frame by every place that applies player damage to the boss.
        const weakDirX = Math.sin(boss.rotation.y);
        const weakDirZ = Math.cos(boss.rotation.y);
        if (weakPointRef.current) {
          const radius = WEAKPOINT.visualRadius * boss.scale.x;
          weakPointRef.current.position.set(
            boss.position.x + weakDirX * radius,
            boss.position.y,
            boss.position.z + weakDirZ * radius,
          );
        }
        const wpDx = ship.position.x - boss.position.x;
        const wpDz = ship.position.z - boss.position.z;
        const wpDist = Math.hypot(wpDx, wpDz);
        bossWeakAligned.current =
          wpDist > 0.01 &&
          (wpDx * weakDirX + wpDz * weakDirZ) / wpDist >= Math.cos(WEAKPOINT.arcHalfAngle);
        if (weakPointRef.current) setWeakPointAligned(weakPointRef.current, bossWeakAligned.current, simTime.current);
        // Store mirror only on an actual flip — see bossWeakAlignedStored's
        // own comment for why (avoids re-rendering the whole HUD 60x/sec).
        if (bossWeakAligned.current !== bossWeakAlignedStored.current) {
          bossWeakAlignedStored.current = bossWeakAligned.current;
          useGameStore.getState().setBossWeak(bossWeakAligned.current);
        }

        if (simTime.current >= bossNextFireAt.current) {
          bossNextFireAt.current =
            simTime.current + variant.fireIntervalMin + Math.random() * (variant.fireIntervalMax - variant.fireIntervalMin);
          // No explicit scale reset needed here — the combined
          // telegraph+hit-flash multiplier above already recomputes the
          // correct scale fresh every frame from these refs directly, so
          // rescheduling bossNextFireAt is enough to fall out of the
          // telegraph condition on its own next frame.
          if (variant.aimed) {
            // The Harrier's single precision-aimed shot: spawned at the
            // SHIP's own current x/y (not the boss's) so it reliably tracks
            // through wherever the ship actually is as it travels in z —
            // the same "fixed x/y at spawn" bolt model every other shot in
            // the game already uses, just aimed at a different point than
            // the shooter's own position. A real, dodgeable threat rather
            // than an unavoidable snap-hit: the telegraph above still gives
            // a full warning window before it fires.
            spawn(enemyBolts.current, new THREE.Vector3(ship.position.x, ship.position.y, boss.position.z));
          } else {
            // A fanned barrage, not a single shot — the boss occupying one
            // enemy "slot" worth of danger the whole fight would otherwise
            // undersell replacing 40 enemies with it.
            const half = (variant.spreadCount - 1) / 2;
            for (let i = 0; i < variant.spreadCount; i++) {
              const offsetX = variant.spreadCount > 1 ? (i - half) * (variant.spreadWidth / (variant.spreadCount - 1)) : 0;
              spawn(enemyBolts.current, new THREE.Vector3(boss.position.x + offsetX, boss.position.y, boss.position.z));
            }
          }
          // A distinct sound for the Harrier's own aimed shot — see
          // sound.bossAimedShot's own comment for why.
          if (variant.aimed) sound.bossAimedShot();
          else sound.enemyFire();
        }
      }

      // "The wave broke through" means a real alive enemy actually reached
      // the ship (see HIT_RADIUS.enemyVsShip's own comment for why this
      // replaced a fixed depth-only check) — not an abstract line the
      // formation's own position crossed regardless of where the ship
      // happened to be standing. The formation is flat in z (every alive
      // enemy shares formation.position.z), so only x/y actually vary here.
      // A diving OR flanking enemy's real (possibly detached-from-
      // formation) position takes priority when set — this is also
      // exactly how either one actually reaching the ship costs a life,
      // through the same check a stationary formation reaching the front
      // line already uses. An enemy is never doing both at once, so this
      // order never actually needs to pick between two non-null values.
      let enemyReachedShip = false;
      for (let e = 0; e < ENEMY_COUNT; e++) {
        if (!enemyAlive.current[e]) continue;
        const detached = diveWorldPos.current[e] ?? flankWorldPos.current[e];
        const local = layout[e];
        const ex = detached ? detached.x : formation.position.x + local[0];
        const ey = detached ? detached.y : formation.position.y + local[1];
        const ez = detached ? detached.z : formation.position.z + local[2];
        const dx = ship.position.x - ex;
        const dy = ship.position.y - ey;
        const dz = ship.position.z - ez;
        if (dx * dx + dy * dy + dz * dz <= HIT_RADIUS.enemyVsShip ** 2) {
          enemyReachedShip = true;
          break;
        }
      }
      // (No separate "formation flew way past the ship" safety net needed
      // here anymore — frontLineZ above already hard-stops the formation's
      // own position well short of anywhere that could happen.)
      // A boss "ramming" the ship reuses this exact same check/consequence —
      // BOSS.frontLineZ keeps this a rare edge case rather than the fight's
      // main danger, which is its barrage, not contact.
      if (!enemyReachedShip && bossActive.current && bossRef.current) {
        const dx = ship.position.x - bossRef.current.position.x;
        const dy = ship.position.y - bossRef.current.position.y;
        const dz = ship.position.z - bossRef.current.position.z;
        if (dx * dx + dy * dy + dz * dz <= BOSS.contactRadius ** 2) enemyReachedShip = true;
      }
      if (enemyReachedShip) {
        // The wave reached the player line. With lives in play this isn't
        // automatically the end of the run — handleInvasion costs a life
        // outright and tells us whether one was left to spend.
        const survived = useGameStore.getState().handleInvasion();
        if (!survived && useGameStore.getState().status === "gameover") {
          sound.gameOver();
          addShake(0.8);
        }
        if (survived) {
          sound.lifeLost();
          addShake(0.5);
          // A life remained: push the wave back to its starting depth and
          // respawn the ship, but touch NOTHING else — enemies already
          // killed stay dead, shield damage stays, ammo in flight keeps
          // flying. Just healing/respawning the ship in place (formation
          // untouched) would leave it sitting exactly where it already
          // broke through, re-triggering this same check next frame, so
          // the formation has to move — but a FULL spawnWave (fresh 40
          // enemies, repaired shields) was needlessly punishing: it wiped
          // out real progress on the wave for a mistake that cost a life
          // already. Resetting simTime re-derives both the formation's z
          // (startZ + simTime*advanceSpeed) and its sway phase back to a
          // clean starting position.
          ship.position.set(0, (ARENA.minY + ARENA.maxY) / 2, ARENA.shipZ);
          ship.rotation.set(0, 0, 0);
          formation.position.set(0, 0, FORMATION.startZ);
          simTime.current = 0;
          // columnNextFire values are scheduled as simTime.current + some
          // offset — left untouched, they'd still hold whatever (much
          // larger) simTime they were scheduled against before the reset
          // above, so every column would wait for simTime to climb all the
          // way back up past its stale number before firing again. Enemies
          // would look like they'd simply stopped shooting, for as long as
          // that takes (potentially minutes). Reschedule fresh, exactly
          // like spawnWave does for a brand new wave.
          const { fireMin, fireMax } = currentDifficulty.current;
          for (let col = 0; col < FORMATION.cols; col++) {
            columnNextFire.current[col] = fireMin + Math.random() * (fireMax - fireMin);
          }

          // A diver mid-attack-run when this happened is holding a
          // detached world position that has nothing to do with the
          // formation's just-reset one — left alone, it would render as a
          // ghost enemy stranded wherever the dive curve last put it,
          // never receiving another per-frame update (nothing is tracking
          // it as diving anymore) and never rejoining the formation
          // group's own transform either. Snap it straight back into its
          // ordinary layout slot, exactly like a freshly spawned wave does
          // for every enemy.
          for (let e = 0; e < ENEMY_COUNT; e++) {
            if (!diveState.current[e]) continue;
            diveState.current[e] = null;
            diveWorldPos.current[e] = null;
            if (enemyAlive.current[e]) {
              enemiesRef.current?.setEnemy(
                e,
                layout[e],
                undefined,
                enemyIsHeavy.current[e] ? ENEMY_VARIANTS.heavy.scale : 1,
                enemyIsHeavy.current[e],
              );
            }
          }
          nextDiveAt.current = DIVE.graceAfterWaveStart + Math.random() * (DIVE.cooldownMax - DIVE.cooldownMin);

          // Same snap-back for an in-progress flank — see the dive
          // cleanup right above for why this is necessary at all.
          for (let e = 0; e < ENEMY_COUNT; e++) {
            if (!flankState.current[e]) continue;
            flankState.current[e] = null;
            flankWorldPos.current[e] = null;
            if (enemyAlive.current[e]) {
              enemiesRef.current?.setEnemy(
                e,
                layout[e],
                undefined,
                enemyIsHeavy.current[e] ? ENEMY_VARIANTS.heavy.scale : 1,
                enemyIsHeavy.current[e],
              );
            }
          }
          nextFlankAt.current = FLANKER.graceAfterWaveStart + Math.random() * (FLANKER.cooldownMax - FLANKER.cooldownMin);

          // A boss fight in progress: push it back to its own starting
          // position/timers the same way the formation just was, but its
          // health is untouched — only position resets on a life lost,
          // never progress, matching the ordinary formation's own rule
          // (kills/shield damage also survive this reset).
          if (bossActive.current && bossRef.current) {
            bossRef.current.position.set(0, (ARENA.minY + ARENA.maxY) / 2, FORMATION.startZ);
            bossSweepDir.current = Math.random() < 0.5 ? -1 : 1;
            const variant = BOSS.variants[bossVariant.current];
            bossNextFireAt.current = variant.fireIntervalMin + Math.random() * (variant.fireIntervalMax - variant.fireIntervalMin);
          }
        }
      }

      // --- aim sight: a real 3D line down the ship's exact firing lane, plus
      // a lock reticle on whichever enemy currently sits in it. Camera
      // perspective makes eyeballing "what am I even under" from the ship's
      // screen position alone unreliable — this draws the real answer.
      if (aimLineRef.current) {
        // Spans from the ship's own (now movable, Z/C) z down past the
        // formation's furthest possible start — recomputed every frame
        // since the ship's z is no longer fixed.
        const farZ = FORMATION.startZ - 10;
        const nearZ = ship.position.z;
        aimLineRef.current.position.set(ship.position.x, ship.position.y, (nearZ + farZ) / 2);
        aimLineRef.current.scale.y = (nearZ - farZ) / AIM_LINE_LENGTH;
      }
      if (lockReticleRef.current) {
        let lockedEnemy = -1;
        let lockedDistSq = LOCK_RADIUS * LOCK_RADIUS;
        for (let e = 0; e < ENEMY_COUNT; e++) {
          if (!enemyAlive.current[e]) continue;
          const detached = diveWorldPos.current[e] ?? flankWorldPos.current[e];
          const local = layout[e];
          const ex = detached ? detached.x : formation.position.x + local[0];
          const ey = detached ? detached.y : formation.position.y + local[1];
          const dx = ship.position.x - ex;
          const dy = ship.position.y - ey;
          const distSq = dx * dx + dy * dy;
          if (distSq <= lockedDistSq) {
            lockedDistSq = distSq;
            lockedEnemy = e;
          }
        }
        // The boss counts too — using its own (much bigger) hit radius as
        // the lock threshold instead of LOCK_RADIUS, which is tuned to a
        // regular enemy's small hitbox and would make an obviously-
        // hittable giant target look "not locked" almost the entire fight.
        // (No regular enemy is ever alive during a boss wave, so this can
        // never conflict with the loop above — it only ever fires as a
        // fallback.)
        let lockedIsBoss = false;
        if (lockedEnemy < 0 && bossActive.current && bossRef.current) {
          const dx = ship.position.x - bossRef.current.position.x;
          const dy = ship.position.y - bossRef.current.position.y;
          if (dx * dx + dy * dy <= BOSS.hitRadius ** 2) lockedIsBoss = true;
        }

        if (lockedIsBoss && bossRef.current) {
          lockReticleRef.current.visible = true;
          lockReticleRef.current.position.copy(bossRef.current.position);
          // The reticle's own geometry is sized to wrap a regular enemy's
          // small silhouette — left at that size it would look lost inside
          // the boss's much bigger one, so it scales up to roughly match.
          lockReticleRef.current.scale.setScalar(BOSS.visualScale / 1.8);
        } else if (lockedEnemy >= 0) {
          const detached = diveWorldPos.current[lockedEnemy] ?? flankWorldPos.current[lockedEnemy];
          const local = layout[lockedEnemy];
          lockReticleRef.current.visible = true;
          lockReticleRef.current.scale.setScalar(1);
          lockReticleRef.current.position.set(
            detached ? detached.x : formation.position.x + local[0],
            detached ? detached.y : formation.position.y + local[1],
            detached ? detached.z : formation.position.z + local[2],
          );
        } else {
          lockReticleRef.current.visible = false;
        }
      }

      // --- enemy firing: at most one shooter per column -----------------------
      for (let col = 0; col < FORMATION.cols; col++) {
        if (simTime.current < columnNextFire.current[col]) continue;

        // Any alive enemy in the column that isn't off on its own attack
        // run may take this shot (picked at random, not always the
        // frontmost, so fire doesn't monotonously come from the same row
        // for as long as it survives) — a diving or flanking enemy is
        // excluded either way: it's not sitting at its formation slot, and
        // already gets its own dedicated shot at the right moment in its
        // own run (see the dive/flank update blocks above).
        const aliveInColumn: number[] = [];
        for (let row = 0; row < FORMATION.rows; row++) {
          const idx = row * FORMATION.cols + col;
          if (enemyAlive.current[idx] && !diveState.current[idx] && !flankState.current[idx]) aliveInColumn.push(idx);
        }
        if (aliveInColumn.length === 0) continue; // whole column is dead — silent
        const shooter = aliveInColumn[Math.floor(Math.random() * aliveInColumn.length)];

        const { fireMin, fireMax } = currentDifficulty.current;
        columnNextFire.current[col] = simTime.current + fireMin + Math.random() * (fireMax - fireMin);

        const local = layout[shooter];
        const worldPos = new THREE.Vector3(
          formation.position.x + local[0],
          formation.position.y + local[1],
          formation.position.z + local[2],
        );
        spawn(enemyBolts.current, worldPos);
        sound.enemyFire();
      }

      // --- player bolts: move, cull, hit-test against enemies ---------------
      for (let i = 0; i < playerBolts.current.refs.length; i++) {
        if (!playerBolts.current.active[i]) continue;
        const mesh = playerBolts.current.refs[i].current;
        if (!mesh) continue;
        mesh.position.z += playerBolts.current.dir * playerBolts.current.speed * delta;

        // Gravity anomaly (see ANOMALY in constants.ts): curves the bolt's
        // straight-line path toward it, and swallows it outright at the
        // event horizon — one more thing a player has to account for
        // while it's active, on top of everything already homing in on
        // the formation.
        if (anomalyActive.current && anomalyRef.current) {
          if (applyAnomalyPull(mesh.position, anomalyRef.current.position, ANOMALY.boltPullPerSec, delta)) {
            playerBolts.current.active[i] = false;
            mesh.visible = false;
            sound.anomalyConsume();
            continue;
          }
        }

        if (mesh.position.z < FORMATION.startZ - 6) {
          playerBolts.current.active[i] = false;
          mesh.visible = false;
          continue;
        }

        // Symmetric, like the arcade original: the player's own fire erodes
        // shields too. With only 4 shields spread across 8 columns, half the
        // columns are always fully open with no shield in the way — the
        // other half is exactly the original's "shoot a tunnel through your
        // own bunker" dynamic, not a permanent block.
        if (tryHitShield(mesh.position.x, mesh.position.y, mesh.position.z)) {
          playerBolts.current.active[i] = false;
          mesh.visible = false;
          continue;
        }

        if (bossActive.current && bossRef.current) {
          const boss = bossRef.current;
          const dx = mesh.position.x - boss.position.x;
          const dy = mesh.position.y - boss.position.y;
          const dz = mesh.position.z - boss.position.z;
          if (dx * dx + dy * dy + dz * dz <= BOSS.hitRadius ** 2) {
            playerBolts.current.active[i] = false;
            mesh.visible = false;
            // The weak point (see WEAKPOINT in constants.ts): a bolt
            // landing while the ship isn't in the vulnerable arc still
            // connects visually/physically, but deals no damage — the
            // whole point of the mechanic is that positioning, not aim,
            // decides whether this hit counts.
            if (!bossWeakAligned.current) {
              deflectBossHit(mesh.position.clone());
              continue;
            }
            // One hit = one point of boss health, same "every hit counts
            // the same" rule as a regular enemy's own one-shot death — the
            // boss is just a much bigger health pool, not tougher per hit.
            bossHealth.current = Math.max(0, bossHealth.current - 1);
            useGameStore.getState().damageBoss(1);
            explosions.trigger(mesh.position.clone(), COLORS.amber);
            explosions.trigger(mesh.position.clone(), COLORS.enemyBolt);
            sound.enemyHit();
            // A big, mostly-stationary target that just keeps absorbing
            // hits with no feedback beyond a small spark and a shrinking
            // number reads as dull — the recoil scale-pop (see
            // bossHitFlashUntil's own comment) plus a small shake gives
            // every landed hit real, immediate weight, the same way a
            // regular enemy's own explosion+kill already does in one shot.
            bossHitFlashUntil.current = simTime.current + 0.15;
            addShake(0.12);
            if (bossHealth.current <= 0) defeatBossNow(formation);
            continue;
          }
        }

        for (let e = 0; e < ENEMY_COUNT; e++) {
          if (!enemyAlive.current[e]) continue;
          const dive = diveWorldPos.current[e];
          const local = layout[e];
          const ex = dive ? dive.x : formation.position.x + local[0];
          const ey = dive ? dive.y : formation.position.y + local[1];
          const ez = dive ? dive.z : formation.position.z + local[2];
          const dx = mesh.position.x - ex;
          const dy = mesh.position.y - ey;
          const dz = mesh.position.z - ez;
          if (dx * dx + dy * dy + dz * dz <= HIT_RADIUS.playerProjectileVsEnemy ** 2) {
            playerBolts.current.active[i] = false;
            mesh.visible = false;
            applyEnemyHit(formation, e);
            break;
          }
        }
      }

      // --- grenade: move, tumble, detonate on impact or its own fuse ---------
      // Reuses the same pool-movement idiom as the bolt pools above (this
      // is still just "a thing that flies in a straight line"), but a
      // grenade's own OUTCOME on contact is a blast radius (detonateGrenade)
      // rather than an instant single-target kill, and it also goes off on
      // its own past GRENADE.maxRange even if it never hits anything —
      // exactly like a thrown grenade's own fuse, not a shot that just
      // keeps flying forever.
      for (let i = 0; i < grenadePool.current.refs.length; i++) {
        if (!grenadePool.current.active[i]) continue;
        const mesh = grenadePool.current.refs[i].current;
        if (!mesh) continue;
        mesh.position.z += grenadePool.current.dir * grenadePool.current.speed * delta;
        mesh.rotation.x += delta * 6; // tumbling roll, purely cosmetic
        mesh.rotation.z += delta * 4;

        let detonate = grenadeLaunchZ.current[i] - mesh.position.z >= GRENADE.maxRange;

        if (!detonate && tryHitShield(mesh.position.x, mesh.position.y, mesh.position.z)) {
          detonate = true;
        }

        if (!detonate) {
          for (let e = 0; e < ENEMY_COUNT; e++) {
            if (!enemyAlive.current[e]) continue;
            const detached = diveWorldPos.current[e] ?? flankWorldPos.current[e];
            const local = layout[e];
            const ex = detached ? detached.x : formation.position.x + local[0];
            const ey = detached ? detached.y : formation.position.y + local[1];
            const ez = detached ? detached.z : formation.position.z + local[2];
            const dx = mesh.position.x - ex;
            const dy = mesh.position.y - ey;
            const dz = mesh.position.z - ez;
            if (dx * dx + dy * dy + dz * dz <= HIT_RADIUS.playerProjectileVsEnemy ** 2) {
              detonate = true;
              break;
            }
          }
        }

        if (!detonate && bossActive.current && bossRef.current) {
          const dx = mesh.position.x - bossRef.current.position.x;
          const dy = mesh.position.y - bossRef.current.position.y;
          const dz = mesh.position.z - bossRef.current.position.z;
          if (dx * dx + dy * dy + dz * dz <= BOSS.hitRadius ** 2) detonate = true;
        }

        if (detonate) {
          grenadePool.current.active[i] = false;
          mesh.visible = false;
          detonateGrenade(formation, mesh.position.clone());
        }
      }

      // --- pickups: drift toward the ship, catch on contact, expire otherwise --
      for (const slot of pickups.current) {
        if (!slot.active) continue;
        const mesh = slot.ref.current;
        if (!mesh) continue;

        slot.age += delta;
        mesh.position.z += PICKUP.speed * delta;
        // Soft homing assist: pulls toward wherever the ship IS right now,
        // not a locked-in intercept course — still has to be roughly in the
        // way for this to close the gap before the lifetime runs out.
        mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, ship.position.x, PICKUP.homingRate * delta);
        mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, ship.position.y, PICKUP.homingRate * delta);
        mesh.rotation.y += delta * 2.4;
        mesh.rotation.x += delta * 1.1;
        // The nova bomb's ring spins on its own local axis, independent of
        // the whole capsule's own tumble above — see Pickup.tsx's own
        // comment on why that's what actually sells "orbiting" rather than
        // just another static shape riding along.
        if (slot.kind === "bomb") {
          const ring = mesh.getObjectByName("bomb-ring");
          if (ring) ring.rotation.z += delta * 4;
        }

        if (slot.age >= PICKUP.lifetime || mesh.position.z > ship.position.z + 6) {
          slot.active = false;
          mesh.visible = false;
          continue;
        }

        const dx = mesh.position.x - ship.position.x;
        const dy = mesh.position.y - ship.position.y;
        const dz = mesh.position.z - ship.position.z;
        if (dx * dx + dy * dy + dz * dz <= PICKUP.radius ** 2) {
          slot.active = false;
          mesh.visible = false;
          if (slot.kind === "health") {
            explosions.trigger(ship.position.clone(), COLORS.pickupHealth);
            useGameStore.getState().collectHealth(PICKUP.healthRestore);
            sound.pickupHealth();
          } else if (slot.kind === "weapon") {
            explosions.trigger(ship.position.clone(), COLORS.pickupWeapon);
            weaponRef.current = { kind: slot.weaponKind, expiresAt: now + WEAPON.duration * 1000 };
            setShipAccentColor(ship, COLORS.pickupWeapon);
            useGameStore.getState().collectWeapon(slot.weaponKind, WEAPON.duration * 1000);
            sound.pickupWeapon();
          } else {
            // Nova bomb: detonates instantly rather than being equipped —
            // see triggerNovaBomb's own comment.
            explosions.trigger(ship.position.clone(), COLORS.pickupBomb);
            triggerNovaBomb(formation);
          }
        }
      }

      // --- enemy bolts: move, cull, hit-test against ship --------------------
      for (let i = 0; i < enemyBolts.current.refs.length; i++) {
        if (!enemyBolts.current.active[i]) continue;
        const mesh = enemyBolts.current.refs[i].current;
        if (!mesh) continue;
        mesh.position.z += enemyBolts.current.dir * enemyBolts.current.speed * delta;

        // Gravity anomaly (see ANOMALY in constants.ts) — same curve/
        // swallow rule as a player bolt above. Enemy fire getting pulled
        // off course too (not just the player's own) is what makes this
        // read as "the space itself is distorted," not a one-sided debuff.
        if (anomalyActive.current && anomalyRef.current) {
          if (applyAnomalyPull(mesh.position, anomalyRef.current.position, ANOMALY.boltPullPerSec, delta)) {
            enemyBolts.current.active[i] = false;
            mesh.visible = false;
            sound.anomalyConsume();
            continue;
          }
        }

        // Tracks the ship's current z (it now moves fore/aft via Z/C), not
        // the fixed spawn constant — otherwise this cull point drifts out of
        // sync with wherever the ship actually is.
        if (mesh.position.z > ship.position.z + 6) {
          enemyBolts.current.active[i] = false;
          mesh.visible = false;
          continue;
        }

        if (tryHitShield(mesh.position.x, mesh.position.y, mesh.position.z)) {
          enemyBolts.current.active[i] = false;
          mesh.visible = false;
          continue;
        }

        // While invulnerable (just respawned), bolts pass straight through —
        // no collision, no damage — rather than colliding but silently
        // no-op'ing on damageShip's own guard, so it visually reads as
        // "phased out," not "hits landing that just don't seem to matter."
        if (invulnerable) continue;

        const dx = mesh.position.x - ship.position.x;
        const dy = mesh.position.y - ship.position.y;
        const dz = mesh.position.z - ship.position.z;
        if (dx * dx + dy * dy + dz * dz <= HIT_RADIUS.enemyProjectileVsShip ** 2) {
          enemyBolts.current.active[i] = false;
          mesh.visible = false;
          explosions.trigger(ship.position.clone(), COLORS.phosphor);
          const livesBefore = useGameStore.getState().lives;
          useGameStore.getState().damageShip(PROJECTILE.enemyDamage);
          const after = useGameStore.getState();
          // We already know (via the invulnerable check above) this damage
          // wasn't blocked — pick the sound by what it actually cost:
          // just health, a whole life, or the run itself.
          if (after.status === "gameover") {
            sound.gameOver();
            addShake(0.8);
          } else if (after.lives < livesBefore) {
            sound.lifeLost();
            addShake(0.5);
          } else {
            sound.playerHit();
            addShake(0.22);
            addHitFlash(ship, now);
          }
        }
      }

      // --- radar: off-screen threat awareness for flankers --------------------
      // Throttled to ~12Hz rather than every frame — see radarBlips' own
      // comment in gameStore.ts for why. A flanker's whole wide leg is
      // deliberately meant to spend real time outside the camera's own
      // view (see FLANKER.wideOffset) — this is what gives the player a
      // fair chance to react to it anyway.
      radarUpdateAccum.current += delta;
      if (radarUpdateAccum.current >= 0.08) {
        radarUpdateAccum.current = 0;
        radarProjScreenMatrix.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        radarFrustum.current.setFromProjectionMatrix(radarProjScreenMatrix.current);
        const blips: { dx: number; dz: number; offscreen: boolean }[] = [];
        for (let e = 0; e < ENEMY_COUNT; e++) {
          const pos = flankWorldPos.current[e];
          if (!pos) continue;
          blips.push({
            dx: pos.x - ship.position.x,
            dz: pos.z - ship.position.z,
            offscreen: !radarFrustum.current.containsPoint(pos),
          });
        }
        useGameStore.getState().setRadarBlips(blips);
      }
    } else {
      // Not playing (game over) — don't leave the ship frozen mid-blink from
      // whatever phase the respawn-invulnerability flash was in.
      ship.visible = true;
      if (lockReticleRef.current) lockReticleRef.current.visible = false;
    }

    // --- chase camera (keeps following even when not "playing", so the
    // game-over / cleared framing doesn't snap) -----------------------------
    // Undo last frame's shake offset first — camera.position is the smooth
    // lerp's own running accumulator, and without reverting the previous
    // frame's jitter before adding this frame's, the shake would
    // permanently drift that accumulator instead of just wobbling the
    // visible result around it (see camShakeOffset's own comment).
    camera.position.sub(camShakeOffset.current);

    // Pulled back and aimed further downrange than the ship-relative offsets
    // alone would give, so the gap to the wave actually reads on screen.
    const targetCamPos = new THREE.Vector3(
      ship.position.x * 0.4,
      ship.position.y + 4.5,
      ship.position.z + 10,
    );
    camera.position.lerp(targetCamPos, 1 - Math.pow(0.001, delta));
    camera.lookAt(ship.position.x * 0.5, ship.position.y + 1, ship.position.z - 30);

    // --- camera shake: decay the trauma, then re-derive this frame's jitter
    // from it (squared, for a punchier snap that tails off quickly rather
    // than a linear fade) — see addShake's own call sites for what feeds it.
    camShake.current = Math.max(0, camShake.current - delta * 2.2);
    const shakeMag = camShake.current * camShake.current * 0.55;
    camShakeOffset.current.set(
      shakeMag > 0.0005 ? (Math.random() * 2 - 1) * shakeMag : 0,
      shakeMag > 0.0005 ? (Math.random() * 2 - 1) * shakeMag : 0,
      0,
    );
    camera.position.add(camShakeOffset.current);
  });

  return (
    <>
      <color attach="background" args={[COLORS.background]} />
      {/* far must clear the formation's own start distance (~52 units from
          the camera at wave start) or the whole wave spawns fogged-out. */}
      <fog attach="fog" args={[COLORS.background, 25, 95]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[5, 10, 5]} intensity={0.7} />
      {/* Cool rim light from behind/below the wave — separates the ships'
          silhouettes from the dark background instead of leaving their far
          side a flat, shapeless black. */}
      <directionalLight position={[-6, -3, -20]} intensity={0.5} color={COLORS.rimLight} />

      <Nebula />
      <Starfield />

      <Ship ref={shipRef} />
      <AimLine ref={aimLineRef} />
      <LockReticle ref={lockReticleRef} />

      <Shields ref={shieldMeshRef} count={shieldLayout.length} />

      <group ref={formationRef} position={[0, 0, FORMATION.startZ]}>
        <pointLight color={COLORS.amber} intensity={3} distance={14} position={[0, 3.7, 1]} />
        <Enemies ref={enemiesRef} count={ENEMY_COUNT} />
      </group>

      {/* Plain world-space position, unlike Enemies above — there's only
          ever one of these at a time, so it doesn't need a shared parent
          group's transform the way 40 instanced enemies share the
          formation's sway/advance. Hidden by default; spawnWave shows it
          only during a boss wave (see BOSS in config/constants.ts). */}
      <Boss ref={bossRef} variant={bossVariantVisual} />
      <WeakPoint ref={weakPointRef} />
      <Anomaly ref={anomalyRef} />

      {playerBolts.current.refs.map((ref, i) => (
        <Projectile key={`p${i}`} ref={ref as React.RefObject<THREE.Mesh>} color={COLORS.phosphor} />
      ))}
      {enemyBolts.current.refs.map((ref, i) => (
        <EnemyBolt key={`e${i}`} ref={ref as React.RefObject<THREE.Group>} />
      ))}
      {grenadePool.current.refs.map((ref, i) => (
        <Grenade key={`g${i}`} ref={ref as React.RefObject<THREE.Group>} />
      ))}
      {pickups.current.map((p, i) => (
        <Pickup key={`pk${i}`} ref={p.ref as React.RefObject<THREE.Group>} />
      ))}

      <Explosions ref={explosions.ref} />
    </>
  );
}

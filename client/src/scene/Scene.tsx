import { createRef, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ARENA,
  BOSS,
  COLORS,
  DIVE,
  ENEMY_VARIANTS,
  FORMATION,
  HIT_RADIUS,
  PICKUP,
  PROJECTILE,
  SHIELD,
  SHIP,
  WAVE_SCALING,
  WEAPON,
} from "../config/constants";
import { useGameStore, type WeaponKind } from "../state/gameStore";
import { sound } from "../audio/sound";
import { useInput } from "../hooks/useInput";
import { Ship } from "./Ship";
import { Enemies, type EnemiesHandle } from "./Enemies";
import { Boss } from "./Boss";
import { Projectile } from "./Projectile";
import { EnemyBolt } from "./EnemyBolt";
import { Pickup } from "./Pickup";
import { Shields, type ShieldTierMeshes } from "./Shields";
import { Starfield } from "./Starfield";
import { Nebula } from "./Nebula";
import { Explosions, useExplosions } from "./Explosions";
import { AimLine, LockReticle, AIM_LINE_LENGTH } from "./Sight";

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

/** Per-wave difficulty: wave 1 is exactly the FORMATION baseline. */
function waveDifficulty(wave: number) {
  const growth = Math.min(
    WAVE_SCALING.maxAdvanceSpeedMultiplier,
    Math.pow(WAVE_SCALING.advanceSpeedGrowth, wave - 1),
  );
  const shrink = Math.pow(WAVE_SCALING.fireIntervalShrink, wave - 1);
  return {
    advanceSpeed: FORMATION.advanceSpeed * growth,
    fireMin: Math.max(WAVE_SCALING.minFireIntervalMin, FORMATION.enemyFireIntervalMin * shrink),
    fireMax: Math.max(WAVE_SCALING.minFireIntervalMax, FORMATION.enemyFireIntervalMax * shrink),
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
  // A short, sharp "recoil" scale-pop on every landed hit — distinct pacing
  // from the slow telegraph swell above (this decays over ~0.15s instead of
  // building over ~0.45s), giving a hit on the boss the same kind of
  // tactile "that connected" feedback a regular enemy's own explosion+kill
  // already has, which chipping away at one big health pool otherwise
  // lacks entirely. Simtime-based, like bossNextFireAt — 0 means inactive.
  const bossHitFlashUntil = useRef(0);

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

  // The currently-held weapon and when it expires — mirrored into the store
  // (see collectWeapon/revertWeapon) purely so the HUD can display it;
  // Scene's own firing logic reads this ref, not the store, every frame.
  const weaponRef = useRef<{ kind: WeaponKind; expiresAt: number }>({ kind: "base", expiresAt: 0 });

  const fireCooldown = useRef(0);
  const simTime = useRef(0);
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
      enemiesRef.current?.setEnemy(
        i,
        mask[i] ? layout[i] : null,
        undefined,
        isHeavy ? ENEMY_VARIANTS.heavy.scale : 1,
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

    // Every enemy's transform was just explicitly set above (alive or
    // hidden) regardless of whatever it was doing in the previous wave, so
    // no extra setEnemy call is needed here — just the bookkeeping, plus a
    // fresh grace period before the new wave's first diver can launch.
    for (let e = 0; e < ENEMY_COUNT; e++) {
      diveState.current[e] = null;
      diveWorldPos.current[e] = null;
    }
    nextDiveAt.current = DIVE.graceAfterWaveStart + Math.random() * (DIVE.cooldownMax - DIVE.cooldownMin);

    if (isBossWave) {
      // Health grows on every repeat encounter (wave 10, 15, ...), same
      // escalating-difficulty spirit as WAVE_SCALING for the ordinary
      // formation — encounterNumber is 1 the first time (wave 5), 2 the
      // second (wave 10), etc.
      const encounterNumber = wave / BOSS.waveInterval;
      const maxHealth = BOSS.baseHealth + (encounterNumber - 1) * BOSS.healthGrowthPerEncounter;
      bossActive.current = true;
      bossHealth.current = maxHealth;
      bossHitFlashUntil.current = 0;
      bossSweepDir.current = Math.random() < 0.5 ? -1 : 1;
      // Scheduled the same way columnNextFire is just above: a raw value,
      // implicitly relative to the simTime.current = 0 this function just
      // set.
      bossNextFireAt.current = BOSS.fireIntervalMin + Math.random() * (BOSS.fireIntervalMax - BOSS.fireIntervalMin);
      if (bossRef.current) {
        bossRef.current.visible = true;
        bossRef.current.scale.setScalar(BOSS.visualScale);
        bossRef.current.rotation.set(0, 0, 0);
        bossRef.current.position.set(0, (ARENA.minY + ARENA.maxY) / 2, FORMATION.startZ);
      }
      useGameStore.getState().setBoss(true, maxHealth, maxHealth);
    } else {
      bossActive.current = false;
      if (bossRef.current) bossRef.current.visible = false;
      useGameStore.getState().setBoss(false, 0, 0);
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
    options?: { forceLethal?: boolean; noDrop?: boolean },
  ) {
    const dive = diveWorldPos.current[e];
    const local = layout[e];
    const ex = dive ? dive.x : formation.position.x + local[0];
    const ey = dive ? dive.y : formation.position.y + local[1];
    const ez = dive ? dive.z : formation.position.z + local[2];

    const wasHeavy = enemyIsHeavy.current[e];
    enemyHealth.current[e] -= options?.forceLethal ? enemyHealth.current[e] : 1;
    if (enemyHealth.current[e] > 0) {
      explosions.trigger(new THREE.Vector3(ex, ey, ez), COLORS.amberDim);
      sound.enemyHit();
      return;
    }

    enemyAlive.current[e] = false;
    enemiesRef.current?.setEnemy(e, null);
    // Downing an enemy mid-dive gets a distinct cyan flash (instead of the
    // usual amber) and a score bonus — see DIVE.killBonus's own comment
    // for why: exposed and moving fast is a harder, more deserving target.
    // A Heavy's own killBonus stacks with that if it happened to be diving
    // too.
    const wasDiving = dive !== null;
    explosions.trigger(new THREE.Vector3(ex, ey, ez), wasDiving ? COLORS.accent : COLORS.amber);
    sound.enemyHit();
    if (wasDiving) {
      diveState.current[e] = null;
      diveWorldPos.current[e] = null;
    }

    const bonus = (wasDiving ? DIVE.killBonus : 0) + (wasHeavy ? ENEMY_VARIANTS.heavy.killBonus : 0);
    useGameStore.getState().registerKill(bonus);
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
    useGameStore.getState().defeatBoss(BOSS.killScore);
    spawnWave(formation, useGameStore.getState().wave);
    sound.waveClear();
    addShake(0.9);
    // Bullet time for the single biggest moment in a run — see
    // hitstopUntil's own comment for why this is reserved for exactly this
    // event and nothing more frequent.
    hitstopUntil.current = Date.now() + 450;
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
          diveStateArr: diveState.current,
          diveWorldPosArr: diveWorldPos.current,
          nextDiveAtRef: nextDiveAt,
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
        setShipAccentColor(ship, weaponRef.current.kind === "base" ? COLORS.phosphor : COLORS.pickupWeapon);
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
        nextDiveAt.current = simTime.current + DIVE.cooldownMin + Math.random() * (DIVE.cooldownMax - DIVE.cooldownMin);
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
          enemiesRef.current?.setEnemy(e, layout[e], undefined, enemyIsHeavy.current[e] ? ENEMY_VARIANTS.heavy.scale : 1);
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

      // --- boss wave: sweep, advance, and barrage fire ------------------------
      // See BOSS's own comment in config/constants.ts. Its barrage is just
      // ordinary pooled enemy bolts — the existing "enemy bolts: move, cull,
      // hit-test against ship" loop further down needs no changes at all to
      // handle them.
      if (bossActive.current && bossRef.current) {
        const boss = bossRef.current;
        // Side-to-side sweep, reversing at the arena's own bounds (minus a
        // margin for its own visual footprint) rather than a fixed patrol
        // width — automatically follows whatever ARENA.halfWidth is tuned
        // to instead of needing its own separately-tuned constant.
        const margin = ARENA.halfWidth * 0.25;
        boss.position.x += bossSweepDir.current * BOSS.sweepSpeed * delta;
        if (boss.position.x > ARENA.halfWidth - margin) {
          boss.position.x = ARENA.halfWidth - margin;
          bossSweepDir.current = -1;
        } else if (boss.position.x < -(ARENA.halfWidth - margin)) {
          boss.position.x = -(ARENA.halfWidth - margin);
          bossSweepDir.current = 1;
        }
        boss.position.z = Math.min(boss.position.z + BOSS.advanceSpeed * delta, BOSS.frontLineZ);
        // A small bob and a slow yaw — purely cosmetic, keeps what would
        // otherwise read as a flat sprite gliding on rails feeling alive.
        boss.rotation.y += delta * 0.15;
        boss.position.y = (ARENA.minY + ARENA.maxY) / 2 + Math.sin(simTime.current * 0.8) * 0.6;

        // Two independent scale effects combine multiplicatively into one
        // final transform: the slow telegraph swell (below) building toward
        // each barrage, and the sharp per-hit recoil pop (see
        // bossHitFlashUntil's own comment) — unrelated timings, so neither
        // resets or fights the other by sharing a single scale write.
        let scaleMultiplier = 1;

        // Telegraph: a visible "winding up" swell in the last
        // BOSS.telegraphDuration seconds before each barrage — an
        // ever-growing scale pulse (transform-only, same trick as the
        // Heavy variant's own bigger scale, so no material plumbing is
        // needed) that peaks exactly at the instant it fires, then snaps
        // back to normal. Gives a real read-and-react dodge window instead
        // of the barrage just appearing with zero warning.
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

        if (simTime.current >= bossNextFireAt.current) {
          bossNextFireAt.current =
            simTime.current + BOSS.fireIntervalMin + Math.random() * (BOSS.fireIntervalMax - BOSS.fireIntervalMin);
          // No explicit scale reset needed here — the combined
          // telegraph+hit-flash multiplier above already recomputes the
          // correct scale fresh every frame from these refs directly, so
          // rescheduling bossNextFireAt is enough to fall out of the
          // telegraph condition on its own next frame.
          // A fanned barrage, not a single shot — the boss occupying one
          // enemy "slot" worth of danger the whole fight would otherwise
          // undersell replacing 40 enemies with it.
          const half = (BOSS.spreadCount - 1) / 2;
          for (let i = 0; i < BOSS.spreadCount; i++) {
            const offsetX = (i - half) * (BOSS.spreadWidth / (BOSS.spreadCount - 1));
            spawn(enemyBolts.current, new THREE.Vector3(boss.position.x + offsetX, boss.position.y, boss.position.z));
          }
          sound.enemyFire();
        }
      }

      // "The wave broke through" means a real alive enemy actually reached
      // the ship (see HIT_RADIUS.enemyVsShip's own comment for why this
      // replaced a fixed depth-only check) — not an abstract line the
      // formation's own position crossed regardless of where the ship
      // happened to be standing. The formation is flat in z (every alive
      // enemy shares formation.position.z), so only x/y actually vary here.
      // A diving enemy's real (possibly detached-from-formation) position
      // takes priority when set — this is also exactly how a diver that
      // swoops right up to the ship costs a life, through the same check a
      // stationary formation reaching the front line already uses.
      let enemyReachedShip = false;
      for (let e = 0; e < ENEMY_COUNT; e++) {
        if (!enemyAlive.current[e]) continue;
        const dive = diveWorldPos.current[e];
        const local = layout[e];
        const ex = dive ? dive.x : formation.position.x + local[0];
        const ey = dive ? dive.y : formation.position.y + local[1];
        const ez = dive ? dive.z : formation.position.z + local[2];
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
              enemiesRef.current?.setEnemy(e, layout[e], undefined, enemyIsHeavy.current[e] ? ENEMY_VARIANTS.heavy.scale : 1);
            }
          }
          nextDiveAt.current = DIVE.graceAfterWaveStart + Math.random() * (DIVE.cooldownMax - DIVE.cooldownMin);

          // A boss fight in progress: push it back to its own starting
          // position/timers the same way the formation just was, but its
          // health is untouched — only position resets on a life lost,
          // never progress, matching the ordinary formation's own rule
          // (kills/shield damage also survive this reset).
          if (bossActive.current && bossRef.current) {
            bossRef.current.position.set(0, (ARENA.minY + ARENA.maxY) / 2, FORMATION.startZ);
            bossSweepDir.current = Math.random() < 0.5 ? -1 : 1;
            bossNextFireAt.current =
              BOSS.fireIntervalMin + Math.random() * (BOSS.fireIntervalMax - BOSS.fireIntervalMin);
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
          const dive = diveWorldPos.current[e];
          const local = layout[e];
          const ex = dive ? dive.x : formation.position.x + local[0];
          const ey = dive ? dive.y : formation.position.y + local[1];
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
          const dive = diveWorldPos.current[lockedEnemy];
          const local = layout[lockedEnemy];
          lockReticleRef.current.visible = true;
          lockReticleRef.current.scale.setScalar(1);
          lockReticleRef.current.position.set(
            dive ? dive.x : formation.position.x + local[0],
            dive ? dive.y : formation.position.y + local[1],
            dive ? dive.z : formation.position.z + local[2],
          );
        } else {
          lockReticleRef.current.visible = false;
        }
      }

      // --- enemy firing: at most one shooter per column -----------------------
      for (let col = 0; col < FORMATION.cols; col++) {
        if (simTime.current < columnNextFire.current[col]) continue;

        // Any alive, non-diving enemy in the column may take this shot
        // (picked at random) — not always the frontmost, so fire doesn't
        // monotonously come from the same row for as long as it survives. A
        // diving enemy is excluded: it's off flying its own attack run, not
        // sitting at its formation slot, and already gets its own dedicated
        // shot at the peak of that dive (see the dive-update block above).
        const aliveInColumn: number[] = [];
        for (let row = 0; row < FORMATION.rows; row++) {
          const idx = row * FORMATION.cols + col;
          if (enemyAlive.current[idx] && !diveState.current[idx]) aliveInColumn.push(idx);
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
      <Boss ref={bossRef} />

      {playerBolts.current.refs.map((ref, i) => (
        <Projectile key={`p${i}`} ref={ref as React.RefObject<THREE.Mesh>} color={COLORS.phosphor} />
      ))}
      {enemyBolts.current.refs.map((ref, i) => (
        <EnemyBolt key={`e${i}`} ref={ref as React.RefObject<THREE.Group>} />
      ))}
      {pickups.current.map((p, i) => (
        <Pickup key={`pk${i}`} ref={p.ref as React.RefObject<THREE.Group>} />
      ))}

      <Explosions ref={explosions.ref} />
    </>
  );
}

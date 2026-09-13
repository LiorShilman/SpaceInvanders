import { createRef, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ARENA, COLORS, FORMATION, HIT_RADIUS, PROJECTILE, SHIELD, SHIP, WAVE_SCALING } from "../config/constants";
import { useGameStore } from "../state/gameStore";
import { useKeyboard } from "../hooks/useKeyboard";
import { Ship } from "./Ship";
import { Enemy } from "./Enemy";
import { Projectile } from "./Projectile";
import { ShieldBlock } from "./ShieldBlock";
import { Starfield } from "./Starfield";
import { Nebula } from "./Nebula";
import { Explosions, useExplosions } from "./Explosions";
import { AimLine, LockReticle, AIM_LINE_CENTER_Z } from "./Sight";

// How close (in x/y only, ignoring depth) an enemy needs to be to the ship's
// current firing lane before the lock reticle latches onto it — generous
// relative to HIT_RADIUS since jitter means enemies aren't grid-perfect, and
// this is a "you're roughly lined up" cue, not a hit guarantee.
const LOCK_RADIUS = 1.0;

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

/** Per-wave difficulty: wave 1 is exactly the FORMATION baseline. */
function waveDifficulty(wave: number) {
  const growth = Math.pow(WAVE_SCALING.advanceSpeedGrowth, wave - 1);
  const shrink = Math.pow(WAVE_SCALING.fireIntervalShrink, wave - 1);
  return {
    advanceSpeed: FORMATION.advanceSpeed * growth,
    fireMin: Math.max(WAVE_SCALING.minFireIntervalMin, FORMATION.enemyFireIntervalMin * shrink),
    fireMax: Math.max(WAVE_SCALING.minFireIntervalMax, FORMATION.enemyFireIntervalMax * shrink),
  };
}

interface Pool {
  refs: React.RefObject<THREE.Mesh | null>[];
  active: boolean[];
  dir: number; // +1 (toward player) or -1 (toward formation)
  speed: number;
}

function makePool(size: number, dir: number, speed: number): Pool {
  return {
    refs: Array.from({ length: size }, () => createRef<THREE.Mesh>()),
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

export function Scene() {
  const input = useKeyboard();
  const { camera } = useThree();

  const shipRef = useRef<THREE.Group>(null);
  const formationRef = useRef<THREE.Group>(null);
  const aimLineRef = useRef<THREE.Mesh>(null);
  const lockReticleRef = useRef<THREE.Group>(null);
  const explosions = useExplosions();
  const enemyRefs = useMemo(
    () => Array.from({ length: ENEMY_COUNT }, () => createRef<THREE.Group>()),
    [],
  );
  const layout = useMemo(buildFormationLayout, []);

  const shieldLayout = useMemo(buildShieldLayout, []);
  const shieldRefs = useMemo(
    () => Array.from({ length: shieldLayout.length }, () => createRef<THREE.Mesh>()),
    [shieldLayout.length],
  );
  const shieldAlive = useRef<boolean[]>(Array.from({ length: shieldLayout.length }, () => true));

  const enemyAlive = useRef<boolean[]>(Array.from({ length: ENEMY_COUNT }, () => true));
  // At most one shooter per column at a time (a random alive enemy in that
  // column, picked fresh each time) — one timer per column, not per enemy,
  // so at most FORMATION.cols shots are ever in the air from the wave at
  // once instead of up to ENEMY_COUNT independent emitters firing in an
  // unreadable blur.
  const columnNextFire = useRef<number[]>(Array.from({ length: FORMATION.cols }, () => 0));
  const aliveCount = useRef(ENEMY_COUNT);

  const playerBolts = useRef<Pool>(makePool(PROJECTILE.poolSize, -1, PROJECTILE.playerSpeed));
  const enemyBolts = useRef<Pool>(makePool(PROJECTILE.poolSize, 1, PROJECTILE.enemySpeed));

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

    for (let i = 0; i < ENEMY_COUNT; i++) {
      enemyAlive.current[i] = true;
      const mesh = enemyRefs[i].current;
      if (mesh) mesh.visible = true;
    }
    aliveCount.current = ENEMY_COUNT;

    for (let i = 0; i < shieldLayout.length; i++) {
      shieldAlive.current[i] = true;
      const mesh = shieldRefs[i].current;
      if (mesh) mesh.visible = true;
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

    fireCooldown.current = 0;
    simTime.current = 0;
    useGameStore.getState().setEnemiesRemaining(ENEMY_COUNT);
  }

  /**
   * Absorbs a shot — from either side, same as the arcade original — into
   * whichever alive shield block it's touching. Returns true (and consumes
   * that block) on a hit, so the caller knows to stop the bolt there instead
   * of letting it continue toward the ship or the wave.
   */
  function tryHitShield(x: number, y: number, z: number): boolean {
    for (let i = 0; i < shieldLayout.length; i++) {
      if (!shieldAlive.current[i]) continue;
      const [bx, by, bz] = shieldLayout[i];
      const dx = x - bx;
      const dy = y - by;
      const dz = z - bz;
      if (dx * dx + dy * dy + dz * dz <= SHIELD.hitRadius ** 2) {
        shieldAlive.current[i] = false;
        const mesh = shieldRefs[i].current;
        if (mesh) mesh.visible = false;
        return true;
      }
    }
    return false;
  }

  useFrame((_state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30); // clamp to avoid huge steps on tab-switch
    const status = useGameStore.getState().status;
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

    if (status === "playing") {
      simTime.current += delta;

      if (import.meta.env.DEV) {
        // Console/debugging convenience only — never included in a
        // production build (see also __gameStore in main.tsx).
        (window as unknown as { __nexusDebug?: unknown }).__nexusDebug = {
          simTime: simTime.current,
          simTimeRef: simTime,
          aliveCount: aliveCount.current,
          shipRef: ship,
          formationRef: formation,
        };
      }

      // --- ship movement -------------------------------------------------
      const move = new THREE.Vector3(
        (input.current.right ? 1 : 0) - (input.current.left ? 1 : 0),
        (input.current.up ? 1 : 0) - (input.current.down ? 1 : 0),
        0,
      );
      if (move.lengthSq() > 0) {
        ship.position.x += move.x * SHIP.speed * delta;
        ship.position.y += move.y * SHIP.speed * delta;
        ship.position.x = THREE.MathUtils.clamp(ship.position.x, -ARENA.halfWidth, ARENA.halfWidth);
        ship.position.y = THREE.MathUtils.clamp(ship.position.y, ARENA.minY, ARENA.maxY);
      }
      ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -move.x * 0.35, 0.15);

      // --- player firing ---------------------------------------------------
      fireCooldown.current -= delta;
      if (input.current.fire && fireCooldown.current <= 0) {
        fireCooldown.current = SHIP.fireCooldown;
        spawn(
          playerBolts.current,
          new THREE.Vector3(ship.position.x, ship.position.y, ship.position.z - 1),
        );
      }

      // --- formation sway + advance ----------------------------------------
      formation.position.x = Math.sin(simTime.current * FORMATION.swaySpeed) * FORMATION.swayAmplitude;
      formation.position.z = FORMATION.startZ + simTime.current * currentDifficulty.current.advanceSpeed;

      if (formation.position.z >= FORMATION.invadeZ) {
        // The wave reached the player line — the run is over.
        useGameStore.getState().damageShip(SHIP.maxHealth);
      }

      // --- aim sight: a real 3D line down the ship's exact firing lane, plus
      // a lock reticle on whichever enemy currently sits in it. Camera
      // perspective makes eyeballing "what am I even under" from the ship's
      // screen position alone unreliable — this draws the real answer.
      if (aimLineRef.current) {
        aimLineRef.current.position.set(ship.position.x, ship.position.y, AIM_LINE_CENTER_Z);
      }
      if (lockReticleRef.current) {
        let lockedEnemy = -1;
        let lockedDistSq = LOCK_RADIUS * LOCK_RADIUS;
        for (let e = 0; e < ENEMY_COUNT; e++) {
          if (!enemyAlive.current[e]) continue;
          const local = layout[e];
          const ex = formation.position.x + local[0];
          const ey = formation.position.y + local[1];
          const dx = ship.position.x - ex;
          const dy = ship.position.y - ey;
          const distSq = dx * dx + dy * dy;
          if (distSq <= lockedDistSq) {
            lockedDistSq = distSq;
            lockedEnemy = e;
          }
        }
        if (lockedEnemy >= 0) {
          const local = layout[lockedEnemy];
          lockReticleRef.current.visible = true;
          lockReticleRef.current.position.set(
            formation.position.x + local[0],
            formation.position.y + local[1],
            formation.position.z + local[2],
          );
        } else {
          lockReticleRef.current.visible = false;
        }
      }

      // --- enemy firing: at most one shooter per column -----------------------
      for (let col = 0; col < FORMATION.cols; col++) {
        if (simTime.current < columnNextFire.current[col]) continue;

        // Any alive enemy in the column may take this shot (picked at
        // random) — not always the frontmost, so fire doesn't monotonously
        // come from the same row for as long as it survives.
        const aliveInColumn: number[] = [];
        for (let row = 0; row < FORMATION.rows; row++) {
          const idx = row * FORMATION.cols + col;
          if (enemyAlive.current[idx]) aliveInColumn.push(idx);
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

        for (let e = 0; e < ENEMY_COUNT; e++) {
          if (!enemyAlive.current[e]) continue;
          const local = layout[e];
          const ex = formation.position.x + local[0];
          const ey = formation.position.y + local[1];
          const ez = formation.position.z + local[2];
          const dx = mesh.position.x - ex;
          const dy = mesh.position.y - ey;
          const dz = mesh.position.z - ez;
          if (dx * dx + dy * dy + dz * dz <= HIT_RADIUS.playerProjectileVsEnemy ** 2) {
            enemyAlive.current[e] = false;
            const enemyMesh = enemyRefs[e].current;
            if (enemyMesh) enemyMesh.visible = false;
            playerBolts.current.active[i] = false;
            mesh.visible = false;
            explosions.trigger(new THREE.Vector3(ex, ey, ez), COLORS.amber);

            useGameStore.getState().addScore(100);
            aliveCount.current -= 1;
            useGameStore.getState().setEnemiesRemaining(aliveCount.current);
            if (aliveCount.current <= 0) {
              useGameStore.getState().advanceWave();
              spawnWave(formation, useGameStore.getState().wave);
            }
            break;
          }
        }
      }

      // --- enemy bolts: move, cull, hit-test against ship --------------------
      for (let i = 0; i < enemyBolts.current.refs.length; i++) {
        if (!enemyBolts.current.active[i]) continue;
        const mesh = enemyBolts.current.refs[i].current;
        if (!mesh) continue;
        mesh.position.z += enemyBolts.current.dir * enemyBolts.current.speed * delta;

        if (mesh.position.z > ARENA.shipZ + 6) {
          enemyBolts.current.active[i] = false;
          mesh.visible = false;
          continue;
        }

        if (tryHitShield(mesh.position.x, mesh.position.y, mesh.position.z)) {
          enemyBolts.current.active[i] = false;
          mesh.visible = false;
          continue;
        }

        const dx = mesh.position.x - ship.position.x;
        const dy = mesh.position.y - ship.position.y;
        const dz = mesh.position.z - ship.position.z;
        if (dx * dx + dy * dy + dz * dz <= HIT_RADIUS.enemyProjectileVsShip ** 2) {
          enemyBolts.current.active[i] = false;
          mesh.visible = false;
          explosions.trigger(ship.position.clone(), COLORS.phosphor);
          useGameStore.getState().damageShip(PROJECTILE.enemyDamage);
        }
      }
    } else if (lockReticleRef.current) {
      lockReticleRef.current.visible = false;
    }

    // --- chase camera (keeps following even when not "playing", so the
    // game-over / cleared framing doesn't snap) -----------------------------
    // Pulled back and aimed further downrange than the ship-relative offsets
    // alone would give, so the gap to the wave actually reads on screen.
    const targetCamPos = new THREE.Vector3(
      ship.position.x * 0.4,
      ship.position.y + 4.5,
      ship.position.z + 10,
    );
    camera.position.lerp(targetCamPos, 1 - Math.pow(0.001, delta));
    camera.lookAt(ship.position.x * 0.5, ship.position.y + 1, ship.position.z - 30);
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

      {shieldLayout.map((pos, i) => (
        <ShieldBlock key={i} ref={shieldRefs[i]} position={pos} />
      ))}

      <group ref={formationRef} position={[0, 0, FORMATION.startZ]}>
        <pointLight color={COLORS.amber} intensity={3} distance={14} position={[0, 3.7, 1]} />
        {layout.map((pos, i) => (
          <Enemy key={i} ref={enemyRefs[i]} position={pos} />
        ))}
      </group>

      {playerBolts.current.refs.map((ref, i) => (
        <Projectile key={`p${i}`} ref={ref} color={COLORS.phosphor} />
      ))}
      {enemyBolts.current.refs.map((ref, i) => (
        <Projectile key={`e${i}`} ref={ref} color={COLORS.amber} />
      ))}

      <Explosions ref={explosions.ref} />
    </>
  );
}

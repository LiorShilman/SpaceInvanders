import { createRef, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ARENA, COLORS, FORMATION, HIT_RADIUS, PROJECTILE, SHIP } from "../config/constants";
import { useGameStore } from "../state/gameStore";
import { useKeyboard } from "../hooks/useKeyboard";
import { Ship } from "./Ship";
import { Enemy } from "./Enemy";
import { Projectile } from "./Projectile";
import { Starfield } from "./Starfield";

const ENEMY_COUNT = FORMATION.rows * FORMATION.cols;

/**
 * Fixed grid layout, centered on the formation's local origin, flat in Z —
 * see the note on FORMATION in config/constants.ts for why. The wave's own
 * sway + advance still moves it through real 3D space; individual enemies
 * just don't each carry their own static depth offset.
 */
function buildFormationLayout(): [number, number, number][] {
  const layout: [number, number, number][] = [];
  const maxCol = (FORMATION.cols - 1) / 2;
  for (let row = 0; row < FORMATION.rows; row++) {
    for (let col = 0; col < FORMATION.cols; col++) {
      const x = (col - maxCol) * FORMATION.spacingX;
      const y = 2.4 + row * FORMATION.spacingY;
      layout.push([x, y, 0]);
    }
  }
  return layout;
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
  const enemyRefs = useMemo(
    () => Array.from({ length: ENEMY_COUNT }, () => createRef<THREE.Group>()),
    [],
  );
  const layout = useMemo(buildFormationLayout, []);

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

  /** Re-arms the whole wave: called on first mount and on every "שחק שוב". */
  function resetWorld(ship: THREE.Group, formation: THREE.Group) {
    ship.position.set(0, (ARENA.minY + ARENA.maxY) / 2, ARENA.shipZ);
    ship.rotation.set(0, 0, 0);

    formation.position.set(0, 0, FORMATION.startZ);

    for (let i = 0; i < ENEMY_COUNT; i++) {
      enemyAlive.current[i] = true;
      const mesh = enemyRefs[i].current;
      if (mesh) mesh.visible = true;
    }
    aliveCount.current = ENEMY_COUNT;

    for (let col = 0; col < FORMATION.cols; col++) {
      columnNextFire.current[col] =
        FORMATION.enemyFireIntervalMin +
        Math.random() * (FORMATION.enemyFireIntervalMax - FORMATION.enemyFireIntervalMin);
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
      resetWorld(ship, formation);
    }
    prevStatus.current = status;

    if (status === "playing") {
      simTime.current += delta;

      if (import.meta.env.DEV) {
        // Console/debugging convenience only — never included in a
        // production build (see also __gameStore in main.tsx).
        (window as unknown as { __nexusDebug?: unknown }).__nexusDebug = {
          simTime: simTime.current,
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
      formation.position.z = FORMATION.startZ + simTime.current * FORMATION.advanceSpeed;

      if (formation.position.z >= FORMATION.invadeZ) {
        // The wave reached the player line — the run is over.
        useGameStore.getState().damageShip(SHIP.maxHealth);
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

        columnNextFire.current[col] =
          simTime.current +
          FORMATION.enemyFireIntervalMin +
          Math.random() * (FORMATION.enemyFireIntervalMax - FORMATION.enemyFireIntervalMin);

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

            useGameStore.getState().addScore(100);
            aliveCount.current -= 1;
            useGameStore.getState().setEnemiesRemaining(aliveCount.current);
            if (aliveCount.current <= 0) useGameStore.getState().clearWave();
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

        const dx = mesh.position.x - ship.position.x;
        const dy = mesh.position.y - ship.position.y;
        const dz = mesh.position.z - ship.position.z;
        if (dx * dx + dy * dy + dz * dz <= HIT_RADIUS.enemyProjectileVsShip ** 2) {
          enemyBolts.current.active[i] = false;
          mesh.visible = false;
          useGameStore.getState().damageShip(PROJECTILE.enemyDamage);
        }
      }
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
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 10, 5]} intensity={0.6} />

      <Starfield />

      <Ship ref={shipRef} />

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
    </>
  );
}

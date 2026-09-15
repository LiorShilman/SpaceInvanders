import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

const LEG_COUNT = 4;
const SCALE = 1.8; // matches the old per-enemy <group scale={1.8}> wrapper

/**
 * All 40 enemies, as instanced meshes (one per distinct part: outer shell,
 * inner shell, turret, eye, ring, legs) instead of ~9 individual <mesh>
 * elements per enemy (360 meshes total, one draw call each). Same visual
 * design as the old per-enemy Enemy.tsx, just re-expressed as instance
 * transforms — see Shields.tsx for the same technique applied to the
 * bunkers.
 *
 * Two COMPLETE sets of these parts exist — grunt and heavy — rather than
 * one shared set with a per-instance color, because a late-set
 * instanceColor attribute isn't reliably picked up by three.js's shader
 * recompile (confirmed via an onBeforeCompile diagnostic probe when this
 * was tried for Shields.tsx; that's why shields use static per-tier meshes
 * instead too). A Heavy's own color is a real, distinct material this way,
 * not a per-instance hack — see ENEMY_VARIANTS.heavy for why that
 * distinction matters (direct feedback: the size difference alone was too
 * subtle to spot in time). Every enemy lives in exactly one of the two
 * sets for its whole lifetime (never both, and it never changes which
 * once spawned) — setEnemy always explicitly hides the OTHER set's
 * instance for that index too, so there's no way for a stale transform in
 * the unused set to ever accidentally render.
 *
 * Every enemy shares an identical local part layout (only its own world
 * position differs, and per-leg rotation cycles through LEG_COUNT fixed
 * variants) — so each part's LOCAL matrix is computed once and reused,
 * composed with that enemy's world position per instance.
 */

const _dummy = new THREE.Object3D();
const _m = new THREE.Matrix4();
// Scratch objects for the optional dive-tilt rotation and heavy-variant
// scale in setEnemy — reused across calls the same way _dummy/_m are,
// rather than allocating fresh ones every frame for every diving enemy.
const _tiltEuler = new THREE.Euler();
const _tiltMatrix = new THREE.Matrix4();
const _scaleMatrix = new THREE.Matrix4();
const _hideMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

function localMatrix(
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Matrix4 {
  _dummy.position.set(position[0] * SCALE, position[1] * SCALE, position[2] * SCALE);
  _dummy.rotation.set(rotation[0], rotation[1], rotation[2]);
  _dummy.scale.set(scale[0] * SCALE, scale[1] * SCALE, scale[2] * SCALE);
  _dummy.updateMatrix();
  return _dummy.matrix.clone();
}

const PART_LOCAL = {
  shellOuter: localMatrix([0, 0, 0], [0, 0, 0], [1, 0.55, 1.25]),
  shellInner: localMatrix([0, -0.16, 0], [0, 0, 0], [0.92, 0.4, 1.1]),
  turret: localMatrix([0, 0.22, 0.35]),
  eye: localMatrix([0, 0.4, 0.35]),
  ring: localMatrix([0, 0, 0], [Math.PI / 2, 0, 0]),
};

const LEG_LOCAL = Array.from({ length: LEG_COUNT }, (_, i) => {
  const side = i < 2 ? -1 : 1;
  const along = i % 2 === 0 ? -1 : 1;
  return localMatrix([side * 0.5, -0.18, along * 0.18], [0, side * 0.5, side * 1.4]);
});

export interface EnemiesHandle {
  /** pos = null hides every part belonging to this enemy (scaled to zero).
   * `tilt` is an optional whole-enemy Euler rotation (pitch/yaw/roll)
   * applied on top of each part's own fixed local orientation — used for
   * the diving/flanking attack run's nose-down bank (see Scene.tsx); a
   * formation member just sitting in its slot never passes one. `scale` is
   * an optional uniform multiplier on top of the shared SCALE constant,
   * and `isHeavy` picks which of the two complete part-sets (see this
   * file's own top comment) this index actually renders in — both exist
   * for the Heavy variant (see ENEMY_VARIANTS in config/constants.ts) and
   * are omitted (or false/1) for every ordinary enemy. */
  setEnemy: (
    index: number,
    pos: [number, number, number] | null,
    tilt?: [number, number, number],
    scale?: number,
    isHeavy?: boolean,
  ) => void;
}

interface EnemiesProps {
  count: number;
}

/** One complete set of the six part refs — grunt or heavy (see this
 * file's own top comment for why there are two). */
interface PartRefs {
  shellOuter: React.RefObject<THREE.InstancedMesh | null>;
  shellInner: React.RefObject<THREE.InstancedMesh | null>;
  turret: React.RefObject<THREE.InstancedMesh | null>;
  eye: React.RefObject<THREE.InstancedMesh | null>;
  ring: React.RefObject<THREE.InstancedMesh | null>;
  legs: React.RefObject<THREE.InstancedMesh | null>;
}

/** Writes (or, when `matrix` is null, hides) instance `index` across every
 * part in one complete set. Shared by both the active set (a real
 * transform) and the inactive set (always hidden) on every setEnemy call. */
function writeSetInstance(set: PartRefs, index: number, matrix: THREE.Matrix4 | null) {
  const bodyParts: [React.RefObject<THREE.InstancedMesh | null>, THREE.Matrix4][] = [
    [set.shellOuter, PART_LOCAL.shellOuter],
    [set.shellInner, PART_LOCAL.shellInner],
    [set.turret, PART_LOCAL.turret],
    [set.eye, PART_LOCAL.eye],
    [set.ring, PART_LOCAL.ring],
  ];
  for (const [meshRef, local] of bodyParts) {
    const mesh = meshRef.current;
    if (!mesh) continue;
    mesh.setMatrixAt(index, matrix ? matrix.clone().multiply(local) : _hideMatrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  const legs = set.legs.current;
  if (legs) {
    for (let leg = 0; leg < LEG_COUNT; leg++) {
      legs.setMatrixAt(index * LEG_COUNT + leg, matrix ? matrix.clone().multiply(LEG_LOCAL[leg]) : _hideMatrix);
    }
    legs.instanceMatrix.needsUpdate = true;
  }
}

export const Enemies = forwardRef<EnemiesHandle, EnemiesProps>(function Enemies(
  { count },
  ref,
) {
  const grunt: PartRefs = {
    shellOuter: useRef<THREE.InstancedMesh>(null),
    shellInner: useRef<THREE.InstancedMesh>(null),
    turret: useRef<THREE.InstancedMesh>(null),
    eye: useRef<THREE.InstancedMesh>(null),
    ring: useRef<THREE.InstancedMesh>(null),
    legs: useRef<THREE.InstancedMesh>(null),
  };
  const heavy: PartRefs = {
    shellOuter: useRef<THREE.InstancedMesh>(null),
    shellInner: useRef<THREE.InstancedMesh>(null),
    turret: useRef<THREE.InstancedMesh>(null),
    eye: useRef<THREE.InstancedMesh>(null),
    ring: useRef<THREE.InstancedMesh>(null),
    legs: useRef<THREE.InstancedMesh>(null),
  };

  useImperativeHandle(ref, () => ({
    setEnemy(index, pos, tilt, scale, isHeavy) {
      // Translation composed with an optional whole-enemy tilt rotation
      // (the dive attack's nose-down bank) and an optional uniform scale
      // (the Heavy variant) — a stationary, ordinary formation member
      // passes neither, so this reduces to the plain translation it always
      // was.
      let worldTranslation: THREE.Matrix4 | null = null;
      if (pos) {
        _m.makeTranslation(pos[0], pos[1], pos[2]);
        if (tilt) _m.multiply(_tiltMatrix.makeRotationFromEuler(_tiltEuler.set(tilt[0], tilt[1], tilt[2])));
        if (scale && scale !== 1) _m.multiply(_scaleMatrix.makeScale(scale, scale, scale));
        worldTranslation = _m;
      }

      const activeSet = isHeavy ? heavy : grunt;
      const inactiveSet = isHeavy ? grunt : heavy;
      writeSetInstance(activeSet, index, worldTranslation);
      // Always explicitly hidden, even when pos is already null — cheap,
      // and guarantees this index can never render in both sets at once
      // regardless of call order or a missed edge case elsewhere.
      writeSetInstance(inactiveSet, index, null);
    },
  }));

  const shellOuterGeo = useMemo(() => new THREE.IcosahedronGeometry(0.42, 1), []);
  const shellInnerGeo = useMemo(() => new THREE.IcosahedronGeometry(0.4, 1), []);
  const turretGeo = useMemo(() => new THREE.ConeGeometry(0.16, 0.3, 6), []);
  const eyeGeo = useMemo(() => new THREE.SphereGeometry(0.15, 10, 8), []);
  const ringGeo = useMemo(() => new THREE.TorusGeometry(0.44, 0.035, 6, 16), []);
  const legGeo = useMemo(() => new THREE.CylinderGeometry(0.05, 0.03, 0.7, 5), []);

  return (
    <>
      {/* Metalness lowered and roughness raised across every enemy hull
          part here — same fix as the ship's own hull (see Ship.tsx's
          comment): at 0.5-0.6 metalness a surface only shows anything
          where a light happens to hit it at the right specular angle, and
          the eye/ring/turret glow was carrying the entire silhouette
          instead of the body shape itself. */}
      <instancedMesh ref={grunt.shellOuter} args={[shellOuterGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHull}
          emissive={COLORS.amberDim}
          emissiveIntensity={0.35}
          metalness={0.4}
          roughness={0.5}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={grunt.shellInner} args={[shellInnerGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial color={COLORS.enemyHullDark} metalness={0.35} roughness={0.65} flatShading />
      </instancedMesh>
      <instancedMesh ref={grunt.turret} args={[turretGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial color={COLORS.enemyHullDark} metalness={0.4} roughness={0.5} flatShading />
      </instancedMesh>
      <instancedMesh ref={grunt.eye} args={[eyeGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial color={COLORS.amber} emissive={COLORS.amber} emissiveIntensity={1.8} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={grunt.ring} args={[ringGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial color={COLORS.amber} emissive={COLORS.amber} emissiveIntensity={1.1} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={grunt.legs} args={[legGeo, undefined, count * LEG_COUNT]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHullDark}
          emissive={COLORS.amberDim}
          emissiveIntensity={0.3}
          metalness={0.35}
          roughness={0.65}
          flatShading
        />
      </instancedMesh>

      {/* Heavy variant — same six parts, a cold steel-blue/icy-white
          material set instead of the grunts' warm magenta-red/amber (see
          COLORS.enemyHeavy* for why: a real color difference reads at a
          glance from across the whole formation, not just the bigger
          silhouette scale already gives it). */}
      <instancedMesh ref={heavy.shellOuter} args={[shellOuterGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHeavyHull}
          emissive={COLORS.enemyHeavyAccent}
          emissiveIntensity={0.3}
          metalness={0.45}
          roughness={0.45}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={heavy.shellInner} args={[shellInnerGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial color={COLORS.enemyHeavyHullDark} metalness={0.4} roughness={0.6} flatShading />
      </instancedMesh>
      <instancedMesh ref={heavy.turret} args={[turretGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial color={COLORS.enemyHeavyHullDark} metalness={0.45} roughness={0.45} flatShading />
      </instancedMesh>
      <instancedMesh ref={heavy.eye} args={[eyeGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHeavyAccent}
          emissive={COLORS.enemyHeavyAccent}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={heavy.ring} args={[ringGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHeavyAccent}
          emissive={COLORS.enemyHeavyAccent}
          emissiveIntensity={1.1}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={heavy.legs} args={[legGeo, undefined, count * LEG_COUNT]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHeavyHullDark}
          emissive={COLORS.enemyHeavyAccent}
          emissiveIntensity={0.25}
          metalness={0.4}
          roughness={0.6}
          flatShading
        />
      </instancedMesh>
    </>
  );
});

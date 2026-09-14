import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

const LEG_COUNT = 4;
const SCALE = 1.8; // matches the old per-enemy <group scale={1.8}> wrapper

/**
 * All 40 enemies, as six instanced meshes (one per distinct part: outer
 * shell, inner shell, turret, eye, ring, legs) instead of ~9 individual
 * <mesh> elements per enemy (360 meshes total, one draw call each). Same
 * visual design as the old per-enemy Enemy.tsx, just re-expressed as
 * instance transforms — see Shields.tsx for the same technique applied to
 * the bunkers.
 *
 * Every enemy shares an identical local part layout (only its own world
 * position differs, and per-leg rotation cycles through LEG_COUNT fixed
 * variants) — so each part's LOCAL matrix is computed once and reused,
 * composed with that enemy's world position per instance.
 */

const _dummy = new THREE.Object3D();
const _m = new THREE.Matrix4();

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
  /** pos = null hides every part belonging to this enemy (scaled to zero). */
  setEnemy: (index: number, pos: [number, number, number] | null) => void;
}

interface EnemiesProps {
  count: number;
}

export const Enemies = forwardRef<EnemiesHandle, EnemiesProps>(function Enemies(
  { count },
  ref,
) {
  const shellOuterRef = useRef<THREE.InstancedMesh>(null);
  const shellInnerRef = useRef<THREE.InstancedMesh>(null);
  const turretRef = useRef<THREE.InstancedMesh>(null);
  const eyeRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const legsRef = useRef<THREE.InstancedMesh>(null);

  useImperativeHandle(ref, () => ({
    setEnemy(index, pos) {
      const worldTranslation = pos ? _m.makeTranslation(pos[0], pos[1], pos[2]) : null;

      const bodyParts: [React.RefObject<THREE.InstancedMesh | null>, THREE.Matrix4][] = [
        [shellOuterRef, PART_LOCAL.shellOuter],
        [shellInnerRef, PART_LOCAL.shellInner],
        [turretRef, PART_LOCAL.turret],
        [eyeRef, PART_LOCAL.eye],
        [ringRef, PART_LOCAL.ring],
      ];
      for (const [meshRef, local] of bodyParts) {
        const mesh = meshRef.current;
        if (!mesh) continue;
        const matrix = worldTranslation ? worldTranslation.clone().multiply(local) : new THREE.Matrix4().makeScale(0, 0, 0);
        mesh.setMatrixAt(index, matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }

      const legs = legsRef.current;
      if (legs) {
        for (let leg = 0; leg < LEG_COUNT; leg++) {
          const matrix = worldTranslation
            ? worldTranslation.clone().multiply(LEG_LOCAL[leg])
            : new THREE.Matrix4().makeScale(0, 0, 0);
          legs.setMatrixAt(index * LEG_COUNT + leg, matrix);
        }
        legs.instanceMatrix.needsUpdate = true;
      }
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
      <instancedMesh ref={shellOuterRef} args={[shellOuterGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHull}
          emissive={COLORS.amberDim}
          emissiveIntensity={0.35}
          metalness={0.4}
          roughness={0.5}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={shellInnerRef} args={[shellInnerGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHullDark}
          metalness={0.35}
          roughness={0.65}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={turretRef} args={[turretGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHullDark}
          metalness={0.4}
          roughness={0.5}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={eyeRef} args={[eyeGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.amber}
          emissive={COLORS.amber}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={ringRef} args={[ringGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.amber}
          emissive={COLORS.amber}
          emissiveIntensity={1.1}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={legsRef} args={[legGeo, undefined, count * LEG_COUNT]} frustumCulled={false}>
        <meshStandardMaterial
          color={COLORS.enemyHullDark}
          emissive={COLORS.amberDim}
          emissiveIntensity={0.3}
          metalness={0.35}
          roughness={0.65}
          flatShading
        />
      </instancedMesh>
    </>
  );
});

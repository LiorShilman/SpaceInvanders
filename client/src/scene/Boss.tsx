import { forwardRef, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS } from "../config/constants";

/**
 * Visual-only, like Ship/Enemies — Scene drives this group's world position
 * imperatively via the forwarded ref every frame during a boss wave (see
 * BOSS in config/constants.ts). Unlike the 40-enemy formation, there's only
 * ever one of these on screen at a time, so it's plain JSX meshes rather
 * than Enemies.tsx's InstancedMesh trick — that trick exists purely to
 * avoid 40x draw calls, which doesn't apply to a single object.
 *
 * A much bigger, many-eyed cousin of the regular enemy model (same hull /
 * amber-energy material language, see Enemies.tsx's own comment on why
 * metalness is kept moderate rather than mirror-like) rather than an
 * unrelated design — reads immediately as "one of them, but huge," not a
 * completely different visual language showing up out of nowhere. Scene
 * applies BOSS.visualScale to the whole group once, the same way Enemies.tsx
 * bakes its own SCALE into every instance.
 */
export const Boss = forwardRef<THREE.Group>(function Boss(_props, ref) {
  const ringRef = useRef<THREE.Mesh>(null);
  // Self-animated rather than driven by Scene's own frame loop — purely
  // cosmetic (a slow equatorial spin), doesn't need to sync with anything
  // Scene tracks about the boss's actual gameplay state.
  useFrame((_state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30);
    if (ringRef.current) ringRef.current.rotation.z += delta * 0.5;
  });

  // Four turret/eye clusters ringed around the core — echoes each regular
  // enemy's single turret+eye, just repeated, so "hostile energy source"
  // reads the same way at a glance on something 4x the size.
  const turretPositions: [number, number, number][] = [
    [0.95, 0.32, 0.4],
    [-0.95, 0.32, 0.4],
    [0, 0.85, 0.15],
    [0, -0.6, 0.15],
  ];

  return (
    <group ref={ref}>
      <mesh castShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial
          color={COLORS.enemyHull}
          emissive={COLORS.amberDim}
          emissiveIntensity={0.4}
          metalness={0.4}
          roughness={0.5}
          flatShading
        />
      </mesh>
      <mesh scale={0.82}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={COLORS.enemyHullDark} metalness={0.35} roughness={0.65} flatShading />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.35, 0.09, 8, 28]} />
        <meshStandardMaterial
          color={COLORS.amber}
          emissive={COLORS.amber}
          emissiveIntensity={1.1}
          toneMapped={false}
        />
      </mesh>
      {turretPositions.map((pos, i) => (
        <group key={i} position={pos}>
          <mesh>
            <coneGeometry args={[0.32, 0.6, 6]} />
            <meshStandardMaterial color={COLORS.enemyHullDark} metalness={0.4} roughness={0.5} flatShading />
          </mesh>
          <mesh position={[0, 0.35, 0]}>
            <sphereGeometry args={[0.24, 10, 8]} />
            <meshStandardMaterial
              color={COLORS.amber}
              emissive={COLORS.amber}
              emissiveIntensity={1.8}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
});

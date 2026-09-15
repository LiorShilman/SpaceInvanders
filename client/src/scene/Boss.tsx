import { forwardRef, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS } from "../config/constants";

export type BossVariant = "sentinel" | "harrier";

interface BossProps {
  // Cosmetic-only — Scene tracks which variant is actually fighting in a
  // ref (bossVariant) for its own per-frame movement/fire logic, since that
  // needs to be authoritative the instant a new boss spawns with zero
  // React-render lag. This prop is fed from a SEPARATE piece of React
  // state that mirrors that ref (see Scene's bossVariantVisual) purely so
  // this material/geometry swap can happen at all — a plain ref mutation
  // here would never trigger the re-render needed to actually change what
  // renders. The one-frame-or-so lag between "boss is mechanically live"
  // and "looks like the right variant" is imperceptible in practice.
  variant?: BossVariant;
}

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
 *
 * Two variants (see BOSS.variants in config/constants.ts for the gameplay
 * side of this) share this one model rather than being separate
 * components — same skeleton, different accent color and silhouette, the
 * same relationship a Heavy enemy has to a regular one. The Sentinel (the
 * original) reads as a round, watchful area-denial turret; the Harrier
 * stretches the same core along its own forward axis and runs hotter
 * orange instead of magenta-red, reading as leaner and faster — matching
 * its actual behavior (quicker, more erratic movement and a single
 * precision-aimed shot instead of a wide barrage).
 */
export const Boss = forwardRef<THREE.Group, BossProps>(function Boss({ variant = "sentinel" }, ref) {
  const ringRef = useRef<THREE.Mesh>(null);
  const isHarrier = variant === "harrier";
  // Hotter orange for the Harrier, the same magenta-red family as every
  // regular enemy for the Sentinel — COLORS.enemyBolt already exists
  // specifically as "the hot orange enemy fire reads as distinct from the
  // enemies' own magenta-red body," which is exactly the distinction
  // wanted here too.
  const accent = isHarrier ? COLORS.enemyBolt : COLORS.amber;
  const accentDim = isHarrier ? COLORS.enemyBolt : COLORS.amberDim;

  // Self-animated rather than driven by Scene's own frame loop — purely
  // cosmetic (an equatorial spin, faster for the more aggressive Harrier),
  // doesn't need to sync with anything Scene tracks about the boss's
  // actual gameplay state.
  useFrame((_state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30);
    if (ringRef.current) ringRef.current.rotation.z += delta * (isHarrier ? 1.5 : 0.5);
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
      {/* Stretched along its own forward (z) axis for the Harrier — a
          leaner, more aerodynamic silhouette instead of the Sentinel's
          perfectly round one, reading as "built to move fast" at a glance
          before any color even registers. */}
      <mesh castShadow scale={isHarrier ? [0.85, 0.85, 1.35] : [1, 1, 1]}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial
          color={COLORS.enemyHull}
          emissive={accentDim}
          emissiveIntensity={0.4}
          metalness={0.4}
          roughness={0.5}
          flatShading
        />
      </mesh>
      <mesh scale={isHarrier ? [0.7, 0.7, 1.1] : [0.82, 0.82, 0.82]}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={COLORS.enemyHullDark} metalness={0.35} roughness={0.65} flatShading />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]} scale={isHarrier ? 0.82 : 1}>
        <torusGeometry args={[1.35, isHarrier ? 0.06 : 0.09, 8, 28]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.1} toneMapped={false} />
      </mesh>
      {turretPositions.map((pos, i) => (
        <group key={i} position={pos}>
          <mesh>
            <coneGeometry args={[0.32, 0.6, 6]} />
            <meshStandardMaterial color={COLORS.enemyHullDark} metalness={0.4} roughness={0.5} flatShading />
          </mesh>
          <mesh position={[0, 0.35, 0]}>
            <sphereGeometry args={[0.24, 10, 8]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.8} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
});

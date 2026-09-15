import { forwardRef, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS } from "../config/constants";

/**
 * Visual-only grenade. Scene owns a small pool of these (see GRENADE in
 * config/constants.ts) and drives position/visibility imperatively per
 * frame — same convention as Projectile.tsx/EnemyBolt.tsx. Deliberately a
 * round, dark-metal shell with a pulsing warm core rather than a bolt-like
 * beam or plasma glob: it needs to read as "a different KIND of thing" at
 * a glance, the same reasoning EnemyBolt's own comment gives for why enemy
 * fire isn't just a recolored player bolt — a lobbed explosive shouldn't
 * look like just a bigger shot.
 */
export const Grenade = forwardRef<THREE.Group>(function Grenade(_props, ref) {
  const coreRef = useRef<THREE.Mesh>(null);

  // Self-animated pulse, not driven by Scene's own frame loop — a purely
  // cosmetic "live fuse" tell, independent of whatever Scene tracks about
  // this grenade's actual flight/detonation state.
  useFrame((state) => {
    if (!coreRef.current) return;
    const mat = coreRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.6 + Math.sin(state.clock.elapsedTime * 14) * 0.4;
  });

  return (
    <group ref={ref} visible={false}>
      {/* The dark metal casing was originally a solid, opaque, lit
          (meshStandardMaterial) shell — which fully occluded the bright
          core sitting inside it AND, being both small and nearly black
          (COLORS.enemyHullDark) against open space, was itself almost
          impossible to spot. transparent + depthWrite={false} lets the
          glowing core underneath show straight through, the same
          "translucent shell around a bright core" trick EnemyBolt.tsx
          already uses for exactly this reason. Sized up from the original
          0.14/0.07 too — next to a 0.6-long player bolt or a 0.16-radius
          enemy bolt, those were too small to read at a glance while
          actually flying. */}
      <mesh>
        <icosahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial
          color={COLORS.enemyHullDark}
          metalness={0.6}
          roughness={0.4}
          flatShading
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshBasicMaterial color={COLORS.grenade} transparent opacity={1} toneMapped={false} />
      </mesh>
    </group>
  );
});

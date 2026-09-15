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
      <mesh>
        <icosahedronGeometry args={[0.14, 0]} />
        <meshStandardMaterial color={COLORS.enemyHullDark} metalness={0.5} roughness={0.5} flatShading />
      </mesh>
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color={COLORS.grenade} transparent opacity={1} toneMapped={false} />
      </mesh>
    </group>
  );
});

import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

/**
 * Visual-only enemy bolt. Previously reused the player's Projectile (same
 * thin cylinder, just a different color) — this gives enemy fire its own
 * silhouette instead: an elongated hot-orange plasma glob (soft translucent
 * shell around a bright near-white core) rather than a clean beam, so
 * "their shot" reads as a different KIND of thing from "my shot," not just
 * a different color of the same thing. Scene owns the pool and drives
 * position/visibility imperatively per frame — same convention as
 * Projectile.tsx.
 */
export const EnemyBolt = forwardRef<THREE.Group>(function EnemyBolt(_props, ref) {
  return (
    <group ref={ref} visible={false}>
      <mesh scale={[1, 1, 1.7]}>
        <sphereGeometry args={[0.16, 8, 8]} />
        <meshBasicMaterial color={COLORS.enemyBolt} transparent opacity={0.4} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh scale={[1, 1, 1.7]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshBasicMaterial color="#fff2df" toneMapped={false} />
      </mesh>
    </group>
  );
});

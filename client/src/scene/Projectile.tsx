import { forwardRef } from "react";
import * as THREE from "three";

interface ProjectileProps {
  color: string;
}

/**
 * Visual-only bolt. Scene owns an object pool of these — position, rotation
 * and visibility are all mutated imperatively per frame, never via props.
 */
export const Projectile = forwardRef<THREE.Mesh, ProjectileProps>(function Projectile(
  { color },
  ref,
) {
  return (
    <mesh ref={ref} visible={false} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.05, 0.05, 0.6, 6]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
});

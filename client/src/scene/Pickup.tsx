import { forwardRef } from "react";
import * as THREE from "three";

/**
 * Visual-only pickup capsule. Scene owns a shared pool of these (see
 * spawnPickup/PickupSlot in Scene.tsx) and mutates position, rotation,
 * visibility and color imperatively per frame/spawn, never via props — same
 * convention as Projectile.tsx. One shared shape serves every kind (health
 * or either weapon crate); only the material's color changes per spawn,
 * since a pooled slot is reused across different kinds over its lifetime.
 */
export const Pickup = forwardRef<THREE.Mesh>(function Pickup(_props, ref) {
  return (
    <mesh ref={ref} visible={false}>
      <octahedronGeometry args={[0.4, 0]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </mesh>
  );
});

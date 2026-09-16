import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

/**
 * The boss's exposed flank (see WEAKPOINT in config/constants.ts) — a
 * standalone world-space marker Scene positions and toggles imperatively
 * every frame, same convention as AimLine/LockReticle in Sight.tsx. NOT a
 * child of Boss.tsx's own group: Boss is purely a visual (like Ship/
 * Enemies), while "is the ship currently aligned with this" is real
 * gameplay state only Scene tracks.
 *
 * Two parts: a small marker that's always visible while a boss is active
 * (shows WHERE the flank currently is, so a player can track and lead it
 * even before lining up), and a soft halo that only appears once the ship
 * is actually inside the vulnerable arc — Scene toggles the halo via
 * userData.weakAligned (see setWeakPointAligned in Scene.tsx), the same
 * traverse-by-tag convention setShipAccentColor already uses for the
 * ship's own accent color.
 */
export const WeakPoint = forwardRef<THREE.Group>(function WeakPoint(_props, ref) {
  return (
    <group ref={ref} visible={false}>
      <mesh>
        <octahedronGeometry args={[0.16, 0]} />
        <meshBasicMaterial color={COLORS.weakPoint} toneMapped={false} />
      </mesh>
      <mesh userData={{ weakAligned: true }} visible={false}>
        <sphereGeometry args={[0.34, 12, 10]} />
        <meshBasicMaterial
          color={COLORS.weakPoint}
          transparent
          opacity={0.35}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
});

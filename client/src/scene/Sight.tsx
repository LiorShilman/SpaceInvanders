import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

// The geometry's own baked-in length — Scene rescales (scale.y) and
// repositions this every frame to span from the ship's current z (now
// movable via Z/C) down past the formation's furthest start.
export const AIM_LINE_LENGTH = 50;

/**
 * A real 3D laser-sight line along the ship's exact firing lane (constant
 * x/y, the same straight path every bolt actually travels) plus a lock-on
 * ring that Scene positions onto whichever enemy currently sits in that
 * lane. Camera perspective makes eyeballing "what column am I even under"
 * hard from the ship's screen position alone — this draws the real answer
 * instead of asking the player to guess it from an angle.
 */
export const AimLine = forwardRef<THREE.Mesh>(function AimLine(_props, ref) {
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]} renderOrder={-1}>
      <cylinderGeometry args={[0.02, 0.02, AIM_LINE_LENGTH, 6]} />
      <meshBasicMaterial
        color={COLORS.phosphor}
        transparent
        opacity={0.22}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
});

export const LockReticle = forwardRef<THREE.Group>(function LockReticle(_props, ref) {
  return (
    <group ref={ref} visible={false}>
      <mesh>
        <torusGeometry args={[0.85, 0.025, 6, 24]} />
        <meshBasicMaterial color={COLORS.phosphor} toneMapped={false} transparent opacity={0.85} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.85, 0.025, 6, 24]} />
        <meshBasicMaterial color={COLORS.phosphor} toneMapped={false} transparent opacity={0.85} />
      </mesh>
    </group>
  );
});

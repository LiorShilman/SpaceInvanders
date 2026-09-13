import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

/**
 * Visual-only placeholder art for a "Grunt" — a low-poly wireframe-accented
 * hull. Real ship models arrive in Phase 2 (see docs/GAME_PLAN.md §6).
 * Position is local to the parent formation group; visibility/alive state is
 * toggled imperatively by Scene via the forwarded ref.
 */
export const Enemy = forwardRef<THREE.Group, { position: [number, number, number] }>(
  function Enemy({ position }, ref) {
    return (
      <group ref={ref} position={position}>
        <mesh>
          <octahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial
            color={COLORS.amber}
            emissive={COLORS.amber}
            emissiveIntensity={1.1}
            flatShading
          />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.62, 0]} />
          <meshBasicMaterial color={COLORS.amber} wireframe transparent opacity={0.35} />
        </mesh>
      </group>
    );
  },
);

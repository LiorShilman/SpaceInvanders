import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

/**
 * Visual-only. Position/rotation are driven imperatively by Scene's frame
 * loop via the forwarded group ref — this component never re-renders.
 */
export const Ship = forwardRef<THREE.Group>(function Ship(_props, ref) {
  return (
    <group ref={ref}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.55, 1.6, 4]} />
        <meshStandardMaterial
          color={COLORS.phosphor}
          emissive={COLORS.phosphor}
          emissiveIntensity={0.6}
          flatShading
        />
      </mesh>
      <mesh position={[0, -0.1, 0.1]}>
        <boxGeometry args={[1.8, 0.08, 0.5]} />
        <meshStandardMaterial
          color={COLORS.phosphorDim}
          emissive={COLORS.phosphor}
          emissiveIntensity={0.3}
          flatShading
        />
      </mesh>
      <pointLight color={COLORS.phosphor} intensity={2} distance={4} />
    </group>
  );
});

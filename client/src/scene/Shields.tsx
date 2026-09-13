import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS, SHIELD } from "../config/constants";

interface ShieldsProps {
  count: number;
}

/**
 * All destructible shield blocks across every bunker, as ONE instanced mesh
 * instead of one <mesh> per block (~130+ separate draw calls at 7 rows x 5
 * cols x 4 shields). Scene sets each instance's transform imperatively via
 * the forwarded ref — a destroyed block gets scaled to zero rather than
 * needing per-instance visibility, which instancedMesh doesn't support.
 */
export const Shields = forwardRef<THREE.InstancedMesh, ShieldsProps>(function Shields(
  { count },
  ref,
) {
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[SHIELD.blockSize, SHIELD.blockSize, SHIELD.blockSize]} />
      <meshStandardMaterial
        color={COLORS.hull}
        emissive={COLORS.phosphorDim}
        emissiveIntensity={0.4}
        metalness={0.4}
        roughness={0.6}
        flatShading
      />
    </instancedMesh>
  );
});

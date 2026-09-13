import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

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
    // A faceted crystal, not a cube — reads as an energy-barrier formation
    // rather than concrete blocks. Each instance also gets a small random
    // rotation (baked into its transform in Scene) so the wall doesn't look
    // like a rigid, uniform grid of identical squares.
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <icosahedronGeometry args={[0.27, 0]} />
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

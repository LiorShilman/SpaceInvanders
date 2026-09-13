import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS, SHIELD_HEALTH_COLORS } from "../config/constants";

interface ShieldsProps {
  count: number;
}

export interface ShieldTierMeshes {
  healthy: THREE.InstancedMesh | null;
  damaged: THREE.InstancedMesh | null;
  critical: THREE.InstancedMesh | null;
}

/**
 * Every destructible shield block, as THREE instanced meshes — one per
 * damage tier — instead of one <mesh> per block (~130+ separate draw calls)
 * or a single dynamically-recolored instanced mesh. A block "moves" between
 * tier meshes as its bunker's damage crosses a threshold: hidden (scaled to
 * zero) in whichever tier it's leaving, shown (real transform) in the one
 * it's entering — see moveShieldBlockToTier in Scene.tsx.
 *
 * A single mesh with a per-instance color (mesh.setColorAt + a custom
 * emissive-tinting shader patch) was tried first and abandoned: three.js is
 * supposed to detect an instanceColor attribute appearing after the first
 * compile and recompile the shader for it, but that didn't happen reliably
 * here (confirmed with an onBeforeCompile probe — the shader's `defines`
 * never picked up USE_INSTANCING_COLOR even well after instanceColor
 * existed and material.needsUpdate was forced). Three independent, plainly
 * static-colored materials sidestep that whole class of problem — nothing
 * dynamic to recompile, so nothing to race.
 */
export const Shields = forwardRef<ShieldTierMeshes, ShieldsProps>(function Shields(
  { count },
  ref,
) {
  const healthyRef = (m: THREE.InstancedMesh | null) => setTier(ref, "healthy", m);
  const damagedRef = (m: THREE.InstancedMesh | null) => setTier(ref, "damaged", m);
  const criticalRef = (m: THREE.InstancedMesh | null) => setTier(ref, "critical", m);

  return (
    <>
      {/* Each tier mesh is sized to the FULL block count — worst case (say
          every bunker critical at once) needs that much capacity in one
          tier; the other two just sit empty (scale-zero) meanwhile. Trivial
          memory cost (a few hundred mat4 instances) for guaranteed-correct
          rendering, and 3 draw calls total is nothing next to this
          project's real instancing win (40 separate enemy meshes -> 1). */}
      <instancedMesh ref={healthyRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <icosahedronGeometry args={[0.27, 0]} />
        <meshStandardMaterial
          color={COLORS.hull}
          emissive={SHIELD_HEALTH_COLORS.healthy}
          emissiveIntensity={0.4}
          metalness={0.4}
          roughness={0.6}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={damagedRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <icosahedronGeometry args={[0.27, 0]} />
        <meshStandardMaterial
          color={COLORS.hull}
          emissive={SHIELD_HEALTH_COLORS.damaged}
          emissiveIntensity={0.7}
          metalness={0.4}
          roughness={0.6}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={criticalRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <icosahedronGeometry args={[0.27, 0]} />
        <meshStandardMaterial
          color={COLORS.hull}
          emissive={SHIELD_HEALTH_COLORS.critical}
          emissiveIntensity={1.1}
          metalness={0.4}
          roughness={0.6}
          flatShading
        />
      </instancedMesh>
    </>
  );
});

function setTier(
  ref: React.ForwardedRef<ShieldTierMeshes>,
  key: keyof ShieldTierMeshes,
  mesh: THREE.InstancedMesh | null,
) {
  if (typeof ref === "function") {
    // Functional refs can't accumulate partial state between the three
    // separate mesh callbacks, so this shape isn't supported here — every
    // caller in this codebase uses a RefObject (useRef), same as every
    // other forwardRef component in scene/.
    return;
  }
  if (!ref) return;
  if (!ref.current) ref.current = { healthy: null, damaged: null, critical: null };
  ref.current[key] = mesh;
}

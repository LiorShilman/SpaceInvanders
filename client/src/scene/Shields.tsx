import { forwardRef } from "react";
import * as THREE from "three";
import { SHIELD_HEALTH_COLORS } from "../config/constants";

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
      {/* color (the lit albedo) carries the tier hue now, not a dark hull
          tint — emissive was doing that job alone at a high enough
          intensity (0.4-1.1) to flatten the icosahedron into a single
          solid-looking silhouette: emissive light isn't affected by a
          facet's normal, so a strong enough emissive term washes out the
          very shading that makes each facet read as its own plane. A
          bright *lit* color responds properly to the scene's directional
          lights facet-by-facet, restoring the faceted crystal look; a much
          smaller emissive now only adds a bit of "glowing from within" on
          top instead of overpowering it. */}
      <instancedMesh ref={healthyRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <icosahedronGeometry args={[0.27, 0]} />
        <meshStandardMaterial
          color={SHIELD_HEALTH_COLORS.healthy}
          emissive={SHIELD_HEALTH_COLORS.healthy}
          emissiveIntensity={0.15}
          metalness={0.3}
          roughness={0.45}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={damagedRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <icosahedronGeometry args={[0.27, 0]} />
        <meshStandardMaterial
          color={SHIELD_HEALTH_COLORS.damaged}
          emissive={SHIELD_HEALTH_COLORS.damaged}
          emissiveIntensity={0.3}
          metalness={0.3}
          roughness={0.45}
          flatShading
        />
      </instancedMesh>
      <instancedMesh ref={criticalRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <icosahedronGeometry args={[0.27, 0]} />
        <meshStandardMaterial
          color={SHIELD_HEALTH_COLORS.critical}
          emissive={SHIELD_HEALTH_COLORS.critical}
          emissiveIntensity={0.5}
          metalness={0.3}
          roughness={0.45}
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

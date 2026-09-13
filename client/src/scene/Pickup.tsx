import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

// Bright near-white cores, tinted just enough to read as "this kind's glow"
// rather than a neutral highlight — same idea as the enemies' hot eye color
// against their duller hull, just inverted (bright core, dim/translucent
// shell here instead of dim body, bright eye there).
const HEALTH_CORE = "#eafffb";
const WEAPON_CORE = "#f4e3ff";

/**
 * Visual-only pickup capsule. Scene owns a pool of these (see spawnPickup/
 * PickupSlot in Scene.tsx) and drives the root group's position, rotation,
 * scale and visibility imperatively per frame — same convention as
 * Projectile.tsx. Built with BOTH variants as named children
 * ("health-visual" / "weapon-visual") rather than one shape whose material
 * color gets mutated: a pooled slot is reused across different kinds over
 * its lifetime, and a real shape difference (soft cross vs. faceted gem)
 * reads at a glance even before the color registers. Which variant shows is
 * a one-time visibility toggle done at spawn (see spawnPickup), not
 * per-frame.
 */
export const Pickup = forwardRef<THREE.Group>(function Pickup(_props, ref) {
  return (
    <group ref={ref} visible={false}>
      {/* Health: a soft cyan energy shell around a white medkit cross. Three
          bars, one per axis (not a flat 2D "+") — the whole pickup spins in
          Scene's per-frame loop, and a flat cross reads as a thin line from
          the side for half of every rotation; a 3-axis "jack" cross reads
          as a cross from any angle. (An earlier version also had a sphere
          at the center — pulled it: at this scale its silhouette merged
          with the bars into one indistinct blob instead of a clean plus.) */}
      <group name="health-visual">
        <mesh>
          <icosahedronGeometry args={[0.42, 0]} />
          <meshBasicMaterial color={COLORS.pickupHealth} transparent opacity={0.28} depthWrite={false} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.34, 0.09, 0.09]} />
          <meshBasicMaterial color={HEALTH_CORE} toneMapped={false} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.09, 0.34, 0.09]} />
          <meshBasicMaterial color={HEALTH_CORE} toneMapped={false} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.09, 0.09, 0.34]} />
          <meshBasicMaterial color={HEALTH_CORE} toneMapped={false} />
        </mesh>
        <pointLight color={COLORS.pickupHealth} intensity={2.2} distance={4.5} />
      </group>

      {/* Weapon: a violet energy shell around a faceted crystal core. */}
      <group name="weapon-visual" visible={false}>
        <mesh>
          <icosahedronGeometry args={[0.42, 0]} />
          <meshBasicMaterial color={COLORS.pickupWeapon} transparent opacity={0.28} depthWrite={false} />
        </mesh>
        <mesh rotation={[Math.PI / 4, 0, Math.PI / 4]}>
          <octahedronGeometry args={[0.24, 0]} />
          <meshBasicMaterial color={WEAPON_CORE} toneMapped={false} />
        </mesh>
        <mesh rotation={[0, Math.PI / 4, 0]}>
          <octahedronGeometry args={[0.24, 0]} />
          <meshBasicMaterial color={WEAPON_CORE} toneMapped={false} wireframe />
        </mesh>
        <pointLight color={COLORS.pickupWeapon} intensity={2.2} distance={4.5} />
      </group>
    </group>
  );
});

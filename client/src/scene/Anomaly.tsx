import { forwardRef, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS } from "../config/constants";

/**
 * The gravity anomaly (see ANOMALY in config/constants.ts) — visual-only,
 * like every other Scene-driven object. Scene owns position, overall scale
 * (grow-in/shrink-out, see anomalyEntranceUntil) and visibility; only the
 * ring's own continuous spin is self-animated here, same convention as
 * Boss.tsx's own equatorial ring.
 *
 * A near-black core (COLORS.anomalyCore) rather than pure black — reads as
 * "an object with depth," not a flat void silhouette against space, which
 * is already black. A tilted, fast-spinning accretion ring around it in a
 * hot magenta-purple sells "this is actively pulling things in," and a
 * large, very faint outer sphere traces roughly where ANOMALY.pullRadius
 * actually reaches — the same "show the real extent of the effect" idea
 * the grenade's own shockwave ring already established, just as a static
 * (not expanding) marker since this hazard's danger zone doesn't change
 * size over its lifetime.
 */
export const Anomaly = forwardRef<THREE.Group>(function Anomaly(_props, ref) {
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);

  useFrame((_state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30);
    if (ringRef.current) ringRef.current.rotation.z += delta * 2.2;
    if (ring2Ref.current) ring2Ref.current.rotation.z -= delta * 1.5;
  });

  return (
    <group ref={ref} visible={false}>
      <mesh>
        <sphereGeometry args={[0.5, 16, 12]} />
        <meshStandardMaterial color={COLORS.anomalyCore} emissive={COLORS.anomalyRing} emissiveIntensity={0.3} roughness={0.9} />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2.6, 0, 0]}>
        <torusGeometry args={[0.85, 0.06, 8, 32]} />
        <meshBasicMaterial color={COLORS.anomalyRing} toneMapped={false} />
      </mesh>
      <mesh ref={ring2Ref} rotation={[Math.PI / 1.8, 0.4, 0]}>
        <torusGeometry args={[1.15, 0.03, 6, 32]} />
        <meshBasicMaterial color={COLORS.anomalyRing} transparent opacity={0.6} toneMapped={false} />
      </mesh>
      {/* Faint, oversized sphere tracing ANOMALY.pullRadius itself — static,
          unlike the grenade's expanding shockwave, since this hazard's
          danger zone is constant for its whole lifetime. Scale chosen so
          its WORLD radius equals ANOMALY.pullRadius once Scene's own
          group-level scale reaches ANOMALY.visualScale: geometry radius
          1.5 * this mesh's scale 4 * visualScale 1.5 = 9. */}
      <mesh scale={4}>
        <sphereGeometry args={[1.5, 16, 12]} />
        <meshBasicMaterial
          color={COLORS.anomalyRing}
          transparent
          opacity={0.05}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
});

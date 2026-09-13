import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

/**
 * Visual-only. Position/rotation are driven imperatively by Scene's frame
 * loop via the forwarded group ref — this component never re-renders.
 *
 * A real multi-part fighter, not one flat-shaded primitive: a shaded metal
 * hull (lit by the scene's lights, not self-illuminated) carries the form,
 * and phosphor-green only marks energy — the canopy, weapon strakes, and
 * engine glow. Local convention: -Z is the nose (forward, toward the
 * enemies), +Z is the tail (toward the chase camera behind the ship).
 */
export const Ship = forwardRef<THREE.Group>(function Ship(_props, ref) {
  return (
    <group ref={ref}>
      {/* Fuselage: a tapered hull, nose pointing forward (-Z). */}
      <mesh castShadow position={[0, 0.05, -0.25]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.42, 1.7, 6]} />
        <meshStandardMaterial color={COLORS.hull} metalness={0.75} roughness={0.35} flatShading />
      </mesh>
      <mesh position={[0, -0.1, 0.45]}>
        <cylinderGeometry args={[0.4, 0.22, 0.7, 6]} />
        <meshStandardMaterial color={COLORS.hullDark} metalness={0.7} roughness={0.4} flatShading />
      </mesh>

      {/* Swept wings, angled back toward the tail, with a thin phosphor
          leading-edge strake near the nose. */}
      {[-1, 1].map((side) => (
        <group key={side} rotation={[0, 0, (side * Math.PI) / 10]}>
          <mesh position={[side * 0.75, -0.08, 0.05]} castShadow>
            <boxGeometry args={[1.1, 0.06, 0.85]} />
            <meshStandardMaterial color={COLORS.hull} metalness={0.6} roughness={0.4} flatShading />
          </mesh>
          {/* userData.shipAccent marks every energy part Scene retints while
              a weapon buff is active (see setShipAccentColor) — a quick,
              glanceable "something's active" cue independent of the HUD. */}
          <mesh position={[side * 1.28, -0.05, -0.3]} userData={{ shipAccent: true }}>
            <boxGeometry args={[0.32, 0.03, 0.14]} />
            <meshStandardMaterial
              color={COLORS.phosphor}
              emissive={COLORS.phosphor}
              emissiveIntensity={1.4}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      {/* Cockpit canopy — small glassy dome just behind the nose. */}
      <mesh position={[0, 0.3, -0.15]} scale={[0.6, 0.48, 0.6]} castShadow userData={{ shipAccent: true }}>
        <sphereGeometry args={[0.32, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.7]} />
        <meshStandardMaterial
          color={COLORS.phosphorDim}
          emissive={COLORS.phosphor}
          emissiveIntensity={0.5}
          metalness={0.3}
          roughness={0.15}
          toneMapped={false}
        />
      </mesh>

      {/* Engine nacelles at the tail, thrusters glowing back toward +Z —
          exhaust facing the chase camera, as it should when flying away. */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.38, -0.14, 0.7]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.17, 0.14, 0.5, 8]} />
            <meshStandardMaterial color={COLORS.hullDark} metalness={0.8} roughness={0.3} flatShading />
          </mesh>
          <mesh position={[0, 0, 0.32]} rotation={[Math.PI / 2, 0, 0]} userData={{ shipAccent: true }}>
            <coneGeometry args={[0.11, 0.4, 8]} />
            <meshStandardMaterial
              color={COLORS.phosphor}
              emissive={COLORS.phosphor}
              emissiveIntensity={2.2}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      <pointLight
        color={COLORS.phosphor}
        intensity={3}
        distance={5}
        position={[0, 0.1, 0.9]}
        userData={{ shipAccent: true }}
      />
    </group>
  );
});

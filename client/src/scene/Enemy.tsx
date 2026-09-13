import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

const LEG_COUNT = 4;

/**
 * Visual-only placeholder art for a "Grunt" — a bio-mechanical hunter, built
 * to actually read from the chase camera's elevated, front-on angle (the
 * previous radially-splayed-legs version mostly hid its own detail behind
 * a flat carapace face from that angle — see docs/GAME_PLAN.md for the
 * "real 3D volume in behavior, not a static shape" direction this is
 * heading toward in Phase 2). Position is local to the parent formation
 * group; visibility/alive state is toggled imperatively by Scene via the
 * forwarded ref.
 */
export const Enemy = forwardRef<THREE.Group, { position: [number, number, number] }>(
  function Enemy({ position }, ref) {
    const legs = useMemo(
      () =>
        Array.from({ length: LEG_COUNT }, (_, i) => {
          const side = i < 2 ? -1 : 1;
          const along = i % 2 === 0 ? -1 : 1; // one leg forward, one back, per side
          return { side, along, key: i };
        }),
      [],
    );

    return (
      <group ref={ref} position={position}>
        <group scale={1.8}>
          {/* Carapace: flattened and swept forward — a beetle shell, not a
              gem. Two-tone so the hull has real top/underside contrast
              instead of one flat color. */}
          <mesh castShadow scale={[1, 0.55, 1.25]}>
            <icosahedronGeometry args={[0.42, 1]} />
            <meshStandardMaterial
              color={COLORS.enemyHull}
              emissive={COLORS.amberDim}
              emissiveIntensity={0.35}
              metalness={0.6}
              roughness={0.4}
              flatShading
            />
          </mesh>
          <mesh position={[0, -0.16, 0]} scale={[0.92, 0.4, 1.1]}>
            <icosahedronGeometry args={[0.4, 1]} />
            <meshStandardMaterial
              color={COLORS.enemyHullDark}
              metalness={0.5}
              roughness={0.6}
              flatShading
            />
          </mesh>

          {/* Raised sensor turret — a distinct head, not an embedded dot,
              so the eye actually reads as a feature from above/ahead. */}
          <mesh position={[0, 0.22, 0.35]}>
            <coneGeometry args={[0.16, 0.3, 6]} />
            <meshStandardMaterial
              color={COLORS.enemyHullDark}
              metalness={0.6}
              roughness={0.4}
              flatShading
            />
          </mesh>
          <mesh position={[0, 0.4, 0.35]}>
            <sphereGeometry args={[0.15, 10, 8]} />
            <meshStandardMaterial
              color={COLORS.amber}
              emissive={COLORS.amber}
              emissiveIntensity={1.8}
              toneMapped={false}
            />
          </mesh>

          {/* Amber containment band around the carapace's equator — a
              sci-fi energy-seam detail, reads as a bright ring from any
              angle instead of relying on one small eye for all the glow. */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.44, 0.035, 6, 16]} />
            <meshStandardMaterial
              color={COLORS.amber}
              emissive={COLORS.amber}
              emissiveIntensity={1.1}
              toneMapped={false}
            />
          </mesh>

          {/* Four jointed legs (thigh + shin), swept back so a real
              silhouette shows past the carapace even from a steep,
              near-front viewing angle — not hidden radially underneath. */}
          {legs.map(({ side, along, key }) => (
            <group
              key={key}
              position={[side * 0.34, -0.08, along * 0.22]}
              rotation={[0, side * 0.5, 0]}
            >
              <mesh position={[side * 0.22, -0.1, along * -0.05]} rotation={[0, 0, side * 1.15]}>
                <cylinderGeometry args={[0.05, 0.065, 0.42, 5]} />
                <meshStandardMaterial
                  color={COLORS.enemyHullDark}
                  emissive={COLORS.amberDim}
                  emissiveIntensity={0.3}
                  metalness={0.5}
                  roughness={0.55}
                  flatShading
                />
              </mesh>
              <mesh position={[side * 0.4, -0.32, along * -0.05]} rotation={[0, 0, side * 1.9]}>
                <cylinderGeometry args={[0.03, 0.05, 0.34, 5]} />
                <meshStandardMaterial
                  color={COLORS.enemyHullDark}
                  metalness={0.5}
                  roughness={0.6}
                  flatShading
                />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    );
  },
);

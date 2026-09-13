import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS, SHIELD } from "../config/constants";

/**
 * One destructible block of a defense bunker. Visual-only; Scene toggles
 * visibility imperatively (via the forwarded ref) the moment a shot — from
 * either side — connects with it, same pooling philosophy as everything
 * else in scene/.
 */
export const ShieldBlock = forwardRef<THREE.Mesh, { position: [number, number, number] }>(
  function ShieldBlock({ position }, ref) {
    return (
      <mesh ref={ref} position={position} castShadow>
        <boxGeometry args={[SHIELD.blockSize, SHIELD.blockSize, SHIELD.blockSize]} />
        <meshStandardMaterial
          color={COLORS.hull}
          emissive={COLORS.phosphorDim}
          emissiveIntensity={0.4}
          metalness={0.4}
          roughness={0.6}
          flatShading
        />
      </mesh>
    );
  },
);

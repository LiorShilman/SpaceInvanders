import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const STAR_COUNT = 800;
const SPREAD = 60;

export function Starfield() {
  const pointsRef = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      arr[i * 3] = (Math.random() - 0.5) * SPREAD;
      arr[i * 3 + 1] = Math.random() * SPREAD * 0.6;
      arr[i * 3 + 2] = (Math.random() - 0.5) * SPREAD * 1.5 - 10;
    }
    return arr;
  }, []);

  // Slow parallax drift so the field doesn't feel like a static backdrop.
  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y += delta * 0.01;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#3d5c47"
        size={0.06}
        sizeAttenuation
        transparent
        opacity={0.8}
      />
    </points>
  );
}

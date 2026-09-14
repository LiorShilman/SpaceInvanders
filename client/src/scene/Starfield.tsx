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

  // Real starlight isn't one flat tint — mostly cool white with a scatter
  // of warmer and bluer outliers (temperature variation) reads as a real
  // field instead of a uniform dot pattern. (The old flat color was also
  // a dim green, `#3d5c47` — the ship's own hue leaking into the backdrop
  // again, same issue as the nebula.)
  const colors = useMemo(() => {
    const arr = new Float32Array(STAR_COUNT * 3);
    const palette = [
      new THREE.Color("#e8f2ff"), // cool white — most stars
      new THREE.Color("#dce9ff"),
      new THREE.Color("#fff6e0"), // warm white, less common
      new THREE.Color("#9fd8ff"), // blue-white outlier, rarer still
    ];
    const weights = [0.55, 0.25, 0.15, 0.05];
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = Math.random();
      let acc = 0;
      let chosen = palette[0];
      for (let p = 0; p < palette.length; p++) {
        acc += weights[p];
        if (r <= acc) {
          chosen = palette[p];
          break;
        }
      }
      arr[i * 3] = chosen.r;
      arr[i * 3 + 1] = chosen.g;
      arr[i * 3 + 2] = chosen.b;
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
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={0.06}
        sizeAttenuation
        transparent
        opacity={0.8}
      />
    </points>
  );
}

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const POOL_SIZE = 140;
const PARTICLES_PER_BURST = 14;

interface Particle {
  ref: React.RefObject<THREE.Mesh | null>;
  active: boolean;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export interface ExplosionsHandle {
  burst: (position: THREE.Vector3, color: string) => void;
}

/**
 * A pooled particle-burst system: replaces "enemy mesh just vanishes" with a
 * small shrapnel burst that flies outward and fades. Imperative by design
 * (see Ship/Enemy/Projectile) — Scene calls `burst()` on kill/hit events via
 * the handle from useExplosions(), no React state involved per-frame.
 */
export const Explosions = forwardRef<ExplosionsHandle>(function Explosions(_props, ref) {
  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: POOL_SIZE }, () => ({
        ref: { current: null },
        active: false,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0.6,
      })),
    [],
  );

  useImperativeHandle(ref, () => ({
    burst(position, color) {
      let spawned = 0;
      for (const p of particles) {
        if (spawned >= PARTICLES_PER_BURST) break;
        if (p.active) continue;
        const mesh = p.ref.current;
        if (!mesh) continue;

        const dir = new THREE.Vector3(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
        ).normalize();
        const speed = 2.5 + Math.random() * 3.5;
        p.velocity.copy(dir).multiplyScalar(speed);
        p.life = 0;
        p.maxLife = 0.35 + Math.random() * 0.3;
        p.active = true;

        mesh.visible = true;
        mesh.position.copy(position);
        mesh.scale.setScalar(1);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.color.set(color);
        mat.opacity = 1;
        spawned++;
      }
    },
  }));

  useFrame((_state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30);
    for (const p of particles) {
      if (!p.active) continue;
      const mesh = p.ref.current;
      if (!mesh) continue;

      p.life += delta;
      if (p.life >= p.maxLife) {
        p.active = false;
        mesh.visible = false;
        continue;
      }

      mesh.position.addScaledVector(p.velocity, delta);
      p.velocity.multiplyScalar(0.92); // drag, so the burst settles rather than flying forever
      const t = p.life / p.maxLife;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - t;
      mesh.scale.setScalar(1 - t * 0.6);
    }
  });

  return (
    <>
      {particles.map((p, i) => (
        <mesh key={i} ref={p.ref as React.RefObject<THREE.Mesh>} visible={false}>
          <tetrahedronGeometry args={[0.12, 0]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={1} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
});

/** Creates a stable ref + trigger function pair for one <Explosions> mount. */
export function useExplosions() {
  const ref = useRef<ExplosionsHandle>(null);
  return {
    ref,
    trigger: (position: THREE.Vector3, color: string) => ref.current?.burst(position, color),
  };
}

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Was 140 — plenty more than the scene ever needs concurrently (even rapid
// player kills rarely overlap more than 3-4 bursts at once) and each one is
// its own mesh/draw call, so this was pure overhead.
const POOL_SIZE = 60;
const PARTICLES_PER_BURST = 14;

// Shockwave rings are a separate, much smaller pool — a grenade/nova only
// ever needs one or two on screen at once (nothing spam-fires them the way
// per-kill particle bursts can overlap), so there's no reason to size this
// anywhere near POOL_SIZE.
const RING_POOL_SIZE = 6;

interface Particle {
  ref: React.RefObject<THREE.Mesh | null>;
  active: boolean;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface Ring {
  ref: React.RefObject<THREE.Mesh | null>;
  active: boolean;
  life: number;
  maxLife: number;
  maxRadius: number;
}

export interface ExplosionsHandle {
  burst: (position: THREE.Vector3, color: string) => void;
  // A wireframe sphere that grows from nothing out to `radius` and fades —
  // unlike burst() (shrapnel flying in random directions, reads as "an
  // impact happened here"), this traces the actual extent of an
  // area-of-effect hit so it's visually obvious which enemies were caught
  // in it and which weren't (see detonateGrenade/triggerNovaBomb in
  // Scene.tsx, the two AOE effects that call this).
  shockwave: (position: THREE.Vector3, radius: number, color: string) => void;
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

  const rings = useMemo<Ring[]>(
    () =>
      Array.from({ length: RING_POOL_SIZE }, () => ({
        ref: { current: null },
        active: false,
        life: 0,
        maxLife: 0.45,
        maxRadius: 1,
      })),
    [],
  );

  useImperativeHandle(ref, () => ({
    shockwave(position, radius, color) {
      const r = rings.find((r) => !r.active);
      const mesh = r?.ref.current;
      if (!r || !mesh) return;
      r.life = 0;
      r.maxLife = 0.45;
      r.maxRadius = radius;
      r.active = true;
      mesh.visible = true;
      mesh.position.copy(position);
      mesh.scale.setScalar(0.01);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(color);
      mat.opacity = 0.8;
    },
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

    for (const r of rings) {
      if (!r.active) continue;
      const mesh = r.ref.current;
      if (!mesh) continue;

      r.life += delta;
      if (r.life >= r.maxLife) {
        r.active = false;
        mesh.visible = false;
        continue;
      }

      const t = r.life / r.maxLife;
      // Fast out, easing off near the end — a real shockwave's leading edge
      // decelerates as it expands, rather than growing at a constant rate.
      const eased = 1 - (1 - t) * (1 - t);
      mesh.scale.setScalar(Math.max(0.01, r.maxRadius * eased));
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.8 * (1 - t);
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
      {/* Unit-radius wireframe sphere, scaled per-frame to the blast's
          current radius — reads as an expanding energy shockwave from any
          camera angle without needing to billboard a flat ring toward the
          camera. */}
      {rings.map((r, i) => (
        <mesh key={`ring${i}`} ref={r.ref as React.RefObject<THREE.Mesh>} visible={false}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.8} toneMapped={false} depthWrite={false} />
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
    triggerShockwave: (position: THREE.Vector3, radius: number, color: string) =>
      ref.current?.shockwave(position, radius, color),
  };
}

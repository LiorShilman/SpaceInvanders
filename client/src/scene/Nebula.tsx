import { useMemo } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";

/** One soft radial-gradient blob, drawn once to a canvas — no image assets. */
function makeCloudTexture(color: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.4, color);
  gradient.addColorStop(1, "transparent");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Cloud {
  key: number;
  texture: THREE.CanvasTexture;
  position: [number, number, number];
  scale: number;
  opacity: number;
}

/**
 * A handful of huge, faint, procedurally-drawn gas clouds far behind the
 * action — breaks up the flat black backdrop without needing an external
 * skybox texture. Purely decorative, billboarded, never interacted with.
 */
export function Nebula() {
  const clouds = useMemo<Cloud[]>(() => {
    const phosphor = makeCloudTexture(COLORS.phosphorDim);
    const amber = makeCloudTexture(COLORS.amberDim);
    const specs: Array<[number, number, number, number, number, THREE.CanvasTexture]> = [
      [-22, 10, -70, 55, 0.16, phosphor],
      [18, 4, -85, 65, 0.14, amber],
      [-6, 18, -95, 70, 0.1, phosphor],
      [10, -6, -60, 40, 0.12, amber],
    ];
    return specs.map(([x, y, z, scale, opacity, texture], key) => ({
      key,
      texture,
      position: [x, y, z] as [number, number, number],
      scale,
      opacity,
    }));
  }, []);

  return (
    <>
      {clouds.map((cloud) => (
        <sprite key={cloud.key} position={cloud.position} scale={[cloud.scale, cloud.scale, 1]}>
          <spriteMaterial
            map={cloud.texture}
            transparent
            opacity={cloud.opacity}
            depthWrite={false}
            fog={false}
          />
        </sprite>
      ))}
    </>
  );
}

import { useMemo } from "react";
import * as THREE from "three";

/**
 * A distant tilted spiral galaxy: a flattened disk, a couple of soft arm
 * streaks, and a bright core — an actual recognizable galaxy SHAPE, not
 * just a colored patch. A handful of same-colored soft-circle "clouds" (the
 * first two passes at this backdrop) each read as exactly that — scattered
 * fog patches of some color — no matter how wispy their edges were;
 * structure is what makes something read as "a galaxy" specifically, and a
 * second, unrelated color patch nearby undercuts that the moment it's
 * visible, so this is the ONLY background element now rather than a
 * galaxy plus leftover cloud blobs around it.
 */
function makeGalaxyTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(size / 2, size / 2);

  // The disk, flattened to read as tilted rather than face-on.
  ctx.save();
  ctx.scale(1, 0.38);
  const disk = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.48);
  disk.addColorStop(0, "rgba(210, 224, 255, 0.85)");
  disk.addColorStop(0.18, "rgba(160, 190, 255, 0.5)");
  disk.addColorStop(0.42, "rgba(120, 140, 220, 0.24)");
  disk.addColorStop(0.72, "rgba(90, 90, 170, 0.1)");
  disk.addColorStop(1, "transparent");
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Two soft arm streaks — elongated, angled glows layered additively so
  // they brighten the disk where they cross it instead of just sitting on
  // top of it, suggesting spiral structure without needing true spiral math.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const angle of [0.32, -0.55]) {
    ctx.save();
    ctx.rotate(angle);
    ctx.scale(1, 0.22);
    const arm = ctx.createRadialGradient(size * 0.14, 0, 0, size * 0.14, 0, size * 0.36);
    arm.addColorStop(0, "rgba(190, 205, 255, 0.22)");
    arm.addColorStop(1, "transparent");
    ctx.fillStyle = arm;
    ctx.beginPath();
    ctx.ellipse(size * 0.14, 0, size * 0.36, size * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // The bright core (galactic bulge) — warm, not cool-toned, the way a
  // real galactic core's older star population reads yellow-white against
  // the disk's cooler blue.
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.1);
  core.addColorStop(0, "rgba(255, 250, 235, 1)");
  core.addColorStop(0.5, "rgba(255, 238, 205, 0.75)");
  core.addColorStop(1, "transparent");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.1, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function Nebula() {
  const galaxy = useMemo(
    () => ({
      texture: makeGalaxyTexture(),
      // Pushed further to the SIDE, not just further back — moving it
      // deeper in z while compensating with a bigger scale barely changed
      // its actual screen position (a sprite's apparent size shrinks with
      // distance, but where it sits on screen is still set by its x/y, not
      // z), so it kept visually overlapping the formation's usual on-
      // screen spot. A bigger x/y offset is what actually separates them.
      position: [-58, 27, -130] as [number, number, number],
      scale: 110,
      rotation: 0.4,
    }),
    [],
  );

  return (
    <sprite position={galaxy.position} scale={[galaxy.scale, galaxy.scale, 1]}>
      <spriteMaterial
        map={galaxy.texture}
        transparent
        opacity={0.5}
        depthWrite={false}
        fog={false}
        rotation={galaxy.rotation}
      />
    </sprite>
  );
}

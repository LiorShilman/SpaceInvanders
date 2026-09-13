import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AnaglyphEffect } from "three/examples/jsm/effects/AnaglyphEffect.js";

/**
 * Real red/cyan stereo 3D — physically-correct off-axis stereo projection
 * (Three.js's AnaglyphEffect, Dubois matrices), not a chromatic-aberration
 * trick. Put on a pair of red/cyan glasses and the ship and formation
 * actually sit at different depths.
 *
 * Takes over the render call directly (useFrame's second argument, a
 * priority, tells react-three-fiber "I'm handling gl.render myself, skip
 * your default call") — so mount this INSTEAD OF <EffectComposer>, never
 * alongside it; both would otherwise fight over the same frame's render.
 */
export function AnaglyphRenderer() {
  const { gl, scene, camera, size } = useThree();
  const effect = useMemo(() => {
    const e = new AnaglyphEffect(gl);
    // The library's defaults (eyeSep 0.064, planeDistance 0.5) assume a
    // human-scale scene half a meter from the camera — our ship sits ~10-14
    // units out and the wave 20-90 units out, so those defaults blow the
    // off-axis frustums wildly apart (the "double vision" look). Re-tuned
    // so the zero-parallax plane sits at the ship (it reads at screen
    // depth) and the wave recedes into the screen behind it.
    e.planeDistance = 12;
    e.eyeSep = 0.25;
    return e;
  }, [gl]);

  useEffect(() => {
    effect.setSize(size.width, size.height);
  }, [effect, size]);

  useFrame(() => {
    effect.render(scene, camera);
  }, 1);

  return null;
}

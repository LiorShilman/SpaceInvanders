import { useEffect, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Scene } from "./scene/Scene";
import { AnaglyphRenderer } from "./scene/AnaglyphRenderer";
import { HUD } from "./hud/HUD";

export default function App() {
  const [anaglyph, setAnaglyph] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Digit3") setAnaglyph((v) => !v);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas
        camera={{ fov: 60, position: [0, 5, 16] }}
        dpr={[1, 2]}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      >
        <Scene />
        {anaglyph ? (
          <AnaglyphRenderer />
        ) : (
          <EffectComposer>
            <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.3} mipmapBlur />
            <Vignette eskil={false} offset={0.15} darkness={0.9} />
          </EffectComposer>
        )}
      </Canvas>
      <HUD anaglyph={anaglyph} onToggleAnaglyph={() => setAnaglyph((v) => !v)} />
    </div>
  );
}

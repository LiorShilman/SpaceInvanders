import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Scene } from "./scene/Scene";
import { HUD } from "./hud/HUD";

export default function App() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas camera={{ fov: 60, position: [0, 5, 16] }} dpr={[1, 2]}>
        <Scene />
        <EffectComposer>
          <Bloom
            intensity={0.9}
            luminanceThreshold={0.25}
            luminanceSmoothing={0.3}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
      <HUD />
    </div>
  );
}

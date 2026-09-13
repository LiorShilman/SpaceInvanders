import { useEffect, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Scene } from "./scene/Scene";
import { AnaglyphRenderer } from "./scene/AnaglyphRenderer";
import { HUD } from "./hud/HUD";
import { TouchControls } from "./hud/TouchControls";
import { RotateDevicePrompt } from "./hud/RotateDevicePrompt";
import { isTouchDevice, useIsPortrait, useIsFullscreen, toggleFullscreen } from "./hooks/useMobileLayout";

// Read once at module load — touch capability doesn't change mid-session,
// so there's no reason to recompute it on every render (see its own doc
// comment for why this is a plain function, not a hook).
const IS_TOUCH_DEVICE = isTouchDevice();

export default function App() {
  const [anaglyph, setAnaglyph] = useState(false);
  const isPortrait = useIsPortrait();
  const isFullscreen = useIsFullscreen();
  // A guess that's occasionally wrong (see useIsPortrait's doc comment)
  // must never be able to wall off the whole game — the prompt is always
  // dismissible, and re-arms itself the next time the device actually
  // reports landscape, rather than staying dismissed forever after one
  // false alarm.
  const [rotateDismissed, setRotateDismissed] = useState(false);
  useEffect(() => {
    if (!isPortrait) setRotateDismissed(false);
  }, [isPortrait]);

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
      <HUD
        anaglyph={anaglyph}
        onToggleAnaglyph={() => setAnaglyph((v) => !v)}
        showFullscreenButton={IS_TOUCH_DEVICE}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        showKeyboardHint={!IS_TOUCH_DEVICE}
        compact={IS_TOUCH_DEVICE}
      />
      {/* Rendered even outside the Canvas — a plain HTML/CSS overlay reads
          touch drags far more reliably than trying to hit-test 3D objects
          for a joystick, and this way it shares nothing with the render
          loop's own per-frame work. */}
      {IS_TOUCH_DEVICE && <TouchControls />}
      {/* !isFullscreen is a second guard on top of the prompt's own dismiss
          button: a deliberate fullscreen tap is a strong enough signal of
          "I'm playing now" that a possibly-wrong orientation reading
          shouldn't second-guess it at all. */}
      {IS_TOUCH_DEVICE && isPortrait && !isFullscreen && !rotateDismissed && (
        <RotateDevicePrompt onDismiss={() => setRotateDismissed(true)} />
      )}
    </div>
  );
}

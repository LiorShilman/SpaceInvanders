import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { useGameStore } from "./state/gameStore";
import "./index.css";

if (import.meta.env.DEV) {
  // Console/debugging convenience only — never included in a production
  // build. Try `__gameStore.getState().damageShip(999)` from devtools.
  (window as unknown as { __gameStore?: unknown }).__gameStore = useGameStore;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

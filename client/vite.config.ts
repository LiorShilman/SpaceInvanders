import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // production build is served by IIS under /SpaceInvanders/ (see
  // public/web.config) — dev server stays at root so `npm run dev` URLs
  // don't change.
  base: mode === "production" ? "/SpaceInvanders/" : "/",
}));

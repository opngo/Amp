import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * The renderer is built twice:
 *  - `vite build`            -> static web build (also used by server.py)
 *  - electron-vite dev/build -> file:// build inside the Electron shell
 * Set AMP_TARGET=electron to use relative asset paths for file:// loading.
 */
export default defineConfig(() => ({
  base: process.env.AMP_TARGET === "electron" ? "./" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@amp/core": `${here}/../../packages/core/src`,
      "@amp/ui": `${here}/../../packages/ui/src`,
    },
  },
  server: { host: "0.0.0.0", port: 4321, strictPort: false },
  preview: { host: "0.0.0.0", port: 4321 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV !== "production",
    chunkSizeWarningLimit: 1200,
  },
}));

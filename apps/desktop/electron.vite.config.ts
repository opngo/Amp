import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import path from "node:path";

/**
 * Electron build.
 *
 * Paths are resolved from the working directory (electron-vite always runs
 * from the app folder), which keeps the config free of `__dirname` so it loads
 * the same from ESM and CJS.
 *
 * main + preload  -> out/main/index.js, out/preload/index.js (CommonJS)
 * renderer        -> reuses apps/renderer, but emits relative paths so the
 *                    packaged app can load it over file://
 *
 * Dependencies are externalised, which is normally what you want: it keeps the
 * bundle small and lets npm dedupe. The exception is any package that is
 * ESM-only, because an externalised `require` of those fails at runtime with
 * "No exports main defined". `music-metadata` (v9 and later) is one of them,
 * so it is bundled into the CommonJS output instead. Anything ESM-only added
 * to the main process later belongs in this list too.
 */
const root = process.cwd();

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["music-metadata"] })],
    resolve: {
      alias: { "@amp/core": path.resolve(root, "../../packages/core/src/index.ts") },
    },
    build: {
      outDir: "out/main",
      emptyOutDir: true,
      lib: {
        entry: path.resolve(root, "src/main/index.ts"),
        formats: ["cjs"],
        fileName: () => "index.js",
      },
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.js" } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@amp/core": path.resolve(root, "../../packages/core/src/index.ts") },
    },
    build: {
      outDir: "out/preload",
      emptyOutDir: true,
      lib: {
        entry: path.resolve(root, "src/preload/index.ts"),
        formats: ["cjs"],
        fileName: () => "index.js",
      },
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.js" } },
    },
  },
  renderer: {
    root: path.resolve(root, "../renderer"),
    base: "./",
    resolve: {
      alias: {
        "@amp/core": path.resolve(root, "../../packages/core/src/index.ts"),
        "@amp/ui": path.resolve(root, "../../packages/ui/src/index.ts"),
      },
    },
    build: {
      outDir: path.resolve(root, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: path.resolve(root, "../renderer/index.html") },
    },
  },
});

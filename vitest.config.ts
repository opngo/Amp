import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const aliases = {
  "@amp/core": `${here}/packages/core/src`,
  "@amp/ui": `${here}/packages/ui/src`,
};

/**
 * Two projects, because the two halves of the codebase want different worlds.
 *
 * Vitest 4 removed `environmentMatchGlobs`, which is what this file used to
 * pick an environment per path, so the split is declared instead:
 *
 *   core      pure logic and Python-parity fixtures, plain Node.
 *   interface React components, jsdom, with the React plugin and setup file.
 *
 * Both inherit the root config (`extends: true`), so aliases and plugins are
 * still declared once, up here.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: aliases },
  test: {
    globals: false,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          environment: "node",
          include: ["packages/core/**/*.test.ts", "apps/desktop/**/*.test.ts"],
          setupFiles: [`${here}/tests/setup.ts`],
        },
      },
      {
        extends: true,
        test: {
          name: "interface",
          environment: "jsdom",
          include: ["packages/ui/**/*.test.tsx", "apps/renderer/**/*.test.ts", "apps/renderer/**/*.test.tsx"],
          setupFiles: [`${here}/tests/setup.ts`],
        },
      },
    ],
  },
});

import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Test config, kept apart from `vite.config.ts` on purpose: the dev config
 * carries the platform plugin and the browser-runtime server settings, none of
 * which should be loaded by a unit test run.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/__tests__/setup.ts"],
    restoreMocks: true,
  },
});
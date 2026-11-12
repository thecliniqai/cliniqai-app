import { defineConfig } from "vitest/config";
import path from "path";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } from "./tests/setup/test-env";

// V2-01a (P0-10): the test lane never reads `.env`. It loads `.env.test` (local-stack values only) and the local
// stack's keys from `npx supabase status`, then refuses to start unless everything points at 127.0.0.1 and every
// external provider is offline. This runs at config load, before any test file is imported; globalSetup and a
// per-worker setup file re-check it.
loadTestEnv(__dirname);
loadLocalStackKeys(__dirname);
assertLocalTestEnv();

export default defineConfig({
  // Vite would otherwise read .env / .env.local from disk (VITE_* keys only, but the lane reads no .env at all).
  envDir: false,
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    exclude: ["tests/e2e/**", "**/node_modules/**"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
    globalSetup: ["./tests/setup/global-setup.ts"],
    setupFiles: ["./tests/setup/worker-guard.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      // D12: `server-only` is not a dependency; Next aliases it internally. Vitest resolves it to Next's bundled
      // empty module so services (`import "server-only"`) load in tests without adding a package.
      "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
    },
  },
});

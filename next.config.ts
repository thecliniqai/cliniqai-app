import { randomUUID } from "node:crypto";
import type { NextConfig } from "next";
import { assertDeployEnv } from "./lib/env";

// V2-03 03-01 (P1-15): `next build`, `next start` and `next dev` all load this file, so an environment that breaks a
// tier rule (e.g. production without real providers) stops the command here. The error names keys, never values.
assertDeployEnv(process.env);

// V2-06 06-09a (M-OFFLINE): one stamp per build, inlined by the bundler wherever `process.env.CLINICOS_BUILD_STAMP` is
// read (only `buildStamp()` in lib/env-server.ts). `/sw.js` carries it, so each deploy installs a new service worker
// and replaces the precached `/offline`. Vercel's deployment id when present, else a fresh random value per build.
const BUILD_STAMP = (process.env.VERCEL_DEPLOYMENT_ID ?? randomUUID()).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  env: { CLINICOS_BUILD_STAMP: BUILD_STAMP },
  // V2-06 06-05 (PWA_STRATEGY §3.7, §5; T-06-05): the service worker script is never cached by the browser or a proxy,
  // so a fixed or kill-switch worker reaches every device on its next check, and it may only run same-origin script.
  // The app CSP's `worker-src`/`manifest-src` stay with P1-18 (V2-14).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;

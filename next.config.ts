import type { NextConfig } from "next";
import { assertDeployEnv } from "./lib/env";

// V2-03 03-01 (P1-15): `next build`, `next start` and `next dev` all load this file, so an environment that breaks a
// tier rule (e.g. production without real providers) stops the command here. The error names keys, never values.
assertDeployEnv(process.env);

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
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

import { randomUUID } from "node:crypto";
import type { NextConfig } from "next";
import { assertDeployEnv, deploymentIdFrom } from "./lib/env";

// V2-03 03-01 (P1-15): `next build`, `next start` and `next dev` all load this file, so an environment that breaks a
// tier rule (e.g. production without real providers) stops the command here. The error names keys, never values.
assertDeployEnv(process.env);

// V2-06 06-09a (M-OFFLINE): one stamp per build, inlined by the bundler wherever `process.env.CLINICOS_BUILD_STAMP` is
// read (only `buildStamp()` in lib/env-server.ts). `/sw.js` carries it, so each deploy installs a new service worker
// and replaces the precached `/offline`. Vercel's deployment id when present, else a fresh random value per build.
const BUILD_STAMP = (process.env.VERCEL_DEPLOYMENT_ID ?? randomUUID()).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

// V2-06 06-06 (PWA_STRATEGY §3.7, R-21): Next's deployment id, from NEXT_DEPLOYMENT_ID or Vercel's VERCEL_DEPLOYMENT_ID
// (shape checked by assertDeployEnv above). With it Next adds `?dpl=` to static assets, sends `x-deployment-id` and
// writes `data-dpl-id` on `<html>`; `/api/session-status` reports the same value (`deploymentInfo()`), and the open app
// shows "A new version is ready" when they differ. Unset (local dev) → no id, no comparison. Staging is a Vercel Hobby
// project without Skew Protection, so this check is its only skew control. The service-worker stamp above stays per
// build (on Vercel both come from VERCEL_DEPLOYMENT_ID; the e2e lane's fixed NEXT_DEPLOYMENT_ID must not freeze it).
const DEPLOYMENT_ID = deploymentIdFrom(process.env) ?? undefined;

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  deploymentId: DEPLOYMENT_ID,
  // With a deploymentId Next uses one constant BUILD_ID for every build; null keeps Next's random id per build, which
  // the e2e lane's stale-build guard compares (`.next/BUILD_ID` vs `e2e-build-stamp.json`, RL-16).
  generateBuildId: async () => null,
  env: { CLINICOS_BUILD_STAMP: BUILD_STAMP },
  // V2-09b 09B-05 (P1-24, R-16) and 09B-06a (ruling R-U): a report is uploaded through the `uploadLabDocument` server action. Next's default body limit
  // for server actions is 1 MB, so a phone photo of a report failed before the action ran. Production runs on Vercel, which refuses bodies over 4.5 MB,
  // so the limit is 4 MB and so is the file limit (features/labs/utils.ts). The limit applies to every action (Next has no per-action setting) and the
  // body is read before an action authenticates, so `proxy.ts` refuses (413) any non-GET body over 1 MB, or of unknown length, unless the caller is
  // signed in and posts to a page that hosts the upload (`/consultation/`, `/patients/`). Larger uploads need a direct-to-Storage upload (PO decision).
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // V2-08 08-02 (R-13): registration is the `?new=1` sheet; the retired v1 page's address still lands on it. 08-03b (R-14):
  // the queue and the cabin are modes of Today (`/` redirects from its page, so the dashboard layout still signs a visitor in
  // first); 08-04b: `/calendar` is the Schedule (`?date` carries over; the v1 booking drawers are gone).
  async redirects() {
    return [
      { source: "/patients/new", destination: "/patients?new=1", permanent: true },
      { source: "/queue", destination: "/today", permanent: true },
      { source: "/cabin", destination: "/today?mode=doctor", permanent: true },
      { source: "/calendar", destination: "/schedule", permanent: true },
    ];
  },
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

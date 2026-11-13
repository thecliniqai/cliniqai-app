import type { NextConfig } from "next";
import { assertDeployEnv } from "./lib/env";

// V2-03 03-01 (P1-15): `next build`, `next start` and `next dev` all load this file, so an environment that breaks a
// tier rule (e.g. production without real providers) stops the command here. The error names keys, never values.
assertDeployEnv(process.env);

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;

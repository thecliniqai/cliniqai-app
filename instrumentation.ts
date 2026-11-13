import type { Instrumentation } from "next";

/**
 * Next.js instrumentation (V2-03 03-01, P1-15). `register()` runs once per server instance before it serves a request;
 * on the Node.js runtime it re-checks the environment, so a server started with a changed environment after the build
 * (`next start`, a Vercel function cold start) still refuses to serve with a configuration that breaks a tier rule.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertDeployEnv } = await import("./lib/env");
  assertDeployEnv(process.env);
}

/**
 * V2-03 03-09b (P1-25, FT-07, R-7): every server error Next sees (render, route handler, server action, proxy) goes to
 * the error sink, scrubbed: route pattern only, never the concrete path or query string (T-03-14), and no message that
 * has not passed `lib/observability/scrub.ts`. Node.js runtime only; never throws.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { reportRequestError } = await import("./lib/observability/sink");
    await reportRequestError(err, request, context);
  } catch {
    // Error reporting must never replace the original failure.
  }
};

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

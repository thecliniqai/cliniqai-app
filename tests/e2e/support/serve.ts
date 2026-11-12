/**
 * The Playwright `webServer.command` (V2-02 plan 02-03a, ruling RL-16). Starts `next start` on 127.0.0.1:3100 with
 * the explicit e2e environment, and refuses to start when:
 *   - the environment fails `assertLocalAppServerEnv` (non-loopback URL, hosted key, real credential, …);
 *   - `.next/` is not the output of `npm run e2e:build` (stamp missing, BUILD_ID or public env differ);
 *   - port 3100 is already taken (the lane never reuses a server it did not start).
 * The `next start` child gets ONLY `buildAppServerEnv()`; this wrapper's own environment is never passed on.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import {
  BUILD_ID_FILE,
  BUILD_STAMP_FILE,
  buildAppServerEnv,
  E2E_HOST,
  E2E_PORT,
  ROOT,
  stampProblems,
  type BuildStamp,
} from "./app-env";

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function main(): Promise<void> {
  const env = buildAppServerEnv();

  const buildId = fs.existsSync(BUILD_ID_FILE) ? fs.readFileSync(BUILD_ID_FILE, "utf8").trim() : null;
  const problems = stampProblems(readJson<BuildStamp>(BUILD_STAMP_FILE), buildId, env);
  if (problems.length) {
    throw new Error(`[e2e:serve] refusing to serve .next/:\n  - ${problems.join("\n  - ")}`);
  }
  if (!(await portFree(E2E_PORT, E2E_HOST))) {
    throw new Error(
      `[e2e:serve] port ${E2E_PORT} is already in use; the e2e lane never reuses a running server. Stop it and retry.`,
    );
  }

  const nextBin = require.resolve("next/dist/bin/next", { paths: [ROOT] });
  const child = spawn(process.execPath, [nextBin, "start", "-H", E2E_HOST, "-p", String(E2E_PORT)], {
    cwd: ROOT,
    env: env as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

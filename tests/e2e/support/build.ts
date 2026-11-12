/**
 * `npm run e2e:build` (V2-02 plan 02-03a, ruling RL-16): the only build the e2e lane will serve.
 *
 *  1. builds the explicit server env (`buildAppServerEnv`, which asserts it) — no `.env*` value can reach it;
 *  2. deletes any previous stamp, then runs `next build` with exactly that env (socket guard preloaded);
 *  3. scans `.next/static/**` and `.next/server/**` for hosted URLs/keys and fails on any finding;
 *  4. writes `.next/e2e-build-stamp.json` (BUILD_ID + hash of the inlined public env), which `serve.ts` requires.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  BUILD_ID_FILE,
  BUILD_STAMP_FILE,
  buildAppServerEnv,
  publicEnvHash,
  ROOT,
  type BuildStamp,
} from "./app-env";
import { scanBuildOutput } from "./build-scan";

function main(): number {
  const env = buildAppServerEnv();
  fs.rmSync(BUILD_STAMP_FILE, { force: true });

  const nextBin = require.resolve("next/dist/bin/next", { paths: [ROOT] });
  console.log("[e2e:build] next build with the guarded e2e environment (no .env, loopback only)");
  const build = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: ROOT,
    env: env as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
  if (build.error) throw build.error;
  if (build.status !== 0) {
    console.error(`[e2e:build] next build failed (exit ${build.status ?? build.signal})`);
    return 1;
  }

  const { files, findings } = scanBuildOutput(ROOT);
  if (findings.length) {
    console.error(`[e2e:build] REFUSED: the build output references hosted services (${findings.length} finding(s)):`);
    for (const f of findings) console.error(`  - ${f.file}: ${f.kind}`);
    fs.rmSync(BUILD_ID_FILE, { force: true });
    return 1;
  }

  const stamp: BuildStamp = {
    buildId: fs.readFileSync(BUILD_ID_FILE, "utf8").trim(),
    publicEnvHash: publicEnvHash(env),
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(BUILD_STAMP_FILE, `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`[e2e:build] output scan clean (${files} files); stamp written for build ${stamp.buildId}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

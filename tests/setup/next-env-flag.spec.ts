/**
 * Pins Next.js's internal `__NEXT_PROCESSED_ENV` behaviour (V2-02 plan 02-03a, ruling RL-16; risk K-2).
 *
 * The e2e app server is started with `__NEXT_PROCESSED_ENV=true` so `@next/env` assigns nothing from a developer's
 * `.env*` files (Next otherwise loads `.env` in every mode, filling unset keys). The flag is internal: if a Next
 * upgrade changes it, this spec fails loudly before the e2e lane silently starts reading `.env` again.
 *
 * Each case runs `loadEnvConfig` in a fresh Node process (it caches and rewrites `process.env`), in a temp directory
 * whose `.env` holds one synthetic key, with an explicit minimal environment.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const KEY = "E2E_FLAG_PIN_SYNTHETIC_KEY";
const VALUE = "synthetic-value-not-a-secret";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-env-flag-"));
  fs.writeFileSync(path.join(dir, ".env"), `${KEY}=${VALUE}\n`);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Runs `loadEnvConfig(dir)` (production mode, as `next build`/`next start`) and returns what the child then saw. */
function loadInChild(extraEnv: Record<string, string>): { value: string | null; loadedFiles: string[] } {
  const nextEnv = createRequire(path.join(ROOT, "package.json")).resolve("@next/env");
  const script = `
    const { loadEnvConfig } = require(${JSON.stringify(nextEnv)});
    const quiet = { info() {}, error() {} };
    const { loadedEnvFiles } = loadEnvConfig(${JSON.stringify(dir)}, false, quiet);
    process.stdout.write(JSON.stringify({
      value: process.env[${JSON.stringify(KEY)}] ?? null,
      loadedFiles: loadedEnvFiles.map((f) => f.path),
    }));
  `;
  const res = spawnSync(process.execPath, ["-e", script], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", ...extraEnv },
  });
  if (res.status !== 0) throw new Error(`child failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

describe("@next/env and __NEXT_PROCESSED_ENV", () => {
  it("control: without the flag, loadEnvConfig fills an unset key from .env", () => {
    const result = loadInChild({});
    expect(result.loadedFiles).toContain(".env");
    expect(result.value).toBe(VALUE);
  });

  it("with __NEXT_PROCESSED_ENV=true, the key stays unset (no .env value reaches the server)", () => {
    expect(loadInChild({ __NEXT_PROCESSED_ENV: "true" }).value).toBeNull();
  });
});

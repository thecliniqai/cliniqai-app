/**
 * V2-03 03-01 (I-07, R-15): `scripts/ci/env-example.mjs` keeps `.env.example` generated from `lib/env.ts`.
 * Runs the real script against a temp directory: `--check` fails on a stale or missing file without printing it, and
 * passes once the writer has run. The rendered template names every schema key, lists CRON_SECRET (I-07) and carries
 * no assignment of a deployment secret.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_DOCS, RETIRED_NAMES } from "@/lib/env";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts/ci/env-example.mjs");
const TEMPLATE = ".env" + ".example";

function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
}

describe("env-example generator", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-example-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("--check fails on a missing file, and on a stale one without printing its content", () => {
    expect(run(["--check", "--root", dir]).status).toBe(1);

    const stale = "STALE_ONLY_NAME=synthetic-stale-marker\n";
    fs.writeFileSync(path.join(dir, TEMPLATE), stale);
    const res = run(["--check", "--root", dir]);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toContain("out of date");
    expect(res.stdout + res.stderr).not.toContain("synthetic-stale-marker");
  });

  it("the writer produces a file that --check accepts", () => {
    expect(run(["--root", dir]).status).toBe(0);
    expect(run(["--check", "--root", dir]).status).toBe(0);
  });

  it("the template names every schema key and every retired name, and assigns no deployment secret", () => {
    const res = run(["--stdout"]);
    expect(res.status).toBe(0);
    const text = res.stdout;
    for (const name of Object.keys(ENV_DOCS)) expect(text).toMatch(new RegExp(`^(# )?${name}=`, "m"));
    for (const name of Object.keys(RETIRED_NAMES)) expect(text).toContain(`# ${name}:`);
    expect(text).toMatch(/^# CRON_SECRET=<set in Vercel>$/m);
    for (const secret of ["SUPABASE_SECRET_KEY", "MSG91_AUTH_KEY", "MSG91_WEBHOOK_SECRET", "AI_API_KEY", "TWILIO_AUTH_TOKEN"]) {
      expect(text).not.toMatch(new RegExp(`^${secret}=`, "m"));
    }
  });
});

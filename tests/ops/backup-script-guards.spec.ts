/**
 * V2-04 04-05a (FT-02; rulings R-3, R-14; threat T-04-11): ops/backup/backup.sh refuses an unsafe configuration
 * before touching anything (exit 2, naming the variable, never the value), and the failed-run drill (FORCE_FAIL=1,
 * 04-P11) fails the run (exit 64) without any connection or tool call, so backup-alert.yml opens the alert issue.
 *
 * Synthetic environment only: the child gets exactly the variables below (no inherited env), and a stub directory first
 * on PATH records every call to docker, npx, aws, psql, age, curl and node.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../ops/backup/backup.sh");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backup-guards-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const recipient = () => "age1" + Array.from(randomBytes(58), (b) => BECH32[b % 32]).join("");
const PASSWORD = `Pw${randomBytes(12).toString("hex")}`;
const S3_SECRET = randomBytes(16).toString("hex");
const R2_SECRET = randomBytes(16).toString("hex");

const STUBS = path.join(tmp, "stubs");
const CALLS = path.join(tmp, "calls.log");
fs.mkdirSync(STUBS);
for (const tool of ["docker", "npx", "aws", "psql", "age", "age-keygen", "curl", "node", "supabase"]) {
  fs.writeFileSync(path.join(STUBS, tool), `#!/bin/sh\necho "${tool} $*" >> "${CALLS}"\nexit 0\n`, { mode: 0o755 });
}

const STAGING = (): Record<string, string> => ({
  BACKUP_ENV: "staging",
  DB_URL: `postgresql://postgres.syntheticref:${PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  BACKUP_AGE_RECIPIENTS: `${recipient()} ${recipient()}`,
  BACKUP_S3_ENDPOINT: "https://syntheticaccount.r2.cloudflarestorage.com",
  BACKUP_S3_BUCKET: "clinicos-staging-backups",
  BACKUP_S3_ACCESS_KEY_ID: "synthetic-r2-key-id",
  BACKUP_S3_SECRET_ACCESS_KEY: R2_SECRET,
  STORAGE_S3_ENDPOINT: "https://syntheticref.storage.supabase.co/storage/v1/s3",
  STORAGE_S3_REGION: "ap-south-1",
  STORAGE_S3_KEY_ID: "synthetic-key-id",
  STORAGE_S3_SECRET: S3_SECRET,
});
const LOCAL = (): Record<string, string> => ({
  ...STAGING(),
  BACKUP_ENV: "local",
  DB_URL: `postgresql://postgres:${PASSWORD}@127.0.0.1:54322/postgres`,
  BACKUP_S3_BUCKET: "drill-selftest-target",
  BACKUP_S3_ENDPOINT: "http://127.0.0.1:54321/storage/v1/s3",
  STORAGE_S3_ENDPOINT: "http://127.0.0.1:54321/storage/v1/s3",
});

function run(env: Record<string, string>, args = ["--check-config"]) {
  fs.rmSync(CALLS, { force: true });
  const r = spawnSync("bash", [SCRIPT, ...args], {
    env: { NODE_ENV: "test", PATH: `${STUBS}:/usr/bin:/bin`, HOME: tmp, ...env },
    encoding: "utf8",
  });
  const output = `${r.stdout}${r.stderr}`;
  // No case may print the database password, the Storage S3 secret or a full URL.
  expect(output).not.toContain(PASSWORD);
  expect(output).not.toContain(S3_SECRET);
  expect(output).not.toContain(R2_SECRET);
  expect(output).not.toMatch(/postgres(ql)?:\/\//);
  const calls = fs.existsSync(CALLS) ? fs.readFileSync(CALLS, "utf8").trim() : "";
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}

describe("backup.sh --check-config", () => {
  it("accepts a complete staging configuration and a complete local one, calling no tool", () => {
    for (const env of [STAGING(), LOCAL()]) {
      const r = run(env);
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^backup: configuration ok \(env=(staging|local), recipients=2, prefix=(staging|local)\/\)$/m);
      expect(r.calls).toBe("");
    }
  });

  it("local with a non-loopback DB_URL: exit 2 naming DB_URL", () => {
    const r = run({ ...LOCAL(), DB_URL: `postgresql://postgres:${PASSWORD}@db.example.test:5432/postgres` });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("DB_URL must point at a loopback host when BACKUP_ENV=local");
  });

  it.each([
    ["127.0.0.1", "127.0.0.1:54322"],
    ["localhost", "localhost:54322"],
    ["[::1]", "[::1]:54322"],
    ["host.docker.internal", "host.docker.internal:54322"],
  ])("staging with a %s DB_URL: exit 2 naming DB_URL", (_label, hostPort) => {
    const r = run({ ...STAGING(), DB_URL: `postgresql://postgres:${PASSWORD}@${hostPort}/postgres` });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("DB_URL must not point at a loopback host when BACKUP_ENV=staging");
  });

  it("staging with one recipient, a duplicated recipient or a private key: exit 2 naming BACKUP_AGE_RECIPIENTS", () => {
    const one = recipient();
    const privateKey = ["AGE", "SECRET", "KEY", "1" + "Q".repeat(58)].join("-");
    for (const value of [one, `${one},${one}`, `${one},${privateKey}`, ""]) {
      const r = run({ ...STAGING(), BACKUP_AGE_RECIPIENTS: value });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/BACKUP_AGE_RECIPIENTS/);
      expect(r.stderr).not.toContain(privateKey);
    }
  });

  it("staging with a loopback or http target, a target equal to the source Storage, or a loopback/http Storage: exit 2", () => {
    expect(run({ ...STAGING(), BACKUP_S3_ENDPOINT: "http://127.0.0.1:54321/storage/v1/s3" }).stderr).toContain(
      "BACKUP_S3_ENDPOINT must be https when BACKUP_ENV=staging",
    );
    expect(run({ ...STAGING(), BACKUP_S3_ENDPOINT: "https://localhost:9000" }).stderr).toContain(
      "BACKUP_S3_ENDPOINT must not point at a loopback host when BACKUP_ENV=staging",
    );
    expect(run({ ...STAGING(), BACKUP_S3_ENDPOINT: "https://syntheticref.storage.supabase.co/storage/v1/s3" }).stderr).toContain(
      "BACKUP_S3_ENDPOINT must not be the source project's Storage endpoint",
    );
    expect(run({ ...LOCAL(), BACKUP_S3_ENDPOINT: "https://syntheticaccount.r2.cloudflarestorage.com" }).stderr).toContain(
      "BACKUP_S3_ENDPOINT must point at a loopback host when BACKUP_ENV=local",
    );
    expect(run({ ...STAGING(), STORAGE_S3_ENDPOINT: "http://syntheticref.storage.supabase.co/storage/v1/s3" }).status).toBe(2);
    expect(run({ ...STAGING(), STORAGE_S3_ENDPOINT: "https://localhost/storage/v1/s3" }).status).toBe(2);
  });

  it("refuses an unknown environment, a missing variable and a bad bucket name, each by name", () => {
    expect(run({ ...STAGING(), BACKUP_ENV: "prod" }).stderr).toContain("BACKUP_ENV must be local, staging or production");
    const noSecret = STAGING();
    delete noSecret.STORAGE_S3_SECRET;
    expect(run(noSecret).stderr).toContain("STORAGE_S3_SECRET is not set");
    expect(run({ ...STAGING(), BACKUP_S3_BUCKET: "Bad_Bucket" }).stderr).toContain("BACKUP_S3_BUCKET is not a valid bucket name");
    const noToken = STAGING();
    delete noToken.BACKUP_S3_SECRET_ACCESS_KEY;
    expect(run(noToken).stderr).toContain("BACKUP_S3_SECRET_ACCESS_KEY is not set");
    expect(run({ ...STAGING(), DB_URL: "mysql://x" }).stderr).toContain("DB_URL must use the postgres or postgresql scheme");
  });
});

describe("backup.sh FORCE_FAIL=1 (failed-run drill, 04-P11)", () => {
  it("exits 64 with a forced_failure line before any connection: no docker, npx, aws, psql or age call", () => {
    const r = run({ ...STAGING(), FORCE_FAIL: "1" }, []);
    expect(r.status).toBe(64);
    expect(r.stdout).toMatch(/backup\.failed error_code=forced_failure env=staging/);
    expect(r.calls).toBe("");
  });

  it("still refuses a bad configuration first (exit 2), so the drill never masks a config error", () => {
    const r = run({ ...STAGING(), FORCE_FAIL: "1", BACKUP_AGE_RECIPIENTS: recipient() }, []);
    expect(r.status).toBe(2);
    expect(r.calls).toBe("");
  });

  it("rejects an unknown argument with usage (exit 2)", () => {
    expect(run(STAGING(), ["--now"]).status).toBe(2);
  });
});

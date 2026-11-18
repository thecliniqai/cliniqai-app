/**
 * V2-04 04-05a (FT-02; R-3, R-31; threat T-04-11): ops/backup/backup.sh with BACKUP_ENV=local against the primary local
 * stack, with its Storage S3 endpoint standing in for the R2 bucket. Proves the artefact that leaves the machine is
 * age-encrypted to both recipients and unreadable without one of their keys, carries the dump, the Storage objects
 * and a manifest, writes a counts-only `ops.backup_runs` row, and that a failed run is recorded as `failed` with a
 * machine code and uploads nothing, and (04-07c) that the archive's SHA-256 is recorded in the row, the digest file and the
 * job summary. (The restore into the second stack is `ops/restore-drill/run.sh --self-test`,
 * nightly `backup-roundtrip` job and evidence/restore-drill-selftest.json.)
 *
 * Needs the pinned age binary (`ops/bin/install-age.sh`; CI's test job installs it) and Docker (pinned postgres:17 and
 * amazon/aws-cli images, ops/bin/pins.env). Synthetic data only; throwaway keys in a temp dir outside the repo, deleted.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { psql } from "../helpers/sql";

const ROOT = path.resolve(__dirname, "../..");
const BACKUP = path.join(ROOT, "ops/backup/backup.sh");
const SRC_BUCKET = "backup-spec-src";
const TARGET_BUCKET = "backup-spec-target";
const OBJECT_NAME = "spec/synthetic-object.bin";

function findAge(): string {
  const cached = path.join(ROOT, ".cache/ops-bin/age");
  if (fs.existsSync(cached)) return cached;
  const onPath = spawnSync("sh", ["-c", "command -v age"], { encoding: "utf8" }).stdout.trim();
  if (onPath) return onPath;
  throw new Error("age is not installed: run ops/bin/install-age.sh (pinned release, SHA-256 verified)");
}

function stackStatus(): Record<string, string> {
  const out = execFileSync("npx", ["supabase", "status", "--workdir", ROOT, "-o", "env"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const values: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = /^([A-Z0-9_]+)="(.*)"$/.exec(line);
    if (m) values[m[1]] = m[2];
  }
  return values;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backup-roundtrip-"));
const AGE = findAge();
const AGE_KEYGEN = path.join(path.dirname(AGE), "age-keygen");
const content = randomBytes(4096);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let st: Record<string, string>;
let recipients: string[] = [];
let maxIdBefore = "0";

function aws(args: string[]) {
  return spawnSync(path.join(ROOT, "ops/bin/aws-docker.sh"), [...args, "--endpoint-url", st.STORAGE_S3_URL], {
    cwd: tmp,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: tmp,
      AWS_DOCKER_MOUNT: tmp,
      AWS_ACCESS_KEY_ID: st.S3_PROTOCOL_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: st.S3_PROTOCOL_ACCESS_KEY_SECRET,
      AWS_REGION: st.S3_PROTOCOL_REGION,
      AWS_REQUEST_CHECKSUM_CALCULATION: "when_required",
      AWS_RESPONSE_CHECKSUM_VALIDATION: "when_required",
      NODE_ENV: "test",
    },
  });
}

function backup(overrides: Record<string, string> = {}) {
  return spawnSync("bash", [BACKUP], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      BACKUP_ENV: "local",
      DB_URL: st.DB_URL,
      BACKUP_AGE_RECIPIENTS: recipients.slice(0, 2).join(" "),
      AGE_BIN: AGE,
      BACKUP_S3_BUCKET: TARGET_BUCKET,
      BACKUP_S3_PREFIX: "local/",
      BACKUP_S3_ENDPOINT: st.STORAGE_S3_URL,
      BACKUP_S3_ACCESS_KEY_ID: st.S3_PROTOCOL_ACCESS_KEY_ID,
      BACKUP_S3_SECRET_ACCESS_KEY: st.S3_PROTOCOL_ACCESS_KEY_SECRET,
      STORAGE_S3_ENDPOINT: st.STORAGE_S3_URL,
      STORAGE_S3_REGION: st.S3_PROTOCOL_REGION,
      STORAGE_S3_KEY_ID: st.S3_PROTOCOL_ACCESS_KEY_ID,
      STORAGE_S3_SECRET: st.S3_PROTOCOL_ACCESS_KEY_SECRET,
      SUPABASE_WORKDIR: ROOT,
      ...overrides,
      NODE_ENV: "test",
    },
  });
}

const archives = () =>
  aws(["s3", "ls", `s3://${TARGET_BUCKET}/local/`]).stdout.split("\n").map((l) => l.trim().split(/\s+/)[3]).filter((k) => k?.endsWith(".tar.age"));

const lastRun = () =>
  psql(`select status || '|' || coalesce(object_key, '') || '|' || coalesce(error_code, '') || '|' || coalesce(manifest_counts::text, '') from ops.backup_runs where id > ${maxIdBefore} order by id desc limit 1`)[0];

beforeAll(() => {
  st = stackStatus();
  for (const name of ["DB_URL", "STORAGE_S3_URL", "S3_PROTOCOL_ACCESS_KEY_ID", "S3_PROTOCOL_ACCESS_KEY_SECRET", "S3_PROTOCOL_REGION"]) {
    if (!st[name]) throw new Error(`local stack status has no ${name}`);
  }
  expect(st.DB_URL).toMatch(/@127\.0\.0\.1:\d+\//);
  for (const k of ["primary", "breakglass", "unrelated"]) {
    execFileSync(AGE_KEYGEN, ["-o", path.join(tmp, `${k}.key`)], { stdio: "ignore" });
  }
  recipients = ["primary", "breakglass"].map((k) => execFileSync(AGE_KEYGEN, ["-y", path.join(tmp, `${k}.key`)], { encoding: "utf8" }).trim());
  for (const b of [SRC_BUCKET, TARGET_BUCKET]) aws(["s3", "rb", `s3://${b}`, "--force"]);
  for (const b of [SRC_BUCKET, TARGET_BUCKET]) expect(aws(["s3", "mb", `s3://${b}`]).status).toBe(0);
  fs.writeFileSync(path.join(tmp, "object.bin"), content);
  expect(aws(["s3", "cp", path.join(tmp, "object.bin"), `s3://${SRC_BUCKET}/${OBJECT_NAME}`, "--only-show-errors"]).status).toBe(0);
  maxIdBefore = psql("select coalesce(max(id), 0) from ops.backup_runs")[0];
}, 120_000);

afterAll(() => {
  if (st) for (const b of [SRC_BUCKET, TARGET_BUCKET]) aws(["s3", "rb", `s3://${b}`, "--force"]);
  psql(`delete from ops.backup_runs where id > ${maxIdBefore}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}, 120_000);

describe("backup.sh BACKUP_ENV=local (dump + Storage sync + age + upload to the stand-in)", () => {
  it("uploads an age archive that only the two recipients' keys open, holding the dump, the objects and the manifest", () => {
    const digestOut = path.join(tmp, "archive-digest.json");
    const summary = path.join(tmp, "step-summary.md");
    const r = backup({ BACKUP_DIGEST_OUT: digestOut, GITHUB_STEP_SUMMARY: summary });
    const output = r.stdout + r.stderr;
    expect(r.status, output.slice(-2000)).toBe(0);
    expect(output).toMatch(/backup\.encrypted age_header=ok bytes=\d+ sha256=[0-9a-f]{64}/);
    expect(output).not.toContain(st.S3_PROTOCOL_ACCESS_KEY_SECRET);
    expect(output).not.toMatch(/postgres(ql)?:\/\//);

    const keys = archives();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{6}Z\.tar\.age$/);
    const archive = path.join(tmp, "archive.tar.age");
    expect(aws(["s3", "cp", `s3://${TARGET_BUCKET}/local/${keys[0]}`, archive, "--only-show-errors"]).status).toBe(0);

    // Ciphertext: the age header, and neither the dump's SQL nor the object's bytes in the clear.
    const bytes = fs.readFileSync(archive);
    expect(bytes.subarray(0, 21).toString("latin1")).toBe("age-encryption.org/v1");
    expect(bytes.includes(Buffer.from('COPY "public"'))).toBe(false);
    expect(bytes.includes(content.subarray(0, 64))).toBe(false);

    // An unrelated key opens nothing; each recipient key opens it (primary and break-glass, R-3).
    expect(spawnSync(AGE, ["-d", "-i", path.join(tmp, "unrelated.key"), archive]).status).not.toBe(0);
    for (const k of ["primary", "breakglass"]) {
      const listing = execFileSync("sh", ["-c", `"$0" -d -i "$1" "$2" | tar -tf -`, AGE, path.join(tmp, `${k}.key`), archive], { encoding: "utf8" });
      for (const entry of ["manifest.json", "roles.sql", "schema.sql", "storage_policies.sql", "data.sql", "history_schema.sql", "history_data.sql"]) {
        expect(listing, `${k}: ${entry}`).toMatch(new RegExp(`(^|\\n)(\\./)?${entry.replace(".", "\\.")}\\n`));
      }
      expect(listing).toContain(`storage/${SRC_BUCKET}/${OBJECT_NAME}`);
    }

    const manifest = JSON.parse(
      execFileSync("sh", ["-c", `"$0" -d -i "$1" "$2" | tar -xOf - ./manifest.json`, AGE, path.join(tmp, "primary.key"), archive], { encoding: "utf8" }),
    );
    expect(manifest).toMatchObject({ format_version: 1, environment: "local", cli_version: "2.120.0", excluded_buckets: [TARGET_BUCKET] });
    expect(manifest.buckets[SRC_BUCKET].objects).toEqual([{ name: OBJECT_NAME, size: 4096, sha256: sha256(content) }]);
    expect(manifest.tables["public.tenants"]).toBe(Number(psql("select count(*) from public.tenants")[0]));
    expect(manifest.auth_users).toBe(Number(psql("select count(*) from auth.users")[0]));
    // The storage.objects policies (outside the CLI's schema dump) travel in the archive.
    expect(manifest.policies).toBe(Number(psql("select count(*) from pg_policies where schemaname in ('public', 'storage')")[0]));

    // One ok row: the uploaded key, counts only (no object name).
    const [status, objectKey, errorCode, counts] = lastRun().split("|");
    expect([status, objectKey, errorCode]).toEqual(["ok", `local/${keys[0]}`, ""]);
    expect(counts).not.toContain(OBJECT_NAME);
    expect(JSON.parse(counts).buckets[SRC_BUCKET]).toEqual({ objects: 1, bytes: 4096 });

    // 04-07c (M-BACKUPAUTH): the archive's SHA-256 is recorded outside the bucket, identically, in the row, the digest
    // file (backup.yml's artifact) and the job summary: what `run.sh --expect-sha256` checks before decrypting.
    const digest = sha256(bytes);
    expect(psql(`select archive_sha256 from ops.backup_runs where id > ${maxIdBefore} and status = 'ok' order by id desc limit 1`)).toEqual([digest]);
    expect(JSON.parse(fs.readFileSync(digestOut, "utf8"))).toEqual({
      format_version: 1,
      environment: "local",
      object_key: `local/${keys[0]}`,
      archive_sha256: digest,
      archive_bytes: bytes.length,
    });
    expect(fs.readFileSync(summary, "utf8")).toContain(`| \`local/${keys[0]}\` | \`${digest}\` | ${bytes.length} |`);
    expect(output).toContain(`sha256=${digest}`);
  }, 180_000);

  it("a failed step exits non-zero, records a `failed` row with a machine code and uploads nothing", () => {
    const before = archives().length;
    const r = backup({ STORAGE_S3_SECRET: randomBytes(16).toString("hex") });
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBe(2);
    expect(r.stdout).toMatch(/backup\.failed error_code=storage_failed env=local/);
    const [status, objectKey, errorCode] = lastRun().split("|");
    expect([status, objectKey, errorCode]).toEqual(["failed", "", "storage_failed"]);
    expect(archives()).toHaveLength(before);
  }, 180_000);
});

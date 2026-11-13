/**
 * V2-04 04-05a (FT-02, R-29): ops/restore-drill/compare-manifest.ts compares a restore with the archive's manifest.
 * Synthetic manifests and files only.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import {
  compareManifest,
  hashStorageDir,
  parseCounts,
  parseObjects,
  type ArchiveFile,
  type Manifest,
  type RestoredObject,
} from "../../ops/restore-drill/compare-manifest";

const ROOT = path.resolve(__dirname, "../..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const KEY = (bucket: string, name: string) => `${bucket}\u0000${name}`;

function manifest(): Manifest {
  return {
    format_version: 1,
    environment: "local",
    dump_started_at: "2026-11-13T02:00:00Z",
    dump_finished_at: "2026-11-13T02:01:00Z",
    cli_version: "2.120.0",
    server_version: "17.11",
    database_bytes: 1000,
    policies: 10,
    functions: 5,
    rls_tables: 3,
    auth_users: 2,
    tables: { "public.patients": 4, "public.tenants": 2, "auth.users": 2 },
    buckets: {
      "clinic-records": { objects: [{ name: "t1/a.pdf", size: 5, sha256: sha("aaaaa") }] },
      prescriptions: { objects: [{ name: "t1/rx.pdf", size: 3, sha256: sha("bbb") }] },
    },
    excluded_buckets: ["drill-selftest-target"],
  };
}

function files(): Map<string, ArchiveFile> {
  return new Map([
    [KEY("clinic-records", "t1/a.pdf"), { size: 5, sha256: sha("aaaaa") }],
    [KEY("prescriptions", "t1/rx.pdf"), { size: 3, sha256: sha("bbb") }],
  ]);
}

const counts = () => ({ "public.patients": 4, "public.tenants": 2, "auth.users": 2 });
const objects = (): RestoredObject[] => [
  { bucket: "clinic-records", name: "t1/a.pdf", size: 5 },
  { bucket: "prescriptions", name: "t1/rx.pdf", size: 3 },
  { bucket: "drill-selftest-target", name: "local/x.tar.age", size: 99 },
];

describe("compareManifest", () => {
  it("passes when the restore equals the manifest (excluded bucket rows are counted, not verified)", () => {
    const r = compareManifest(manifest(), counts(), objects(), files());
    expect(r).toMatchObject({ ok: true, problems: [], tables: 3, rows: 8, buckets: 2, objects_verified: 2, object_bytes: 8, objects_excluded: 1, files_without_row: 0 });
  });

  it("fails naming the table whose restored count differs, and a table missing after the restore", () => {
    const c: Record<string, number> = { ...counts(), "public.patients": 3 };
    delete c["public.tenants"];
    const r = compareManifest(manifest(), c, objects(), files());
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(["table public.patients: restored 3 rows, manifest 4", "table public.tenants: missing after restore (manifest 2 rows)"]);
  });

  it("fails naming the bucket when an archived file's size or SHA-256 differs from the manifest", () => {
    const f = files();
    f.set(KEY("prescriptions", "t1/rx.pdf"), { size: 3, sha256: sha("xxx") });
    const r = compareManifest(manifest(), counts(), objects(), f);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(["bucket prescriptions: 1 archived object(s) with a missing file or a size/SHA-256 mismatch"]);
    // The object name never appears in a problem.
    expect(r.problems.join(" ")).not.toContain("rx.pdf");
  });

  it("fails naming the bucket when a restored storage.objects row has no archived file of its size", () => {
    const o = objects();
    o.push({ bucket: "clinic-records", name: "t2/missing.pdf", size: 7 });
    o[0] = { ...o[0], size: 6 };
    const r = compareManifest(manifest(), counts(), o, files());
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(["bucket clinic-records: 2 restored storage.objects row(s) without an archived file of the same size"]);
  });

  it("reports an archived file without a restored row (uploaded after the dump) without failing", () => {
    const o = objects().filter((x) => x.bucket !== "prescriptions");
    const r = compareManifest(manifest(), counts(), o, files());
    expect(r).toMatchObject({ ok: true, files_without_row: 1 });
  });
});

describe("compare-manifest.ts CLI and parsers", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-compare-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("hashes the storage dir, parses the psql TSVs, exits 0 on a match and 1 naming the table on a mismatch", () => {
    const storage = path.join(tmp, "storage");
    fs.mkdirSync(path.join(storage, "clinic-records/t1"), { recursive: true });
    fs.mkdirSync(path.join(storage, "prescriptions/t1"), { recursive: true });
    fs.writeFileSync(path.join(storage, "clinic-records/t1/a.pdf"), "aaaaa");
    fs.writeFileSync(path.join(storage, "prescriptions/t1/rx.pdf"), "bbb");
    expect(hashStorageDir(storage)).toEqual(files());
    fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(manifest()));
    const countsTsv = "public.patients\t4\npublic.tenants\t2\nauth.users\t2\n";
    const objectsTsv = "clinic-records\tt1/a.pdf\t5\nprescriptions\tt1/rx.pdf\t\ndrill-selftest-target\tlocal/x.tar.age\t99\n";
    expect(parseCounts(countsTsv)).toEqual(counts());
    expect(parseObjects(objectsTsv)[1]).toEqual({ bucket: "prescriptions", name: "t1/rx.pdf", size: null });

    const run = (tsv: string) => {
      fs.writeFileSync(path.join(tmp, "counts.tsv"), tsv);
      fs.writeFileSync(path.join(tmp, "objects.tsv"), objectsTsv);
      return spawnSync(
        "npx",
        ["tsx", "ops/restore-drill/compare-manifest.ts", "--manifest", path.join(tmp, "manifest.json"), "--restored-counts",
          path.join(tmp, "counts.tsv"), "--restored-objects", path.join(tmp, "objects.tsv"), "--storage-dir", storage,
          "--out", path.join(tmp, "result.json")],
        { cwd: ROOT, encoding: "utf8" },
      );
    };
    const ok = run(countsTsv);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("compare-manifest: PASS tables=3 rows=8 buckets=2 objects_verified=2");
    const bad = run(countsTsv.replace("public.tenants\t2", "public.tenants\t1"));
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("table public.tenants: restored 1 rows, manifest 2");
    expect(JSON.parse(fs.readFileSync(path.join(tmp, "result.json"), "utf8")).ok).toBe(false);
  }, 60_000);
});

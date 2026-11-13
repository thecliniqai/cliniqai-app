/**
 * V2-04 04-05a (FT-02 acceptance 5; R-28): ops/backup/evidence.ts turns the R2 bucket listing (and, after the 04-P11
 * drill, `gh run list` output) into the backup-evidence artifact and its verdicts; `--check` re-validates a downloaded
 * artifact. Fixture JSON only; no network.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildEvidence, checkEvidence, DRILL_TITLE, fullIstDays, VERDICTS, type Evidence } from "../../ops/backup/evidence";

const ROOT = path.resolve(__dirname, "../..");
// 2026-11-13 18:00 IST: the last two full IST days are 11 and 12 November.
const NOW = new Date("2026-11-13T12:30:00Z");

/** A listing entry for an archive uploaded at an IST wall-clock time (the 02:0x and 14:0x runs). */
const obj = (istDay: string, hhmm: string, size = 1_234_567) => {
  const utc = new Date(Date.parse(`${istDay}T${hhmm}:00+05:30`));
  const s = utc.toISOString();
  const key = `staging/${s.slice(0, 10)}T${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}Z.tar.age`;
  return { Key: key, Size: size, LastModified: s, ETag: '"x"', StorageClass: "STANDARD" };
};
const FOUR = [obj("2026-11-11", "02:04"), obj("2026-11-11", "14:05"), obj("2026-11-12", "02:03"), obj("2026-11-12", "14:06")];
const listing = (contents: object[]) => ({ Contents: contents, KeyCount: contents.length });

const run = (id: number, conclusion: string, createdAt: string, displayTitle = "Staging backup") => ({ databaseId: id, conclusion, createdAt, displayTitle, event: "workflow_dispatch" });
const DRILL = [run(10, "failure", "2026-11-12T10:00:00Z", DRILL_TITLE), run(9, "success", "2026-11-12T08:30:00Z")];
const ALERTED = [run(20, "success", "2026-11-12T10:01:30Z", "Staging backup alert")];

const build = (contents: object[], extra: { runs?: unknown; alertRuns?: unknown } = {}) =>
  buildEvidence({ listing: listing(contents), prefix: "staging/", days: 2, now: NOW, ...extra });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backup-evidence-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("buildEvidence verdicts", () => {
  it("one archive in each IST window on both full days, and the drill alerted → every verdict true", () => {
    const e = build(FOUR, { runs: DRILL, alertRuns: ALERTED });
    expect(e.days_checked).toEqual(["2026-11-11", "2026-11-12"]);
    expect(e.verdicts).toEqual(Object.fromEntries(VERDICTS.map((v) => [v, true])));
  });

  it("a missing 14:00 archive → twice_daily_ok false; an archive outside both windows does not count", () => {
    expect(build(FOUR.slice(0, 3)).verdicts.twice_daily_ok).toBe(false);
    expect(build([...FOUR.slice(0, 3), obj("2026-11-12", "17:00")]).verdicts.twice_daily_ok).toBe(false);
    expect(build([...FOUR.slice(0, 3), obj("2026-11-12", "14:06", 0)]).verdicts.twice_daily_ok).toBe(false);
  });

  it("an object older than 31 days → retention_ok false (the 30-day lifecycle rule is not working)", () => {
    expect(build([...FOUR, obj("2026-10-10", "02:01")]).verdicts.retention_ok).toBe(false);
    expect(build([...FOUR, obj("2026-10-15", "02:01")]).verdicts.retention_ok).toBe(true);
  });

  it("an object key that is not <env>/<timestamp>.tar.age → keys_ok false", () => {
    const named = { ...FOUR[0], Key: "staging/clinic-ravi-patients.sql" };
    expect(build([...FOUR, named]).verdicts.keys_ok).toBe(false);
  });

  it("failed_run_alerted needs a failed drill run AND a later successful alert run", () => {
    expect(build(FOUR).verdicts.failed_run_alerted).toBe(false);
    expect(build(FOUR, { runs: DRILL, alertRuns: [] }).verdicts.failed_run_alerted).toBe(false);
    const notDrill = [run(10, "failure", "2026-11-12T10:00:00Z")];
    expect(build(FOUR, { runs: notDrill, alertRuns: ALERTED }).verdicts.failed_run_alerted).toBe(false);
    const alertBefore = [run(20, "success", "2026-11-12T09:00:00Z", "Staging backup alert")];
    expect(build(FOUR, { runs: DRILL, alertRuns: alertBefore }).verdicts.failed_run_alerted).toBe(false);
  });

  it("records keys, sizes and timestamps only (ETag, storage class and other prefixes dropped)", () => {
    const e = build([...FOUR, { ...obj("2026-11-12", "02:00"), Key: "other/2026-11-12T020000Z.tar.age" }]);
    expect(e.objects).toHaveLength(4);
    expect(Object.keys(e.objects[0]).sort()).toEqual(["key", "last_modified", "size"]);
    expect(checkEvidence(e, ["keys_ok", "retention_ok", "twice_daily_ok"])).toEqual({ ok: true, problems: [] });
  });
});

describe("evidence --check", () => {
  const good = (): Evidence => build(FOUR, { runs: DRILL, alertRuns: ALERTED });

  it("passes a clean file; fails an extra key, a tampered verdict or a false required verdict", () => {
    expect(checkEvidence(good()).ok).toBe(true);
    const extra = good() as unknown as Record<string, unknown>;
    (extra.objects as Record<string, unknown>[])[0].contents = "x";
    expect(checkEvidence(extra).problems).toContain("objects[].contents is not an allowed key");
    const tampered = good();
    tampered.objects.pop();
    expect(checkEvidence(tampered).problems).toEqual(
      expect.arrayContaining(["verdict twice_daily_ok does not match the recorded data", "verdict twice_daily_ok is false"]),
    );
    const pending = build(FOUR);
    expect(checkEvidence(pending).problems).toEqual(["verdict failed_run_alerted is false"]);
    expect(checkEvidence(pending, VERDICTS.filter((v) => v !== "failed_run_alerted")).ok).toBe(true);
  });

  it("CLI: --listing writes the artifact; --check exits 0 on it and 1 on a tampered copy", () => {
    const listingFile = path.join(tmp, "listing.json");
    const out = path.join(tmp, "out/backup-evidence.json");
    fs.writeFileSync(listingFile, JSON.stringify(listing(FOUR)));
    const w = spawnSync("npx", ["tsx", "ops/backup/evidence.ts", "--listing", listingFile, "--prefix", "staging/", "--out", out], { cwd: ROOT, encoding: "utf8" });
    expect(w.status).toBe(0);
    const ok = spawnSync("npx", ["tsx", "ops/backup/evidence.ts", "--check", out, "--require", "keys_ok,retention_ok"], { cwd: ROOT, encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("| keys_ok | true |");
    expect(ok.stdout).toContain("evidence: PASS");
    const bad = JSON.parse(fs.readFileSync(out, "utf8"));
    bad.verdicts.keys_ok = false;
    fs.writeFileSync(out, JSON.stringify(bad));
    const r = spawnSync("npx", ["tsx", "ops/backup/evidence.ts", "--check", out, "--require", "keys_ok"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("verdict keys_ok does not match the recorded data");
  }, 60_000);

  it("fullIstDays: the n IST calendar days before now's IST day", () => {
    expect(fullIstDays(new Date("2026-11-12T19:00:00Z"), 2)).toEqual(["2026-11-11", "2026-11-12"]);
    expect(fullIstDays(new Date("2026-11-12T18:00:00Z"), 1)).toEqual(["2026-11-11"]);
  });
});

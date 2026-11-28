/**
 * V2-14 14-02 (SVP §3): scripts/ci/osv-gate.mjs blocks a high or critical advisory with a fix in a production dependency
 * unless the shared npm-audit allowlist waives it, blocks any malicious-package entry, reports dev-only and unfixed
 * findings, and fails closed on a broken report. Fixtures in lint-fixtures/osv/; no network.
 */
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const F = "lint-fixtures/osv";
const gate = (report: string) =>
  runNodeChecker("osv-gate.mjs", ["--report", `${F}/${report}.json`, "--lockfile", `${F}/lock.json`, "--allowlist", `${F}/allowlist.json`]);

describe("osv gate", () => {
  it("passes when the only production high is waived; dev-only, unfixed and moderate findings are reported, not blocking", () => {
    const r = gate("report-pass");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("4 finding(s); 0 blocking");
    expect(r.stdout).toMatch(/GHSA-aaaa-bbbb-cccc\s+fixture-waived@2\.0\.0\s+waived/);
    expect(r.stdout).toMatch(/GHSA-dddd-eeee-ffff\s+fixture-dev@3\.0\.0\s+report \(dev only\)/);
    expect(r.stdout).toMatch(/GHSA-gggg-hhhh-jjjj\s+fixture-nofix@4\.0\.0\s+report \(no fix yet\)/);
    // The GitHub rating wins over the CVSS score (7.4 would read as high).
    expect(r.stdout).toMatch(/moderate GHSA-kkkk-mmmm-nnnn\s+fixture-moderate@5\.0\.0\s+report/);
    expect(r.stdout).toContain("osv-gate: PASS");
  });

  it("fails on a production critical with a fix that is not waived, naming it", () => {
    const r = gate("report-prod-critical");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL critical GHSA-pppp-qqqq-rrrr in fixture-prod@1.0.0");
    expect(r.stderr).not.toContain("GHSA-aaaa-bbbb-cccc");
  });

  it("an advisory with no rating and no score counts as high (fail closed)", () => {
    const r = gate("report-unrated");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("high OSV-2026-1 in fixture-prod@1.0.0");
  });

  it("a malicious-package entry fails even in a dev dependency with no fix", () => {
    const r = gate("report-malicious");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("malicious package");
    expect(r.stderr).toContain("MAL-2026-1 in fixture-evil@6.0.0");
  });

  it("fails closed on a report that is not an OSV-Scanner report, or a missing one", () => {
    expect(gate("report-broken").status).toBe(2);
    expect(gate("does-not-exist").status).toBe(2);
    expect(runNodeChecker("osv-gate.mjs", []).status).toBe(2);
  });
});

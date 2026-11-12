/**
 * npm audit gate (V2-02 02-01 step 4, RL-7): proves scripts/ci/audit-gate.mjs fails on a non-allowlisted high or
 * critical advisory and on expired, over-long or stale waivers, fails closed when the audit errors, and passes when
 * every gated advisory is waived. Reports are fixtures (lint-fixtures/audit/) passed with --audit-json, so no network.
 */
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const F = "lint-fixtures/audit";
const TODAY = "2026-11-12";
const gate = (report: string, allowlist: string) =>
  runNodeChecker("audit-gate.mjs", [
    "--audit-json",
    `${F}/${report}.json`,
    "--allowlist",
    `${F}/${allowlist}.json`,
    "--today",
    TODAY,
  ]);

describe("audit gate", () => {
  it("passes when every high/critical advisory is waived (moderate advisories are not gated)", () => {
    const r = gate("report-waived", "allowlist-valid");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 high/critical advisory");
    expect(r.stdout).toContain("audit-gate: PASS");
    expect(r.stdout).not.toContain("GHSA-dddd-eeee-ffff");
  });

  it("fails on a critical advisory that is not on the allowlist, naming it", () => {
    const r = gate("report-new-critical", "allowlist-valid");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NOT ALLOWLISTED: critical GHSA-gggg-hhhh-jjjj in fixture-new");
    expect(r.stderr).not.toContain("GHSA-aaaa-bbbb-cccc");
  });

  it("fails when a waived advisory is re-rated above the waiver's recorded severity (AR-L3)", () => {
    const r = gate("report-rerated", "allowlist-valid");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NOT ALLOWLISTED: critical GHSA-aaaa-bbbb-cccc in fixture-transitive");
    expect(r.stderr).toContain("advisory RE-RATED from high to critical; the waiver no longer applies");
  });

  it("fails on an expired waiver", () => {
    const r = gate("report-waived", "allowlist-expired");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("waiver EXPIRED on 2026-11-11");
  });

  it("fails on a stale waiver that matches no advisory any more", () => {
    const r = gate("report-waived", "allowlist-stale");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("GHSA-kkkk-mmmm-nnnn (fixture-fixed-long-ago): STALE waiver");
  });

  it("fails on a waiver dated more than 90 days ahead", () => {
    const r = gate("report-waived", "allowlist-too-long");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("more than 90 days ahead");
  });

  it("fails closed when npm audit reports an error", () => {
    const r = gate("report-error", "allowlist-valid");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("failing closed");
  });
});

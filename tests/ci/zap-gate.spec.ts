/**
 * V2-14 14-02 (SVP §7, plan D-1): scripts/security/zap-gate.mjs fails the ZAP baseline on any High alert (unless ZAP
 * rated it a false positive), reports the rest, never prints query strings, and fails closed on an empty or malformed
 * report. Sample reports in lint-fixtures/zap/; no network, no ZAP.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, runChecker } from "./run-checker";

const gate = (report: string) =>
  runChecker(process.execPath, [path.join(ROOT, "scripts/security/zap-gate.mjs"), `lint-fixtures/zap/${report}.json`]);

describe("zap gate", () => {
  it("passes with Medium, Low and Informational alerts, listing them", () => {
    const r = gate("report-pass");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("3 alert type(s), 0 blocking (High)");
    expect(r.stdout).toContain("Content Security Policy (CSP) Header Not Set");
    expect(r.stdout).toContain("zap-gate: PASS");
    expect(r.stdout).not.toContain("secret");
  });

  it("fails on a High alert, naming it and its paths", () => {
    const r = gate("report-high");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL High 40012 Cross Site Scripting (Reflected) at /login /join");
    expect(r.stderr + r.stdout).not.toContain("secret");
  });

  it("a High that ZAP itself rates a false positive does not block", () => {
    const r = gate("report-high-false-positive");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("[false positive]");
  });

  it("fails closed on a report with no site, a bad risk code, or no report", () => {
    expect(gate("report-empty").status).toBe(2);
    expect(gate("report-bad-risk").status).toBe(2);
    expect(gate("missing").status).toBe(2);
  });
});

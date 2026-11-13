/**
 * AUTH-00 staging re-check dispatch inputs (V2-03 03-13b, for 03-13a kit items 10 and 11): staging.yml passes the
 * optional `stale_wait_seconds` / `email_cap_probe` inputs through `env` only, and scripts/staging/recheck-args.mjs
 * turns them into the kit's `--stale-wait-seconds` / `--email-cap-probe` arguments (argument array, no shell) or
 * refuses the run. Proves the inputs reach the kit's argv, that empty inputs leave the probes off, that anything but
 * an in-range whole number (including shell syntax) is refused without being echoed, and that the ranges equal the
 * kit's own. The kit itself is replaced by a fake `npx` on PATH that prints its argv; nothing hosted is contacted.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_EMAIL_CAP_PROBE, STALE_WAIT_RANGE } from "@/scripts/staging/auth00-recheck-lib";
import { EMAIL_CAP_PROBE_MAX, STALE_WAIT_SECONDS, recheckArgs } from "@/scripts/staging/recheck-args.mjs";
import { checkWorkflow } from "@/scripts/ci/workflow-policy.mjs";
import { ROOT } from "./run-checker";

const BASE = ["tsx", "scripts/staging/auth00-recheck.ts", "--target", "staging", "--out", "report.json"];

/** Runs the wrapper CLI with a fake `npx` that prints the argv it was given as JSON. */
function runWrapper(env: Record<string, string>) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-npx-"));
  try {
    fs.writeFileSync(path.join(bin, "npx"), `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/staging/recheck-args.mjs"), "--out", "report.json"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, ...env } as unknown as NodeJS.ProcessEnv,
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

describe("re-check dispatch inputs reach the kit's arguments", () => {
  it("empty inputs: the kit runs without the optional probes", () => {
    expect(recheckArgs({}, "report.json")).toEqual({ args: BASE, problems: [] });
    expect(recheckArgs({ PO_STALE_WAIT_SECONDS: "", PO_EMAIL_CAP_PROBE: " " }, "report.json")).toEqual({ args: BASE, problems: [] });
  });

  it("in-range values become --stale-wait-seconds / --email-cap-probe (CLI: the kit's argv, no shell)", () => {
    expect(recheckArgs({ PO_STALE_WAIT_SECONDS: "700", PO_EMAIL_CAP_PROBE: "5" }, "report.json").args).toEqual([
      ...BASE,
      "--stale-wait-seconds",
      "700",
      "--email-cap-probe",
      "5",
    ]);
    const r = runWrapper({ PO_STALE_WAIT_SECONDS: "601", PO_EMAIL_CAP_PROBE: "70" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual([...BASE, "--stale-wait-seconds", "601", "--email-cap-probe", "70"]);
  });

  it.each([
    ["PO_STALE_WAIT_SECONDS", "600"],
    ["PO_STALE_WAIT_SECONDS", "891"],
    ["PO_STALE_WAIT_SECONDS", "7e2"],
    ["PO_STALE_WAIT_SECONDS", "700; touch /tmp/LEAKpwn"],
    ["PO_EMAIL_CAP_PROBE", "0"],
    ["PO_EMAIL_CAP_PROBE", "71"],
    ["PO_EMAIL_CAP_PROBE", "$(id)LEAK"],
    ["PO_EMAIL_CAP_PROBE", "true"],
  ])("%s=%s is refused before the kit starts (exit 2, value not echoed)", (name, value) => {
    expect(recheckArgs({ [name]: value }, "report.json").problems).toHaveLength(1);
    const r = runWrapper({ [name]: value });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("recheck-args: REFUSED");
    if (value.includes("LEAK")) expect(r.stderr).not.toContain("LEAK");
  });

  it("the ranges equal the kit's own", () => {
    expect(STALE_WAIT_SECONDS).toEqual({ min: STALE_WAIT_RANGE.min, max: STALE_WAIT_RANGE.max });
    expect(EMAIL_CAP_PROBE_MAX).toBe(MAX_EMAIL_CAP_PROBE);
  });

  it("staging.yml passes the inputs through env only: interpolating one into run: fails the workflow policy", () => {
    const text = fs.readFileSync(path.join(ROOT, ".github/workflows/staging.yml"), "utf8");
    expect(checkWorkflow(".github/workflows/staging.yml", text)).toEqual([]);
    const injected = text.replace(
      "run: node scripts/staging/recheck-args.mjs --out auth00-recheck-report.json",
      "run: npx tsx scripts/staging/auth00-recheck.ts --target staging --stale-wait-seconds ${{ inputs.stale_wait_seconds }}",
    );
    expect(injected).not.toBe(text);
    expect(checkWorkflow(".github/workflows/staging.yml", injected).map((f: { rule: string }) => f.rule)).toEqual(["run-no-untrusted-expression"]);
  });
});

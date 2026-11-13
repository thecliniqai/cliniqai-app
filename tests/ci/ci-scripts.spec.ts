/**
 * CI hardening scripts (V2-02 02-06):
 *   - scripts/ci/retry.mjs (IR-F8): `supabase start` is retried with cleanup and backoff, a bounded number of times,
 *     and a step that keeps failing still fails;
 *   - scripts/ci/pick-nightly-issue.mjs (AR-L1): the nightly workflow comments only on the "Nightly failing" issue
 *     its own bot opened, never on one a stranger opened with the same title.
 * Both run as child processes, the way the workflows run them; nothing touches the network.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, runNodeChecker } from "./run-checker";

function counterDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ci-retry-"));
}

/** A command that fails until it has run `succeedOn` times (counting in a file), then exits 0. */
const flaky = (dir: string, succeedOn: number) => [
  process.execPath,
  "-e",
  `const f=require("path").join(${JSON.stringify(dir)},"n");const fs=require("fs");` +
    `const n=(fs.existsSync(f)?Number(fs.readFileSync(f,"utf8")):0)+1;fs.writeFileSync(f,String(n));process.exit(n>=${succeedOn}?0:7);`,
];
const runs = (dir: string) => Number(fs.readFileSync(path.join(dir, "n"), "utf8"));

describe("retry.mjs (IR-F8)", () => {
  it("retries a failing step, running the cleanup between attempts, until it succeeds", () => {
    const dir = counterDir();
    const cleanup = `${JSON.stringify(process.execPath)} -e "require('fs').appendFileSync(${JSON.stringify(path.join(dir, "cleanup")).replace(/"/g, "'")}, 'x')"`;
    const r = runNodeChecker("retry.mjs", ["--attempts", "3", "--delay", "0", "--cleanup", cleanup, "--", ...flaky(dir, 3)]);
    expect(r.status).toBe(0);
    expect(runs(dir)).toBe(3);
    expect(fs.readFileSync(path.join(dir, "cleanup"), "utf8")).toBe("xx");
    expect(r.stdout).toContain("retry: succeeded on attempt 3/3");
  });

  it("gives up after the bounded number of attempts with the step's own exit code", () => {
    const dir = counterDir();
    const r = runNodeChecker("retry.mjs", ["--attempts", "2", "--delay", "0", "--", ...flaky(dir, 10)]);
    expect(r.status).toBe(7);
    expect(runs(dir)).toBe(2);
    expect(r.stderr).toContain("retry: attempt 2/2 exited 7");
  });

  it("refuses an unbounded or malformed retry", () => {
    expect(runNodeChecker("retry.mjs", ["--attempts", "50", "--", "true"]).status).toBe(2);
    expect(runNodeChecker("retry.mjs", ["--attempts", "3"]).status).toBe(2);
  });
});

describe("pick-nightly-issue.mjs (AR-L1)", () => {
  const pick = (issues: unknown, args: string[] = []) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/ci/pick-nightly-issue.mjs"), ...args], {
      input: JSON.stringify(issues),
      encoding: "utf8",
    });
    return { status: r.status, out: r.stdout.trim() };
  };
  const bot = { login: "app/github-actions", is_bot: true };
  const stranger = { login: "someone-else", is_bot: false };

  it("picks the bot's own issue even when a stranger's same-titled issue is listed first", () => {
    expect(
      pick([
        { number: 7, title: "Nightly failing", author: stranger },
        { number: 3, title: "Nightly failing", author: bot },
      ]),
    ).toEqual({ status: 0, out: "3" });
  });

  it("--title picks the bot's own issue with that title (V2-04 04-05a backup alert), never the default one", () => {
    const issues = [
      { number: 3, title: "Nightly failing", author: bot },
      { number: 9, title: "Staging backup failing", author: stranger },
      { number: 11, title: "Staging backup failing", author: bot },
    ];
    expect(pick(issues, ["--title", "Staging backup failing"])).toEqual({ status: 0, out: "11" });
    expect(pick(issues.slice(0, 2), ["--title", "Staging backup failing"])).toEqual({ status: 0, out: "" });
    expect(pick(issues, ["--title"]).status).toBe(2);
  });

  it("picks nothing when only a stranger's issue (or a near-miss title) exists, so the bot opens its own", () => {
    expect(pick([{ number: 7, title: "Nightly failing", author: stranger }])).toEqual({ status: 0, out: "" });
    expect(pick([{ number: 8, title: "Nightly failing!", author: bot }])).toEqual({ status: 0, out: "" });
    expect(pick([{ number: 9, title: "Nightly failing", author: { login: "app/github-actions", is_bot: false } }])).toEqual({
      status: 0,
      out: "",
    });
  });

  it("exits 2 on input that is not a JSON array", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/ci/pick-nightly-issue.mjs")], { input: "nope", encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});

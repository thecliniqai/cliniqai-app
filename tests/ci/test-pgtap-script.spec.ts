/**
 * scripts/test-pgtap.mjs (V2-05 05-01a): the pgTAP lane refuses any target flag before it takes the test-run lock or
 * spawns the Supabase CLI, runs exactly `npx supabase test db --local --debug supabase/tests/database`, tees the CLI's
 * stdout to the report, exits with the CLI's code and always releases the lock. The CLI, the lock and the report
 * stream are injected; nothing here touches the database.
 */
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CLI_ARGS, runPgTap } from "../../scripts/test-pgtap.mjs";

class Sink extends Writable {
  text = "";
  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
    this.text += chunk.toString();
    cb();
  }
}

function fakeCli(stdoutText: string, exitCode: number) {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => {
      child.stdout.end(stdoutText);
      child.stderr.end("Connecting to local database...\n");
      child.stdout.on("end", () => setImmediate(() => child.emit("close", exitCode)));
      child.stdout.resume();
    });
    return child;
  });
}

function deps(spawn: ReturnType<typeof vi.fn>) {
  const report = new Sink();
  const stdout = new Sink();
  const stderr = new Sink();
  const acquireLock = vi.fn(() => "/tmp/fake.lock");
  const releaseLock = vi.fn();
  const openReport = vi.fn(() => report);
  return { spawn, acquireLock, releaseLock, openReport, stdout, stderr, report, cwd: "/repo" };
}

describe("test:pgtap target guard", () => {
  it.each([
    [["--linked"]],
    [["--db-url", "postgresql://user@db.example.com:5432/postgres"]],
    [["--db-url=postgresql://user@db.example.com:5432/postgres"]],
    [["--project-ref", "abcdefghijklmnopqrst"]],
    [["report.tap", "--linked"]],
    [["postgresql://user@db.example.com:5432/postgres"]],
  ])("refuses %j with exit 1, without taking the lock or invoking the CLI", async (argv) => {
    const spawn = fakeCli("", 0);
    const d = deps(spawn);
    const code = await runPgTap(argv, d as never);
    expect(code).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(d.acquireLock).not.toHaveBeenCalled();
    expect(d.openReport).not.toHaveBeenCalled();
    expect(d.stderr.text).toMatch(/\[test:pgtap\] refusing/);
  });

  it("refuses more than one report path", async () => {
    const spawn = fakeCli("", 0);
    const d = deps(spawn);
    expect(await runPgTap(["a.tap", "b.tap"], d as never)).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("test:pgtap run", () => {
  it("runs the local pgTAP directory only, tees stdout to the report and returns the CLI's exit code", async () => {
    const tap = "/repo/supabase/tests/database/x.test.sql .. \n1..1\nnot ok 1 - x\nResult: FAIL\n";
    const spawn = fakeCli(tap, 1);
    const d = deps(spawn);
    const code = await runPgTap(["out.tap"], d as never);
    expect(code).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe("npx");
    expect(args).toEqual(["supabase", "test", "db", "--local", "--debug", "supabase/tests/database"]);
    expect(args).toEqual(CLI_ARGS);
    expect(args).not.toContain("--linked");
    expect(d.openReport).toHaveBeenCalledWith("/repo/out.tap");
    expect(d.report.text).toBe(tap);
    expect(d.stdout.text).toContain(tap);
    expect(d.stderr.text).not.toContain("not ok");
    expect(d.acquireLock).toHaveBeenCalledTimes(1);
    expect(d.releaseLock).toHaveBeenCalledWith("/tmp/fake.lock");
  });

  it("defaults the report to pgtap-report.tap and passes a green run through as 0", async () => {
    const spawn = fakeCli("Result: PASS\n", 0);
    const d = deps(spawn);
    expect(await runPgTap([], d as never)).toBe(0);
    expect(d.openReport).toHaveBeenCalledWith("/repo/pgtap-report.tap");
    expect(d.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("fails fast with exit 1 and does not run the CLI when the test-run lock is held", async () => {
    const spawn = fakeCli("", 0);
    const d = deps(spawn);
    d.acquireLock.mockImplementation(() => {
      throw new Error("Another test run (pid 1) is using the local stack at 127.0.0.1:54321.");
    });
    expect(await runPgTap([], d as never)).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(d.stderr.text).toContain("Another test run");
  });
});

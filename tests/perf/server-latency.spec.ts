/**
 * V2-09e 09E-01 (R-3): the server-side latency preload (`tests/e2e/support/server-latency.cjs`), run in a child Node process exactly as
 * `NODE_OPTIONS=--require` loads it into the e2e app server, with a fake inner `fetch` (no network at all). The delay and the record apply
 * only to the local Supabase origin (loopback, port 54321) and only while the rule file exists.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SERVER_LATENCY } from "../e2e/support/app-env";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-latency-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Probe {
  /** ms from the call to the inner fetch being reached. */
  waited: number;
  innerCalls: number;
}

/** Runs the calls in order in a child that preloads the hook over a fake `fetch`; the rule file can be removed between calls. */
function run(rule: { ms: number } | null, urls: Array<string | { url: string; removeRuleBefore: true }>, extra?: { init?: RequestInit }): Probe[] {
  const ruleFile = path.join(dir, "latency.json");
  const recordFile = path.join(dir, "record.jsonl");
  if (rule) fs.writeFileSync(ruleFile, JSON.stringify({ ms: rule.ms, record: recordFile }));
  const script = `
    const fs = require("node:fs");
    let reached = 0;
    let at = 0;
    globalThis.fetch = async () => { reached += 1; at = Date.now(); return new Response("{}"); };
    require(${JSON.stringify(SERVER_LATENCY)});
    (async () => {
      const out = [];
      for (const item of ${JSON.stringify(urls)}) {
        const url = typeof item === "string" ? item : item.url;
        if (typeof item !== "string" && item.removeRuleBefore) fs.rmSync(${JSON.stringify(ruleFile)}, { force: true });
        const before = reached;
        const t = Date.now();
        await fetch(url, ${JSON.stringify(extra?.init ?? {})});
        out.push({ waited: at - t, innerCalls: reached - before });
      }
      process.stdout.write(JSON.stringify(out));
    })();
  `;
  const res = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: 30_000,
    env: { PATH: process.env.PATH ?? "", E2E_LATENCY_RULE_FILE: ruleFile } as unknown as NodeJS.ProcessEnv,
  });
  expect(res.stderr).toBe("");
  expect(res.status).toBe(0);
  return JSON.parse(res.stdout) as Probe[];
}

const records = (): Array<{ t0: number; t1: number; method: string; path: string }> => {
  const file = path.join(dir, "record.jsonl");
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
};

describe("server-latency preload", () => {
  it("waits the rule file's delay before a call to the local Supabase origin reaches fetch, and records its interval without ids or query", () => {
    const [probe] = run({ ms: 350 }, ["http://127.0.0.1:54321/rest/v1/visits?id=eq.3f2b9c1e-1111-4222-8333-444455556666&select=*"]);
    expect(probe.innerCalls).toBe(1);
    expect(probe.waited).toBeGreaterThanOrEqual(345);
    expect(probe.waited).toBeLessThan(345 + 400);
    const [rec] = records();
    expect(records()).toHaveLength(1);
    expect(rec).toMatchObject({ method: "GET", path: "/rest/v1/visits", ms: 350 });
    expect(rec.t1 - rec.t0).toBeGreaterThanOrEqual(345);
    expect(JSON.stringify(rec)).not.toMatch(/3f2b9c1e|select/);
  });

  it("collapses ids in the path and keeps the method", () => {
    run({ ms: 10 }, ["http://localhost:54321/rest/v1/rpc/get_thing/3f2b9c1e-1111-4222-8333-444455556666"], { init: { method: "POST", body: "{}" } });
    expect(records().map((r) => `${r.method} ${r.path}`)).toEqual(["POST /rest/v1/rpc/get_thing/:id"]);
  });

  it("leaves every other origin and every other loopback port untouched and unrecorded", () => {
    const probes = run({ ms: 400 }, ["http://127.0.0.1:3101/range/ABCDE", "http://localhost:9999/x", "https://example.com/y", "http://127.0.0.1:54324/api/v1/messages"]);
    for (const probe of probes) {
      expect(probe.innerCalls).toBe(1);
      expect(probe.waited).toBeLessThan(150);
    }
    expect(records()).toEqual([]);
  });

  it("does nothing without a rule file, and stops when the file is removed, with no restart", () => {
    const none = run(null, ["http://127.0.0.1:54321/rest/v1/visits"]);
    expect(none[0].waited).toBeLessThan(150);
    expect(records()).toEqual([]);
    const probes = run({ ms: 250 }, ["http://127.0.0.1:54321/rest/v1/a", { url: "http://127.0.0.1:54321/rest/v1/b", removeRuleBefore: true }]);
    expect(probes[0].waited).toBeGreaterThanOrEqual(245);
    expect(probes[1].waited, "the second call came after the rule file was removed").toBeLessThan(150);
    expect(records().map((r) => r.path)).toEqual(["/rest/v1/a"]);
  });

  it("ignores a rule file it cannot read as a rule", () => {
    const ruleFile = path.join(dir, "latency.json");
    fs.writeFileSync(ruleFile, "{ not json");
    const script = `
      let reached = 0;
      globalThis.fetch = async () => { reached += 1; return new Response("{}"); };
      require(${JSON.stringify(SERVER_LATENCY)});
      (async () => { const t = Date.now(); await fetch("http://127.0.0.1:54321/rest/v1/a"); process.stdout.write(JSON.stringify({ reached, ms: Date.now() - t })); })();
    `;
    const res = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH ?? "", E2E_LATENCY_RULE_FILE: ruleFile } as unknown as NodeJS.ProcessEnv });
    const out = JSON.parse(res.stdout) as { reached: number; ms: number };
    expect(out.reached).toBe(1);
    expect(out.ms).toBeLessThan(150);
  });
});

describe("server-latency preload: aborted calls", () => {
  it("does not record a call that was aborted during its wait (it never reached the local stack)", () => {
    const ruleFile = path.join(dir, "latency.json");
    const recordFile = path.join(dir, "record.jsonl");
    fs.writeFileSync(ruleFile, JSON.stringify({ ms: 400, record: recordFile }));
    const script = `
      let reached = 0;
      globalThis.fetch = async () => { reached += 1; return new Response("{}"); };
      require(${JSON.stringify(SERVER_LATENCY)});
      (async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 50);
        const outcome = await fetch("http://127.0.0.1:54321/rest/v1/visits", { signal: controller.signal }).then(() => "answered", () => "aborted");
        process.stdout.write(JSON.stringify({ outcome, reached }));
      })();
    `;
    const res = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH ?? "", E2E_LATENCY_RULE_FILE: ruleFile } as unknown as NodeJS.ProcessEnv });
    expect(JSON.parse(res.stdout)).toEqual({ outcome: "aborted", reached: 0 });
    expect(records()).toEqual([]);
  });
});

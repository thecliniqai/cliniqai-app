#!/usr/bin/env node
/**
 * ZAP baseline against the LOCAL e2e server only (V2-14 14-02, SVP §7; plan D-1, CTO-1). CI `zap` job.
 *
 * 1. Starts the guarded e2e server (`tests/e2e/support/serve.ts`: `next start` of the `npm run e2e:build` output on
 *    127.0.0.1:3100, loopback stack, allowlisted env) and waits for `/api/health`.
 * 2. Runs the digest-pinned ZAP image's `zap-baseline.py` (passive scan + a short spider) with host networking against
 *    http://127.0.0.1:3100 only. `-silent`: ZAP makes no unsolicited calls (no update or news checks). The webhook, job
 *    runner and `/api/v1` paths are kept out of the spider (zap/baseline.conf rules, `-config` excludes below).
 * 3. Writes zap-out/zap-report.{json,html,md}; scripts/security/zap-gate.mjs decides (High blocks).
 *
 * Refuses any target that is not the loopback e2e server: this script never scans staging, hosted Supabase, Razorpay,
 * MSG91 or an AI provider (CLAUDE.md; CTO-1 keeps a staging scan a PO action, 14-P4).
 *
 * Usage: node scripts/security/zap-local.mjs [--out zap-out] [--minutes 2]
 * Exit: ZAP's own status is ignored (the gate decides); 2 = the server or ZAP could not run.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TARGET = "http://127.0.0.1:3100";
// zaproxy/zap-stable 2.17.0 (2026-11-03), pinned by digest. Bump: a release at least two weeks old, digest from
// `docker buildx imagetools inspect zaproxy/zap-stable:<tag>`, in one reviewed PR.
export const ZAP_IMAGE = "zaproxy/zap-stable:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af";
/** Kept out of the spider: provider webhooks, the job runner, the API (off by default), sign-out. */
const EXCLUDES = [`${TARGET}/api/webhooks/.*`, `${TARGET}/api/jobs/.*`, `${TARGET}/api/v1.*`, `${TARGET}/auth/signout.*`];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function fail(message) {
  console.error(`zap-local: ${message}`);
  process.exit(2);
}

async function waitForHealth(deadlineMs) {
  while (Date.now() < deadlineMs) {
    try {
      const res = await fetch(`${TARGET}/api/health`); // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- the loopback e2e server (plain http by design)
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const out = path.resolve(ROOT, arg("--out", "zap-out"));
  const minutes = String(Number(arg("--minutes", "2")) || 2);
  if (new URL(TARGET).hostname !== "127.0.0.1") fail("the target must be the loopback e2e server");
  fs.mkdirSync(out, { recursive: true });
  // The ZAP image runs as its own user: it must be able to write the reports.
  fs.chmodSync(out, 0o777);

  const server = spawn(process.execPath, ["--import", "tsx", "tests/e2e/support/serve.ts"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  let serverExited = false;
  server.on("exit", () => {
    serverExited = true;
  });
  const stopServer = () => {
    if (serverExited) return;
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };
  process.on("exit", stopServer);

  if (!(await waitForHealth(Date.now() + 120_000)) || serverExited) {
    stopServer();
    fail("the e2e server did not answer /api/health within 120 s");
  }

  // ZAP's global exclude list: never requested by the spider or the passive scan's own requests.
  const zapOptions = [
    "-silent",
    ...EXCLUDES.flatMap((regex, i) => [
      "-config",
      `globalexcludeurl.url_list.url(${i}).regex=${regex}`,
      "-config",
      `globalexcludeurl.url_list.url(${i}).enabled=true`,
    ]),
  ].join(" ");
  const args = [
    "run",
    "--rm",
    "--network",
    "host",
    "-v",
    `${out}:/zap/wrk:rw`,
    "-v",
    `${path.join(ROOT, "zap")}:/zap/cfg:ro`,
    ZAP_IMAGE,
    "zap-baseline.py",
    "-t",
    `${TARGET}/`,
    "-c",
    "/zap/cfg/baseline.conf",
    "-m",
    minutes,
    "-J",
    "zap-report.json",
    "-r",
    "zap-report.html",
    "-w",
    "zap-report.md",
    "-I",
    "-z",
    zapOptions,
  ];
  console.log(`zap-local: docker ${args.slice(0, 9).join(" ")} zap-baseline.py -t ${TARGET}/ -m ${minutes}`);
  const zap = spawnSync("docker", args, { cwd: ROOT, stdio: "inherit" });
  stopServer();
  if (zap.error) fail(`docker could not run: ${zap.error.message}`);
  if (!fs.existsSync(path.join(out, "zap-report.json"))) fail(`ZAP wrote no report (exit ${zap.status})`);
  console.log(`zap-local: ZAP exit ${zap.status}; report in ${path.relative(ROOT, out)}/ (zap-gate.mjs decides)`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

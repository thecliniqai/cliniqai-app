/**
 * V2-03 03-09b (roadmap acceptance "a thrown server error appears in the India-resident error sink with PII scrubbed";
 * R-18): on the built app, `POST /api/diag/error` with the e2e cron bearer throws a synthetic error carrying a phone,
 * an email, a Postgres `Key (…)=(…)` detail and a share-style query string. `instrumentation.ts` `onRequestError`
 * writes it to the local Postgres sink: exactly one `ops.error_events` row carries the response's `x-request-id`, with
 * the route pattern and none of the synthetic values. `scripts/ops/export-error-events.mjs` exports that row and its
 * check passes (the same check the PO's staging export goes through, E9).
 *
 * Desktop Chromium only: the sink is server-side and device-independent, and the row is per fingerprint and day, so a
 * second device running the same request in parallel would move the row's latest request id under this test.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../fixtures";
import { E2E_CRON_SECRET, ROOT } from "../support/app-env";
import { psql } from "../../helpers/sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mirrors lib/observability/diag-error.ts `DIAG_SYNTHETIC` (the values the scrubber must remove). */
const SYNTHETIC = ["+919000000000", "9000000000", "090000 00000", "diag.synthetic@example.com", "diagSyntheticToken0123456789", "?token="];

test.use({ storageState: { cookies: [], origins: [] } });

const ONE_DEVICE = "desktop-chrome";
const ONE_DEVICE_REASON = "server-side sink, proven once (see the file comment)";

test("a thrown server error lands in ops.error_events once, scrubbed, under the response's request id", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== ONE_DEVICE, ONE_DEVICE_REASON);
  const res = await request.post("/api/diag/error", { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
  expect(res.status()).toBe(500);
  const body = await res.text();
  for (const value of SYNTHETIC) expect(body).not.toContain(value);
  const requestId = res.headers()["x-request-id"];
  expect(requestId).toMatch(UUID);

  // onRequestError is awaited by Next before the response completes; poll briefly in case of scheduling.
  await expect
    .poll(() => psql(`select count(*) from ops.error_events where request_id = '${requestId}'`)[0], { timeout: 10_000 })
    .toBe("1");

  const out = testInfo.outputPath("error-events-export.json");
  const stdout = execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts/ops/export-error-events.mjs"), "--request-id", requestId, "--out", out],
    { cwd: ROOT, encoding: "utf8" },
  );
  expect(stdout).toContain("wrote 1 row(s)");
  expect(stdout).toContain("check OK");

  const [row] = JSON.parse(fs.readFileSync(out, "utf8")) as Array<Record<string, unknown>>;
  expect(row).toMatchObject({
    request_id: requestId,
    route_path: "/api/diag/error",
    route_type: "route",
    method: "POST",
    error_name: "DiagnosticError",
    error_code: "DIAG_SYNTHETIC",
    environment: "e2e",
  });
  expect(row.message).toContain("Key (phone)=([REDACTED])");
  expect(row.message).toContain("[EMAIL]");
  const everything = JSON.stringify(row);
  for (const value of SYNTHETIC) expect(everything).not.toContain(value);
  expect(everything).not.toMatch(/\/(Users|home|runner)\//);
});

test("the diagnostic route refuses a missing or wrong bearer (401) and other methods (405)", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== ONE_DEVICE, ONE_DEVICE_REASON);
  expect((await request.post("/api/diag/error")).status()).toBe(401);
  expect((await request.post("/api/diag/error", { headers: { authorization: `Bearer ${E2E_CRON_SECRET}x` } })).status()).toBe(401);
  expect((await request.get("/api/diag/error")).status()).toBe(405);
});

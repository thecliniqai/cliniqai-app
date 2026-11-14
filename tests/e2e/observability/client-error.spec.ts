/**
 * V2-06 06-04a step 1 (tracer; R-3, V2-03 R-29; T-06-09): an uncaught client render error reaches the error sink.
 *
 * Signed in as the owner on the built app, the diagnostic page's button makes a child throw `DiagClientRenderError`
 * while rendering. The dashboard's error boundary shows the error state without the error's message (which carries
 * synthetic identifier-shaped values) and reports the error once: exactly one `ops.error_events` row with
 * `error_name = client.DiagClientRenderError`, the route pattern, `route_type = render`, an empty message and no
 * frames, and none of the synthetic values anywhere in the row. "Try again" recovers; a second throw is the same row
 * counted twice (one report per boundary render). Before 06-04a: no row (production `reportClientError` is a no-op).
 *
 * Desktop Chromium only: the sink is server-side and device-independent, and the row is per fingerprint and day, so a
 * second device running in parallel would change the count under this test.
 */
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";
import { psql } from "../../helpers/sql";

/** Mirrors app/(dashboard)/diag/client-error/trigger.tsx `DIAG_CLIENT_MESSAGE` (values that must never appear). */
const SYNTHETIC = ["+919000000000", "9000000000", "diag.client@example.com", "Diagnostic client render error"];
const NAME = "client.DiagClientRenderError";

test.use({ storageState: storageStatePath("owner") });

const ONE_DEVICE = "desktop-chrome";

function rowsJson(): Array<Record<string, unknown>> {
  const [json] = psql(`select coalesce(json_agg(e), '[]'::json) from (
    select error_name, route_path, route_type, method, digest, error_code, message, frames, request_id, count, environment
      from ops.error_events where error_name = '${NAME}') e`);
  return JSON.parse(json) as Array<Record<string, unknown>>;
}

test("a client render error shows the boundary without its message and lands in ops.error_events once", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== ONE_DEVICE, "server-side sink, proven once (see the file comment)");
  psql(`delete from ops.error_events where error_name = '${NAME}'`);

  await page.goto("/diag/client-error");
  await expect(page.getByRole("heading", { name: "Client error diagnostic" })).toBeVisible();
  await page.getByRole("button", { name: "Throw a render error" }).click();

  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/");
  const text = await page.locator("body").innerText();
  for (const value of SYNTHETIC) expect(text).not.toContain(value);

  await expect.poll(() => rowsJson().length, { timeout: 10_000 }).toBe(1);
  const [row] = rowsJson();
  expect(row).toEqual({
    error_name: NAME,
    route_path: "/diag/client-error",
    route_type: "render",
    method: null,
    digest: null,
    error_code: null,
    message: "",
    frames: [],
    request_id: null,
    count: 1,
    environment: "e2e",
  });
  for (const value of SYNTHETIC) expect(JSON.stringify(row)).not.toContain(value);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Throw a render error" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);

  await page.getByRole("button", { name: "Throw a render error" }).click();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect.poll(() => rowsJson().map((r) => r.count), { timeout: 10_000 }).toEqual([2]);
});

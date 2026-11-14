/**
 * V2-06 06-04a step 1 (tracer; R-3, V2-03 R-29; T-06-09): an uncaught client render error reaches the error sink.
 *
 * Signed in as the owner on the built app, the diagnostic page's button makes a child throw `DiagClientRenderError`
 * while rendering. The dashboard's error boundary shows the error state without the error's message (which carries
 * synthetic identifier-shaped values) and reports the error once: exactly one `ops.error_events` row with
 * `error_name = client.DiagClientRenderError`, the route pattern, `route_type = render`, an empty message and no
 * frames, and none of the synthetic values anywhere in the row. "Try again" recovers; a second throw is reported again
 * (one report per boundary render), and since 06-09a (C L-1) the server drops that repeat of the same key within a
 * minute: the row still counts 1 and no second log line is written. Before 06-04a: no row (production
 * `reportClientError` is a no-op).
 *
 * Desktop Chromium only: the sink is server-side and device-independent, and the row is per fingerprint and day, so a
 * second device running in parallel would change the count under this test.
 */
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";
import { psql } from "../../helpers/sql";
import { readLogFrom, SERVER_STDERR_LOG } from "../support/server-log";
import { CLIENT_REPEAT_WINDOW_MS } from "@/lib/observability/client-render-event";

/**
 * 06-09a (C L-1): the server drops a repeat of the same key within a minute, per server instance. Other specs (the
 * route-state specs) throw the same diagnostic error on this one e2e server, so this test first waits until a minute
 * has passed since the server last let this key through (its `client.render_error` log line), else its own report would
 * be a dropped repeat and no row would appear.
 */
async function waitOutRepeatWindow(): Promise<void> {
  const last = readLogFrom(SERVER_STDERR_LOG, 0)
    .split("\n")
    .filter((line) => line.includes('"event":"client.render_error"') && line.includes(`"code":"${NAME}"`))
    .map((line) => Date.parse((JSON.parse(line) as { ts: string }).ts))
    .at(-1);
  if (last === undefined) return;
  const wait = last + CLIENT_REPEAT_WINDOW_MS + 1_000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

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
  test.slow();
  await waitOutRepeatWindow();
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

  const repeat = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/diag/client-error" && Boolean(r.request().headers()["next-action"]),
  );
  await page.getByRole("button", { name: "Throw a render error" }).click();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  expect((await repeat).status()).toBe(200);
  // 06-09a C L-1: the same key again within a minute is dropped on the server (no write, no log line).
  expect(rowsJson().map((r) => r.count)).toEqual([1]);
});

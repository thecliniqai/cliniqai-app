/**
 * TEST_STRATEGY §5 "unauthenticated access to every (dashboard) route is rejected" (V2-02 plan 02-03a), extended by
 * V2-03 03-12b (OA-5, R-28: proxy default deny).
 *
 * The routes are enumerated from the filesystem (every `app/(dashboard)/** /page.tsx`; route groups dropped, dynamic
 * segments filled with a random UUID), so a new dashboard page is covered without editing this spec. Without a
 * session, each one must end on `/login`, and neither the raw (unfollowed) response nor the final page may contain
 * any of the run's tenant data (tenant/patient names, staff emails).
 *
 * OA-5 proof (03-12b): the raw response is the PROXY's 307 to `/login?next=<path>` (before: the layout rendered and
 * redirected to a bare `/login`), so no page code runs; and the error sink (`ops.error_events`, 03-09b) holds no row
 * for any request id of the sweep (before: page data loaders threw "Unauthenticated" into it on every signed-out
 * visit), nor any "Unauthenticated" row touched since the sweep began (workers = 1, so nothing else runs meanwhile).
 *
 * Public paths stay reachable without a session: the (auth) pages, share-token and reschedule links, `/auth/signout`,
 * and every `/api` handler category (probes, Send Email hook, webhooks, cron, `/api/v1`, share-token APIs) answers
 * itself instead of being redirected to the login page.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { APIResponse } from "@playwright/test";
import { expect, test } from "../fixtures";
import { E2E_BASE_URL } from "../support/app-env";
import { readRunData, tenantDataMarkers } from "../support/run-data";
import { dashboardRoutes } from "../support/routes";
import { psql } from "../../helpers/sql";

test.use({ storageState: { cookies: [], origins: [] } });

const ROUTES = dashboardRoutes(() => randomUUID());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Request ids of every signed-out dashboard response in this file (raw and followed). */
const sweepIds: string[] = [];
let sweepStart = "";

function sinkRowsFor(ids: string[]): number {
  const valid = ids.filter((id) => UUID.test(id));
  if (valid.length === 0) return 0;
  return Number(psql(`select count(*) from ops.error_events where request_id in (${valid.map((id) => `'${id}'`).join(",")})`)[0]);
}

test.beforeAll(() => {
  sweepStart = psql("select now()")[0];
});

test("the dashboard route enumeration found the dashboard pages", () => {
  // Guards the enumeration itself: an empty or broken walk would make every per-route test vanish.
  expect(ROUTES.map((r) => r.pattern)).toEqual(expect.arrayContaining(["/", "/patients", "/patients/[id]", "/staff"]));
});

for (const route of ROUTES) {
  test(`signed out, ${route.pattern} is redirected by the proxy to /login?next=… with no tenant data`, async ({ page, request }) => {
    const markers = tenantDataMarkers(readRunData());
    const ids: string[] = [];

    const raw = await request.get(route.url, { maxRedirects: 0 });
    const rawId = raw.headers()["x-request-id"] ?? "";
    ids.push(rawId);
    const rawBody = await raw.text();
    for (const marker of markers) expect(rawBody, `raw response of ${route.pattern}`).not.toContain(marker);
    // Soft: a wrong redirect shape is reported, and the sink check below still runs (both are the OA-5 proof).
    expect.soft(raw.status(), `raw status of ${route.pattern}`).toBe(307);
    const location = new URL(raw.headers()["location"] ?? "", E2E_BASE_URL);
    expect.soft(location.pathname, "redirect target").toBe("/login");
    expect.soft(location.searchParams.get("next"), "the proxy's next parameter").toBe(route.url);
    expect.soft(rawId).toMatch(UUID);

    page.on("response", (res) => {
      if (res.request().resourceType() === "document") ids.push(res.headers()["x-request-id"] ?? "");
    });
    await page.goto(route.url);
    sweepIds.push(...ids);
    await expect(page).toHaveURL((url) => url.pathname === "/login");
    expect.soft(new URL(page.url()).searchParams.get("next"), "next survives to the login page").toBe(route.url);
    const html = await page.content();
    for (const marker of markers) expect(html, `final page of ${route.pattern}`).not.toContain(marker);

    // onRequestError is awaited before a response completes (03-09b), so a page error would already be in the sink.
    expect(sinkRowsFor(ids), `error-sink rows for the requests of ${route.pattern}`).toBe(0);
  });
}

test("OA-5: the signed-out sweep left no error in the sink (no 'Unauthenticated' render errors)", () => {
  expect(sweepIds.length).toBeGreaterThanOrEqual(ROUTES.length * 2);
  expect(sinkRowsFor(sweepIds)).toBe(0);
  const touched = psql(
    `select count(*) from ops.error_events where message ilike '%unauthenticated%' and last_seen >= '${sweepStart}'::timestamptz`,
  )[0];
  expect(Number(touched), "Unauthenticated rows written or bumped since the sweep began").toBe(0);
});

test("03-13a (review D L-4): a page path ending in an image extension still runs the proxy (default deny + request id)", async ({
  request,
}) => {
  const markers = tenantDataMarkers(readRunData());
  for (const path of [
    `/patients/${randomUUID()}.png`,
    `/patients/${randomUUID()}.svg`,
    "/patients/x.webp",
    `/consultation/${randomUUID()}.jpg`,
    "/settings/logo.jpeg",
  ]) {
    const raw = await request.get(path, { maxRedirects: 0 });
    expect(raw.status(), path).toBe(307);
    const location = new URL(raw.headers()["location"] ?? "", E2E_BASE_URL);
    expect(location.pathname, path).toBe("/login");
    expect(location.searchParams.get("next"), path).toBe(path);
    expect(raw.headers()["x-request-id"], `${path} carries a request id`).toMatch(UUID);
    const body = await raw.text();
    for (const marker of markers) expect(body, path).not.toContain(marker);
  }
});

test("public paths stay reachable without a session (never redirected to /login)", async ({ request }) => {
  const token = randomBytes(32).toString("hex");
  const notToLogin = (res: APIResponse, what: string) => {
    const location = res.headers()["location"];
    expect(location === undefined || new URL(location, E2E_BASE_URL).pathname !== "/login", `${what} → ${location}`).toBe(true);
    expect(res.headers()["x-request-id"], `${what} carries a request id`).toMatch(UUID);
  };
  const get = async (url: string, expected: number[]) => {
    const res = await request.get(url, { maxRedirects: 0 });
    expect(expected, `GET ${url} → ${res.status()}`).toContain(res.status());
    notToLogin(res, `GET ${url}`);
  };
  const post = async (url: string, expected: number[], headers: Record<string, string> = {}) => {
    const res = await request.post(url, { maxRedirects: 0, headers, data: {} });
    expect(expected, `POST ${url} → ${res.status()}`).toContain(res.status());
    notToLogin(res, `POST ${url}`);
  };

  // Pages.
  await get("/login", [200]);
  await get("/forgot-password", [200]);
  await get("/join", [200]);
  await get(`/r/${token}`, [200, 404]);
  await get(`/reports/view?token=${token}`, [200, 404]);
  await get(`/reschedule/${token}`, [200, 404]);
  // Route handlers.
  const signout = await request.post("/auth/signout", { maxRedirects: 0, headers: { origin: E2E_BASE_URL } });
  expect(signout.status()).toBe(303);
  expect(signout.headers()["location"]).toBe("/login");
  await get("/api/health", [200]);
  await get("/api/ready", [200, 503]);
  await post("/api/auth/send-email", [401]);
  await post("/api/webhooks/messaging/msg91", [401]);
  await get("/api/cron/webhooks", [401]);
  await post("/api/cron/dispatch-communications", [401]);
  await get("/api/v1/patients", [401, 404]);
  await get("/api/v1/openapi.json", [200, 404]);
  await get(`/api/r/${token}`, [404]);
  await get(`/api/reports/view?token=${token}`, [404]);
  await get(`/api/reschedule/${token}`, [404]);
  // Session routes under /api answer 401 themselves (the handler authenticates), not a redirect.
  await get(`/api/patients/${randomUUID()}/export`, [401, 404]);
});

/**
 * Helpers for the password journeys J-A4 / J-A5 (V2-03 03-12a): a fresh synthetic member per test (so changing its
 * password never disturbs the shared seeded roles), sign-in through the login UI, and the newest reset code from the
 * local Mailpit. Passwords and codes are never printed.
 */
import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, routeLoopbackOnly } from "../fixtures";
import { E2E_BASE_URL } from "./app-env";
import { addMemberToTenant, seededUserPassword } from "../../helpers/tenants";
import { LOCAL_MAILPIT_API_URL } from "../../setup/test-env";
import { readRunData } from "./run-data";
import { logOffset, readLogFrom, SERVER_STDERR_LOG, SERVER_STDOUT_LOG } from "./server-log";
import { psql } from "../../helpers/sql";

export { BREACHED_FIXTURE_PASSWORDS } from "./pwned-range-server";

export interface JourneyUser {
  email: string;
  password: string;
}

/** A new nurse in tenant A (removed by the run teardown with every user created during the run). */
export async function freshMember(): Promise<JourneyUser> {
  const member = await addMemberToTenant(readRunData().tenantA.id, "nurse");
  return { email: member.userEmail, password: seededUserPassword() };
}

export function clearPassword(): string {
  return `E2e-${randomBytes(12).toString("base64url")}-9`;
}

/** Signs in through the login UI and waits for the nurse landing page. */
export async function uiSignIn(page: Page, user: JourneyUser): Promise<void> {
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(submit).toBeEnabled();
  await page.getByLabel(/^Email/).fill(user.email);
  await page.getByLabel(/^Password/).fill(user.password);
  await submit.click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
}

/** A fresh browser context with the fixture's loopback-only network block; blocked hosts land in `blocked`. */
export async function guardedContext(browser: Browser): Promise<{ context: BrowserContext; page: Page; blocked: string[] }> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL, serviceWorkers: "block" });
  const blocked: string[] = [];
  // Same block as the fixture, incl. the local Turnstile stub (03-12c): the login page renders the widget.
  await routeLoopbackOnly(context, blocked);
  return { context, page: await context.newPage(), blocked };
}

/** A second, independent browser context signed in as `user` (another device). */
export async function otherDevice(
  browser: Browser,
  user: JourneyUser,
): Promise<{ context: BrowserContext; page: Page; blocked: string[] }> {
  const device = await guardedContext(browser);
  await uiSignIn(device.page, user);
  return device;
}

/** Tries `user` on the login UI of a fresh context and expects the fixed wrong-password error. */
export async function expectSignInRefused(browser: Browser, user: JourneyUser): Promise<void> {
  const { context, page, blocked } = await guardedContext(browser);
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(submit).toBeEnabled();
  await page.getByLabel(/^Email/).fill(user.email);
  await page.getByLabel(/^Password/).fill(user.password);
  await submit.click();
  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  expect(blocked).toEqual([]);
  await context.close();
}

/** True once `page`'s session is gone: a dashboard page sends it to /login. */
/** Error-sink events of the e2e server for the "Unauthenticated" page error (rows are per fingerprint and day). */
function unauthenticatedSinkEvents(): number {
  const [n] = psql("select coalesce(sum(count), 0) from ops.error_events where environment = 'e2e' and message = 'Unauthenticated'");
  return Number(n);
}

/**
 * Opens a dashboard page and expects the sign-in page. V2-05 05-11c: with a session revoked elsewhere (its access token
 * still valid), the page used to throw "Unauthenticated" while the layout redirected, so each such load wrote a
 * `request.error` line and an error-sink event (root cause in the 05-02a record). The redirect must now be the only
 * outcome: no `request.error` line for the page's requests and no new "Unauthenticated" sink event.
 */
export async function expectSignedOut(page: Page): Promise<void> {
  const outOffset = logOffset(SERVER_STDOUT_LOG);
  const errOffset = logOffset(SERVER_STDERR_LOG);
  const sinkBefore = unauthenticatedSinkEvents();
  const requestIds: string[] = [];
  const onResponse = (res: { url(): string; headers(): Record<string, string> }) => {
    if (new URL(res.url()).pathname !== "/patients") return;
    const id = res.headers()["x-request-id"];
    if (id) requestIds.push(id);
  };
  page.on("response", onResponse);
  try {
    await page.goto("/patients");
    await expect(page).toHaveURL((url) => url.pathname === "/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  } finally {
    page.off("response", onResponse);
  }
  expect(requestIds.length, "the /patients request carried a request id").toBeGreaterThan(0);
  const printed = readLogFrom(SERVER_STDOUT_LOG, outOffset) + readLogFrom(SERVER_STDERR_LOG, errOffset);
  for (const id of requestIds) {
    const errorLines = printed.split("\n").filter((line) => line.includes('"event":"request.error"') && line.includes(id));
    expect(errorLines, `request.error for the signed-out /patients load ${id}`).toEqual([]);
  }
  expect(unauthenticatedSinkEvents(), "no 'Unauthenticated' error-sink event").toBe(sinkBefore);
}

async function messagesTo(address: string): Promise<Array<{ ID: string }>> {
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  expect(res.ok).toBe(true);
  return ((await res.json()) as { messages?: Array<{ ID: string }> }).messages ?? [];
}

export async function mailCount(address: string): Promise<number> {
  return (await messagesTo(address)).length;
}

/** Waits for a message beyond `previous` and returns its 8-digit code (R-36). */
export async function newestCode(address: string, previous: number): Promise<string> {
  await expect.poll(() => mailCount(address), { timeout: 15_000 }).toBeGreaterThan(previous);
  const [newest] = await messagesTo(address);
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/message/${newest.ID}`);
  const text = ((await res.json()) as { Text?: string }).Text ?? "";
  const code = /\b(\d{8})\b/.exec(text)?.[1];
  expect(code !== undefined, "the reset email carries an 8-digit code").toBe(true);
  return code as string;
}

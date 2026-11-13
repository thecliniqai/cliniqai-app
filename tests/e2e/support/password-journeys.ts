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
export async function expectSignedOut(page: Page): Promise<void> {
  await page.goto("/patients");
  await expect(page).toHaveURL((url) => url.pathname === "/login");
}

async function messagesTo(address: string): Promise<Array<{ ID: string }>> {
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  expect(res.ok).toBe(true);
  return ((await res.json()) as { messages?: Array<{ ID: string }> }).messages ?? [];
}

export async function mailCount(address: string): Promise<number> {
  return (await messagesTo(address)).length;
}

/** Waits for a message beyond `previous` and returns its 6-digit code. */
export async function newestCode(address: string, previous: number): Promise<string> {
  await expect.poll(() => mailCount(address), { timeout: 15_000 }).toBeGreaterThan(previous);
  const [newest] = await messagesTo(address);
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/message/${newest.ID}`);
  const text = ((await res.json()) as { Text?: string }).Text ?? "";
  const code = /\b(\d{6})\b/.exec(text)?.[1];
  expect(code !== undefined, "the reset email carries a 6-digit code").toBe(true);
  return code as string;
}

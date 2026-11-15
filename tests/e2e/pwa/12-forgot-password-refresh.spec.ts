/**
 * V2-06 06-09d close, re-check L-N3 (reviews/v206d-review-recheck.md): the browser Supabase client of
 * `/forgot-password` never refreshes a stored session, so a signed-in user who opens the page while Supabase Auth
 * rate-limits the token refresh keeps the session.
 *
 * Setup: a real signed-in device whose access token has expired; both the SERVER's refresh (the e2e fault hook,
 * `tests/e2e/support/server-auth-faults.cjs`) and the BROWSER's refresh (`page.route`) answer GoTrue's 429. The proxy
 * keeps the cookies on its 429 (06-09d) and serves the public page. Before this fix the page created the browser
 * client on mount; auth-js's start-up `_recoverAndRefresh` refreshed the expired session, got the 429 and deleted the
 * auth cookies through `document.cookie`, so the next app request went to /login and the device was purged.
 * Now the page's client (`createAuthPageClient`, created at the first submit) never sees the device's session cookies:
 * no browser refresh is sent, the cookies are exactly the ones the device had, and requesting a code still works.
 * (`autoRefreshToken: false` alone was not enough: supabase-js reads the session for its INITIAL_SESSION event, which
 * refreshes an expired one; this spec caught that at the submit.) A second test runs the whole reset as a signed-in
 * user: the recovery session the page stores replaces the device's session and the reset completes, signed out.
 *
 * Service workers off (config default). A fresh synthetic user; the fault rule names its refresh token by hash.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { AUTH_DIR, readRunData } from "../support/run-data";
import { clearPassword, expectSignedOut, freshMember, mailCount, newestCode, uiSignIn } from "../support/password-journeys";
import { seedTenantWithOwner, seededUserPassword } from "../../helpers/tenants";

test.use({ storageState: { cookies: [], origins: [] } });

const AUTH_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:\.(\d+))?$/;
const FAULT_DIR = path.join(AUTH_DIR, "auth-faults");
/** `@supabase/ssr`'s cookie chunk size (characters of the encoded value). */
const CHUNK = 3180;
const GOTRUE_429 = {
  status: 429,
  headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" },
  body: JSON.stringify({ code: "over_request_rate_limit", message: "synthetic" }),
};

type Cookie = Awaited<ReturnType<BrowserContext["cookies"]>>[number];

async function authCookies(context: BrowserContext): Promise<Cookie[]> {
  return (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name) && c.value);
}

/** The device's auth cookies as name + value digest (compared, never printed: a failure shows no session material). */
async function authCookieDigests(context: BrowserContext): Promise<string[][]> {
  return (await authCookies(context)).map((c) => [c.name, crypto.createHash("sha256").update(c.value).digest("hex").slice(0, 16)]);
}

async function deviceSession(context: BrowserContext): Promise<{ session: Record<string, unknown>; cookies: Cookie[] }> {
  const cookies = (await authCookies(context)).sort((a, b) => Number(AUTH_COOKIE.exec(a.name)![1] ?? -1) - Number(AUTH_COOKIE.exec(b.name)![1] ?? -1));
  const value = cookies.map((c) => c.value).join("");
  expect(value.startsWith("base64-"), "the session cookie is @supabase/ssr's base64 format").toBe(true);
  return { session: JSON.parse(Buffer.from(value.slice("base64-".length), "base64url").toString("utf8")), cookies };
}

/** Rewrites the device's session cookie(s) with `expires_at` in the past (the access token counts as expired). */
async function expireAccessToken(context: BrowserContext): Promise<void> {
  const { session, cookies } = await deviceSession(context);
  const now = Math.floor(Date.now() / 1000);
  const value = `base64-${Buffer.from(JSON.stringify({ ...session, expires_at: now - 120, expires_in: -120 }), "utf8").toString("base64url")}`;
  const base = cookies[0];
  const stem = base.name.replace(/\.\d+$/, "");
  const parts = value.length <= CHUNK ? [[stem, value]] : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => [`${stem}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK)]);
  expect(parts.length, "same chunk layout as before").toBe(cookies.length);
  await context.addCookies(
    parts.map(([name, v]) => ({ name, value: v, domain: base.domain, path: base.path, expires: base.expires, httpOnly: base.httpOnly, secure: base.secure, sameSite: base.sameSite })),
  );
}

/** Makes the e2e server answer this device's token refresh with GoTrue's 429 until the returned undo runs. */
function faultServerRefresh(refreshToken: string): () => void {
  fs.mkdirSync(FAULT_DIR, { recursive: true });
  const file = path.join(FAULT_DIR, `${crypto.createHash("sha256").update(refreshToken).digest("hex")}.json`);
  fs.writeFileSync(file, JSON.stringify({ status: 429, body: { code: "over_request_rate_limit", message: "synthetic" }, goTrue: true }));
  return () => fs.rmSync(file, { force: true });
}

test("L-N3: /forgot-password during a refresh rate limit sends no browser refresh and keeps the session; requesting a code works", async ({
  page,
  context,
}) => {
  const owner = await seedTenantWithOwner(`PWA Forgot 429 ${readRunData().runTag} ${Date.now()}`);
  await uiSignIn(page, { email: owner.userEmail, password: seededUserPassword() });

  const { session } = await deviceSession(context);
  const browserRefreshes: string[] = [];
  await page.route(
    (url) => url.pathname.endsWith("/auth/v1/token") && url.searchParams.get("grant_type") === "refresh_token",
    async (route) => {
      browserRefreshes.push(route.request().url());
      await route.fulfill(GOTRUE_429);
    },
  );
  // The code request is answered here (no email): only the client's own behaviour is under test.
  await page.route(
    (url) => url.pathname.endsWith("/auth/v1/recover"),
    (route) => route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "{}" }),
  );
  const undo = faultServerRefresh(String(session.refresh_token));
  try {
    await expireAccessToken(context);
    const before = await authCookieDigests(context);

    await page.goto("/forgot-password");
    const send = page.getByRole("button", { name: "Send code" });
    await expect(send, "hydrated").toBeEnabled();
    await page.waitForLoadState("networkidle");
    expect(await authCookieDigests(context), "the auth cookies are untouched").toEqual(before);
    expect(browserRefreshes, "no browser refresh on mount").toEqual([]);

    // The client is created at the submit and is used: still no refresh, still the same cookies.
    await page.getByLabel(/^Email/).fill(owner.userEmail);
    await send.click();
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(browserRefreshes, "no browser refresh at the submit").toEqual([]);
    expect(await authCookieDigests(context), "the auth cookies are untouched").toEqual(before);
  } finally {
    undo();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }

  // Auth answers again: the app opens on this device (the session was kept, and the proxy refreshes it).
  await page.goto("/patients");
  await expect(page).toHaveURL((url) => url.pathname === "/patients");
  const refreshed = await deviceSession(context);
  expect(refreshed.session.refresh_token === session.refresh_token, "the server refreshed the kept session").toBe(false);
});

test("L-N3: a signed-in user completes a reset on /forgot-password; the recovery session replaces the session, ends signed out", async ({
  page,
  context,
}) => {
  const user = await freshMember();
  await uiSignIn(page, user);
  const signedIn = await authCookieDigests(context);
  expect(signedIn.length, "signed in").toBeGreaterThan(0);

  await page.goto("/forgot-password");
  const send = page.getByRole("button", { name: "Send code" });
  await expect(send).toBeEnabled();
  const before = await mailCount(user.email);
  await page.getByLabel(/^Email/).fill(user.email);
  await send.click();
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  expect(await authCookieDigests(context), "requesting a code leaves the session as it was").toEqual(signedIn);

  const fresh = clearPassword();
  await page.getByLabel(/^8-digit code/).fill(await newestCode(user.email, before));
  await page.getByLabel(/^New password/).fill(fresh);
  await page.getByLabel(/^Confirm new password/).fill(fresh);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible({ timeout: 30_000 });
  expect(await authCookieDigests(context), "no session cookie survives the reset (R-35)").toEqual([]);
  await expectSignedOut(page);
  await uiSignIn(page, { email: user.email, password: fresh });
});

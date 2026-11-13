/**
 * V2-03 03-06 (P2-01, AUTH_REDESIGN §4.2): on the built Next 16 app, `proxy.ts` runs on page requests and refreshes
 * an expired Supabase session with `@supabase/ssr` 0.12.
 *
 * The browser signs in through the login UI (its own session, so the shared storage states are never rotated), then
 * its access token is marked expired in the cookie. Loading a dashboard page must keep the user signed in AND return
 * the refreshed auth cookie on the page response itself: Server Components cannot write cookies, so only the proxy can
 * set it. If Next did not run the proxy (e.g. a framework rename the app missed), the page response would carry no
 * auth cookie and this test fails.
 *
 * Tokens are compared, never printed.
 */
import type { BrowserContext, Cookie } from "@playwright/test";
import { expect, test } from "../fixtures";
import { LANDING, readRunData, runPassword } from "../support/run-data";

test.use({ storageState: { cookies: [], origins: [] } });

/** `@supabase/ssr` splits a cookie value into `.0`, `.1`, … chunks above this many characters. */
const MAX_CHUNK = 3180;
const AUTH_COOKIE = /^(sb-[a-z0-9-]+-auth-token)(?:\.(\d+))?$/;

interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user?: { id?: string };
}

async function readAuthCookie(context: BrowserContext): Promise<{ name: string; template: Cookie; session: StoredSession }> {
  const cookies = (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name) && c.value);
  expect(cookies.length, "a Supabase auth cookie is set").toBeGreaterThan(0);
  const name = AUTH_COOKIE.exec(cookies[0].name)![1];
  const whole = cookies.find((c) => c.name === name);
  const value = whole
    ? whole.value
    : cookies
        .filter((c) => c.name.startsWith(`${name}.`))
        .sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()))
        .map((c) => c.value)
        .join("");
  const raw = decodeURIComponent(value);
  expect(raw.startsWith("base64-"), "the cookie uses @supabase/ssr base64url encoding").toBe(true);
  const session = JSON.parse(Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8")) as StoredSession;
  return { name, template: cookies[0], session };
}

async function writeAuthCookie(context: BrowserContext, name: string, template: Cookie, session: StoredSession) {
  const stale = (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name));
  for (const c of stale) await context.clearCookies({ name: c.name });
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const chunks: Array<[string, string]> =
    value.length <= MAX_CHUNK
      ? [[name, value]]
      : Array.from({ length: Math.ceil(value.length / MAX_CHUNK) }, (_, j) => [
          `${name}.${j}`,
          value.slice(j * MAX_CHUNK, (j + 1) * MAX_CHUNK),
        ]);
  await context.addCookies(
    chunks.map(([n, v]) => ({
      name: n,
      value: v,
      domain: template.domain,
      path: template.path,
      expires: template.expires,
      httpOnly: template.httpOnly,
      secure: template.secure,
      sameSite: template.sameSite,
    })),
  );
}

test("the proxy refreshes an expired session on a page request and returns the new cookie", async ({ page, context }) => {
  const nurse = readRunData().tenantA.users.nurse;

  await page.goto("/login");
  await page.getByLabel(/^Email/).fill(nurse.email);
  await page.getByLabel(/^Password/).fill(runPassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === LANDING.nurse, { timeout: 30_000 });
  await expect(page.getByRole("main")).toBeVisible();

  const before = await readAuthCookie(context);
  const nowSec = Math.floor(Date.now() / 1000);
  await writeAuthCookie(context, before.name, before.template, { ...before.session, expires_at: nowSec - 60, expires_in: -60 });

  const response = await page.goto(LANDING.nurse);
  expect(response, "the page request got a response").not.toBeNull();
  expect(response!.status()).toBe(200);
  await expect(page).toHaveURL((url) => url.pathname === LANDING.nurse);
  await expect(page.getByRole("main")).toBeVisible();

  // The page response itself carries the refreshed auth cookie (only the proxy can write it).
  const setCookies = await response!.headerValues("set-cookie");
  const authSetCookies = setCookies
    .flatMap((h) => h.split("\n"))
    .filter((h) => AUTH_COOKIE.test(h.split("=")[0].trim()) && h.split(";")[0].split("=")[1]);
  expect(authSetCookies.length, "the page response sets the refreshed auth cookie").toBeGreaterThan(0);

  const after = await readAuthCookie(context);
  expect(after.session.user?.id).toBe(nurse.id);
  expect(after.session.access_token === before.session.access_token, "a new access token").toBe(false);
  expect(after.session.refresh_token === before.session.refresh_token, "a rotated refresh token").toBe(false);
  expect(after.session.expires_at ?? 0).toBeGreaterThan(nowSec);
});

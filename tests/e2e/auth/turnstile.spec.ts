/**
 * Turnstile on sign-in and the reset request (V2-03 03-12c; C43, R-22; roadmap acceptance "Turnstile is on sign-in and
 * reset"). The e2e build carries Cloudflare's always-pass test site key; the widget script is answered by the local
 * stub (tests/e2e/support/turnstile-stub.js) and local GoTrue has CAPTCHA off, so these specs prove the wiring: the
 * token reaches GoTrue as `gotrue_meta_security.captcha_token`, a used token is replaced, and without a token (the
 * always-fail key, a script that does not load) the form is refused before any request leaves the browser. Cloudflare
 * itself (siteverify, Managed challenge) is checked on staging: PO action E7 and AUTH-00 re-check item 2.
 */
import type { Page, Request } from "@playwright/test";
import { expect, test, TURNSTILE_SCRIPT_ORIGIN, TURNSTILE_SCRIPT_PATH } from "../fixtures";
import { freshMember } from "../support/password-journeys";
import { E2E_TURNSTILE_SITE_KEY, TURNSTILE_ALWAYS_FAIL_SITE_KEY } from "../../setup/test-env";

test.use({ storageState: { cookies: [], origins: [] } });

const TOKEN_PATH = "/auth/v1/token";
const RECOVER_PATH = "/auth/v1/recover";
const CAPTCHA_REQUIRED = "Complete the security check, then try again.";
const CAPTCHA_FAILED = "The security check failed. Reload the page and try again.";
const CAPTCHA_UNAVAILABLE = "The security check could not load. Check your connection and reload the page.";
const CAPTCHA_EXPIRED = "The security check expired and is refreshing. Try again in a moment.";

interface StubState {
  renders: Array<{ sitekey: string; action: string; appearance?: string; size?: string }>;
  issued: string[];
}

/** GoTrue requests (password grant or recovery) the page sent, in order. */
function gotrueRequests(page: Page, path: string): Request[] {
  const seen: Request[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (req.method() === "POST" && url.pathname === path) seen.push(req);
  });
  return seen;
}

function captchaTokenOf(req: Request): unknown {
  const body = req.postDataJSON() as { gotrue_meta_security?: { captcha_token?: unknown } } | null;
  return body?.gotrue_meta_security?.captcha_token;
}

async function stub(page: Page): Promise<StubState> {
  return page.evaluate(() => {
    const s = (window as unknown as { __turnstileStub: StubState }).__turnstileStub;
    return { renders: [...s.renders], issued: [...s.issued] };
  });
}

/** Waits until the stub issued `count` tokens. */
async function tokensIssued(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __turnstileStub?: StubState }).__turnstileStub?.issued.length ?? 0))
    .toBeGreaterThanOrEqual(count);
}

async function fillSignIn(page: Page, email: string, password: string): Promise<void> {
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
}

test("sign-in renders the widget with the build's site key and sends a fresh token on every attempt", async ({ page }) => {
  const user = await freshMember();
  const grants = gotrueRequests(page, TOKEN_PATH);

  await page.goto("/login");
  await tokensIssued(page, 1);
  const rendered = (await stub(page)).renders;
  expect(rendered).toEqual([expect.objectContaining({ sitekey: E2E_TURNSTILE_SITE_KEY, action: "sign-in", appearance: "always" })]);

  // A wrong password: the grant carries the stub's token, and GoTrue's refusal shows the catalogue copy.
  await fillSignIn(page, user.email, `${user.password}-wrong`);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  expect(grants).toHaveLength(1);
  const first = captchaTokenOf(grants[0]);
  expect(first).toBe((await stub(page)).issued[0]);

  // The widget was reset after the attempt (tokens are single-use): the retry carries a new token.
  await tokensIssued(page, 2);
  await page.getByLabel(/^Password/).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  expect(grants).toHaveLength(2);
  const second = captchaTokenOf(grants[1]);
  expect(typeof second).toBe("string");
  expect(second).not.toBe(first);
});

test("the reset request sends the widget's token to /recover", async ({ page }) => {
  const recovers = gotrueRequests(page, RECOVER_PATH);
  await page.goto("/forgot-password");
  await tokensIssued(page, 1);
  expect((await stub(page)).renders[0]).toEqual(
    expect.objectContaining({ sitekey: E2E_TURNSTILE_SITE_KEY, action: "password-reset", appearance: "always" }),
  );

  // An address without an account: GoTrue answers as for any address and sends nothing.
  await page.getByLabel(/^Email/).fill(`turnstile-nobody-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  expect(recovers).toHaveLength(1);
  const issued = (await stub(page)).issued;
  expect(captchaTokenOf(recovers[0])).toBe(issued[0]);
  // The "Resend code" row has its own widget (interaction-only): it rendered and holds a different token.
  await tokensIssued(page, 2);
  const renders = (await stub(page)).renders;
  expect(renders.at(-1)).toEqual(expect.objectContaining({ action: "password-reset", appearance: "interaction-only" }));
});

test.describe("with Cloudflare's always-fail test key the forms are refused before any request", () => {
  test.beforeEach(async ({ page }) => {
    // The e2e build inlines the always-pass key; the stub runs as Cloudflare runs 2x00000000000000000000AB.
    await page.addInitScript((key) => {
      (window as unknown as { __turnstileStubSiteKey: string }).__turnstileStubSiteKey = key;
    }, TURNSTILE_ALWAYS_FAIL_SITE_KEY);
  });

  test("sign-in", async ({ page }) => {
    const grants = gotrueRequests(page, TOKEN_PATH);
    await page.goto("/login");
    await expect(page.getByRole("status").filter({ hasText: CAPTCHA_FAILED })).toBeVisible();
    await fillSignIn(page, "nobody@example.com", "E2e-not-a-real-password-1");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(CAPTCHA_REQUIRED)).toBeVisible();
    // The typed password is kept so the user can retry once the check passes.
    await expect(page.getByLabel(/^Password/)).not.toHaveValue("");
    await expect(page).toHaveURL((url) => url.pathname === "/login");
    expect(grants).toEqual([]);
    expect((await stub(page)).issued).toEqual([]);
  });

  test("reset request", async ({ page }) => {
    const recovers = gotrueRequests(page, RECOVER_PATH);
    await page.goto("/forgot-password");
    await expect(page.getByRole("status").filter({ hasText: CAPTCHA_FAILED })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send code" })).toBeEnabled();
    await page.getByLabel(/^Email/).fill(`turnstile-blocked-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText(CAPTCHA_REQUIRED)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    expect(recovers).toEqual([]);
  });
});

test("a widget script that does not load leaves sign-in refused with the 'could not load' copy", async ({ page }) => {
  const grants = gotrueRequests(page, TOKEN_PATH);
  // Answer the script with an error (still nothing leaves the machine; page routes win over the fixture's).
  await page.route(`${TURNSTILE_SCRIPT_ORIGIN}${TURNSTILE_SCRIPT_PATH}*`, (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "unavailable" }),
  );
  await page.goto("/login");
  await expect(page.getByRole("status").filter({ hasText: CAPTCHA_UNAVAILABLE })).toBeVisible();
  await fillSignIn(page, "nobody@example.com", "E2e-not-a-real-password-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(CAPTCHA_REQUIRED)).toBeVisible();
  expect(grants).toEqual([]);
});

test("an expired token shows the expiry copy and is replaced before sign-in", async ({ page }) => {
  const user = await freshMember();
  const grants = gotrueRequests(page, TOKEN_PATH);
  await page.goto("/login");
  await tokensIssued(page, 1);
  await page.evaluate(() => {
    const s = (window as unknown as { __turnstileStub: { autoRefresh: boolean; expire: () => void } }).__turnstileStub;
    s.autoRefresh = false;
    s.expire();
  });
  await expect(page.getByRole("status").filter({ hasText: CAPTCHA_EXPIRED })).toBeVisible();

  await page.evaluate(() => (window as unknown as { __turnstileStub: { refresh: () => void } }).__turnstileStub.refresh());
  await tokensIssued(page, 2);
  await expect(page.getByRole("status").filter({ hasText: CAPTCHA_EXPIRED })).toHaveCount(0);
  await fillSignIn(page, user.email, user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  expect(grants).toHaveLength(1);
  // The expired token (…-1) was never sent; the refreshed one (…-2) was.
  expect(captchaTokenOf(grants[0])).toBe("XXXX.DUMMY.TOKEN.XXXX-2");
});

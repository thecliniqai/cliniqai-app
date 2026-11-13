/**
 * J-A3 sign-in (V2-03 03-12c; AUTH-04b safe `next`, threat T-03-04). Runs on desktop-chrome and pixel-7.
 *
 * A wrong password shows the catalogue's generic copy; the right one lands on the role's home; `?next=/patients` (what
 * proxy.ts sets for a signed-out page request) is honoured; unsafe `next` values (protocol-relative, backslash,
 * absolute, encoded slashes, `javascript:`) land on the default page, and the browser never leaves loopback (the
 * fixture's network block fails the test on any other host). The login page carries the Turnstile widget (local stub).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { LANDING, readRunData, runPassword } from "../support/run-data";

test.use({ storageState: { cookies: [], origins: [] } });

const WRONG_COPY = "Email or password is incorrect";

async function signIn(page: Page, path: string, email: string, password: string): Promise<void> {
  await page.goto(path);
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(submit).toBeEnabled();
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await submit.click();
}

test("J-A3: wrong password → generic copy; right password → the role's home", async ({ page, context }) => {
  const doctor = readRunData().tenantA.users.doctor;

  await signIn(page, "/login", doctor.email, `${runPassword()}-wrong`);
  await expect(page.getByText(WRONG_COPY)).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/login");
  expect((await context.cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);

  // The form stays usable (the widget issued a new token after the failed attempt).
  await page.getByLabel(/^Password/).fill(runPassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === LANDING.doctor, { timeout: 30_000 });
});

test("J-A3: ?next=/patients is honoured after sign-in", async ({ page }) => {
  const receptionist = readRunData().tenantA.users.receptionist;
  await signIn(page, `/login?next=${encodeURIComponent("/patients")}`, receptionist.email, runPassword());
  await page.waitForURL((url) => url.pathname === "/patients", { timeout: 30_000 });
});

test("J-A3: signed out, /patients?x=1 → proxy sends to /login?next=… → sign-in returns to /patients?x=1", async ({ page }) => {
  const receptionist = readRunData().tenantA.users.receptionist;
  await page.goto("/patients?x=1");
  // 03-12b: the proxy's 307 carries the path and query in `next`; 03-12c: the login page consumes it via safeNextPath.
  await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === "/patients?x=1");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(submit).toBeEnabled();
  await page.getByLabel(/^Email/).fill(receptionist.email);
  await page.getByLabel(/^Password/).fill(runPassword());
  await submit.click();
  await page.waitForURL((url) => url.pathname === "/patients" && url.search === "?x=1", { timeout: 30_000 });
});

const UNSAFE_NEXT = ["//evil.example", "/\\evil.example", "https://evil.example/patients", "/%2F%2Fevil.example", "javascript:alert(1)"];

test("J-A3: unsafe next values land on the default page", async ({ page, context }) => {
  const receptionist = readRunData().tenantA.users.receptionist;
  for (const next of UNSAFE_NEXT) {
    await context.clearCookies();
    await signIn(page, `/login?next=${encodeURIComponent(next)}`, receptionist.email, runPassword());
    await page.waitForURL((url) => url.pathname === LANDING.receptionist, { timeout: 30_000 });
    const landed = new URL(page.url());
    expect(landed.pathname, `next=${next}`).toBe(LANDING.receptionist);
    expect(landed.host, `next=${next}`).toMatch(/^(127\.0\.0\.1|localhost)(:\d+)?$/);
    await expect(page.getByRole("main")).toBeVisible();
  }
});

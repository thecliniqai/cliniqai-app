/**
 * TEST_STRATEGY journey 1 — password login (V2-02 plan 02-03b, RL-15).
 *
 * The success path is the `setup` project (tests/e2e/auth.setup.ts): every seeded role signs in through the login UI
 * with its email and the per-run password and lands on its role's page; every other spec depends on it. This spec adds
 * the explicit failure case: a wrong password shows the fixed error, keeps the visitor on /login, sets no auth
 * session, and the dashboard stays closed.
 */
import fs from "node:fs";
import { expect, test } from "../fixtures";
import { readRunData, ROLES, storageStatePath } from "../support/run-data";

test.use({ storageState: { cookies: [], origins: [] } });

test("the setup project signed every role in through the login UI", { tag: "@golden" }, async () => {
  for (const role of ROLES) {
    const state = JSON.parse(fs.readFileSync(storageStatePath(role), "utf8")) as { cookies: Array<{ name: string }> };
    expect(state.cookies.some((c) => c.name.startsWith("sb-")), `${role} has a Supabase session cookie`).toBe(true);
  }
});

test("a wrong password is refused: fixed error, still on /login, no session", { tag: "@golden" }, async ({ page, context }) => {
  const owner = readRunData().tenantA.users.owner;
  const wrongPassword = "E2e-wrong-password-not-real-1";
  // Every URL the page navigates to: credentials must never travel in a query string (V2-02 02-06 flake fix).
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });

  await page.goto("/login");
  // A native submit before hydration must never be a GET: the form is POST and its button waits for hydration.
  await expect(page.locator("form").first()).toHaveAttribute("method", "post");
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(signIn).toBeEnabled();
  await page.getByLabel(/^Email/).fill(owner.email);
  await page.getByLabel(/^Password/).fill(wrongPassword);
  await signIn.click();

  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/login");
  for (const url of visited) {
    expect(url, "no credential in any visited URL").not.toContain(encodeURIComponent(wrongPassword));
    expect(url, "no credential in any visited URL").not.toContain("password=");
  }
  expect((await context.cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);

  // The dashboard is still closed to this browser.
  await page.goto("/patients");
  await expect(page).toHaveURL((url) => url.pathname === "/login");
});

test("the forgot-password forms are POST and wait for hydration (no credential can reach a URL)", async ({ page }) => {
  await page.goto("/forgot-password");
  const forms = page.locator("form");
  await expect(forms.first()).toHaveAttribute("method", "post");
  await expect(page.getByRole("button", { name: /send|code|continue|reset/i }).first()).toBeEnabled();
});

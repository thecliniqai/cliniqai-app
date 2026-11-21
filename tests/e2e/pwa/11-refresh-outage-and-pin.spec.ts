/**
 * V2-06 06-09d on the built app, real sessions (re-verification of 06-09c, reviews/v206c-review-reverify.md):
 *
 * - H-AUTHOUT-R1 (High): the device's access token has expired and the SERVER's token refresh is rate-limited (429 for
 *   this device's refresh token only: `tests/e2e/support/server-auth-faults.cjs`). On resume the status poll answers
 *   503 (twice), the page stays as it is (same URL, the typed text kept, nothing concealed), the auth cookies are
 *   exactly the ones the device had, no `POST /auth/signout` runs, and the device's local data is not purged. A full
 *   page load during the incident shows the unavailable state, never /login, and still keeps the cookies. Once the
 *   refresh answers again, a reload opens the page (the session refreshed). Control: a definitive GoTrue answer
 *   (`refresh_token_not_found`) through the same hook does sign out. Before 06-09d auth-js deleted the cookies for the
 *   429, the next poll answered 401 and the device signed out and purged (re-verifier: route 503 → cookies deleted →
 *   401 → `hardSignOut("expired")`; proxy 307 /login with the cookie deleted).
 * - M-REMOVED-R1 (Medium): a receptionist of clinic A only, who never had an active-clinic cookie, is added to clinic B
 *   and then removed from A. The first status poll pinned A (HttpOnly cookie), so the next resume answers 403: the page
 *   signs out and purges, and the next sign-in opens B. Before 06-09d nothing set the cookie and the poll answered B's
 *   200 (no reaction), leaving A's screen open over B's session.
 * - L-R4 (Low): removed from the last clinic, a full page load signs out and purges (no `/clinic/new`).
 *
 * Service workers off (config default). Fresh synthetic users each test, so the shared seeded sessions are never
 * touched; the fault rule names one refresh token by its hash.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { AUTH_DIR, readRunData } from "../support/run-data";
import { uiSignIn } from "../support/password-journeys";
import { logOffset, readLogFrom, SERVER_STDERR_LOG, SERVER_STDOUT_LOG } from "../support/server-log";
import { getAdminClient } from "../../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, seededUserPassword } from "../../helpers/tenants";

test.use({ storageState: { cookies: [], origins: [] } });

const AUTH_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:\.(\d+))?$/;
const ACTIVE_TENANT_COOKIE = "clinic_active_tenant";
const FAULT_DIR = path.join(AUTH_DIR, "auth-faults");
/** `@supabase/ssr`'s cookie chunk size (characters of the encoded value). */
const CHUNK = 3180;

type Cookie = Awaited<ReturnType<BrowserContext["cookies"]>>[number];

async function authCookies(context: BrowserContext): Promise<Cookie[]> {
  return (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name) && c.value);
}

/** The device's session (joined chunks, `base64-` + base64url JSON) and the cookies it is stored in. */
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

/** Makes the server answer this device's token refresh with `status` (+ GoTrue's code) until the returned undo runs. */
function faultRefresh(refreshToken: string, status: number, code: string): () => void {
  fs.mkdirSync(FAULT_DIR, { recursive: true });
  const file = path.join(FAULT_DIR, `${crypto.createHash("sha256").update(refreshToken).digest("hex")}.json`);
  fs.writeFileSync(file, JSON.stringify({ status, body: { code, message: "synthetic" }, goTrue: true }));
  return () => fs.rmSync(file, { force: true });
}

async function resume(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

const lines = (file: string, offset: number, marker: string) =>
  readLogFrom(file, offset)
    .split("\n")
    .filter((line) => line.includes(marker));

async function dirty(page: Page) {
  await page.evaluate(() => {
    sessionStorage.setItem("draftNote", "synthetic");
    localStorage.setItem("recentPatient", "synthetic");
  });
}

const storage = (page: Page) => page.evaluate(() => [sessionStorage.getItem("draftNote"), localStorage.getItem("recentPatient")]);

/** Resumes until the session-status poll has signed the page out (a resume on a running check joins it). */
async function resumeUntilLogin(page: Page): Promise<void> {
  await expect(async () => {
    if (new URL(page.url()).pathname !== "/login") await resume(page).catch(() => undefined);
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("H-AUTHOUT-R1: a rate-limited token refresh is never a sign-out", () => {
  test("@golden 429 on the server's refresh: poll 503 twice, page and typed text kept, cookies untouched, no purge, no /login", async ({
    page,
    context,
  }) => {
    const owner = await seedTenantWithOwner(`PWA Refresh 429 ${readRunData().runTag} ${Date.now()}`);
    await uiSignIn(page, { email: owner.userEmail, password: seededUserPassword() });
    await page.goto("/patients?new=1");
    const name = page.getByLabel(/^Full name/);
    await expect(name).toBeVisible();
    // Typed once the page is idle (WebKit can hydrate after `load`, dropping text typed into the server HTML; 06-09c).
    await page.waitForLoadState("networkidle");
    await expect(async () => {
      await name.fill("Synthetic Unsaved Name");
      await page.waitForTimeout(500);
      await expect(name).toHaveValue("Synthetic Unsaved Name", { timeout: 100 });
    }).toPass({ timeout: 15_000 });
    await dirty(page);

    const { session } = await deviceSession(context);
    const undo = faultRefresh(String(session.refresh_token), 429, "over_request_rate_limit");
    try {
      await expireAccessToken(context);
      const before = (await authCookies(context)).map((c) => [c.name, c.value]);
      const out = logOffset(SERVER_STDOUT_LOG);
      const err = logOffset(SERVER_STDERR_LOG);

      for (let i = 1; i <= 2; i++) {
        const answer = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/session-status", { timeout: 15_000 });
        await resume(page);
        expect((await answer).status(), `poll ${i} during the rate limit`).toBe(503);
        await page.waitForTimeout(300);
      }
      expect(lines(SERVER_STDERR_LOG, err, "[e2e-auth-faults] refresh answered 429").length, "the server's refresh was rate-limited").toBeGreaterThan(0);
      expect(new URL(page.url()).pathname).toBe("/patients");
      await expect(name).toHaveValue("Synthetic Unsaved Name");
      expect(await page.evaluate(() => document.documentElement.style.visibility), "not concealed").not.toBe("hidden");
      expect((await authCookies(context)).map((c) => [c.name, c.value]), "the auth cookies are untouched").toEqual(before);
      expect(await storage(page), "nothing purged").toEqual(["synthetic", "synthetic"]);
      expect(lines(SERVER_STDOUT_LOG, out, '"event":"auth.signout.done"'), "no server sign-out").toEqual([]);

      // A full page load during the incident: the unavailable state, not /login; cookies and device data kept.
      await page.goto("/patients");
      expect(new URL(page.url()).pathname).toBe("/patients");
      await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
      expect((await authCookies(context)).map((c) => [c.name, c.value])).toEqual(before);
      expect(await storage(page)).toEqual(["synthetic", "synthetic"]);
      expect(lines(SERVER_STDERR_LOG, err, '"event":"auth.proxy.unavailable"').length).toBeGreaterThan(0);
    } finally {
      undo();
    }

    // Auth answers again: a reload refreshes the session and opens the page.
    await page.reload();
    await expect(page).toHaveURL((url) => url.pathname === "/patients");
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
    const refreshed = await deviceSession(context);
    expect(refreshed.session.refresh_token === session.refresh_token, "the session was refreshed").toBe(false);

    // Control: a definitive GoTrue answer to the refresh still signs the device out (the harness sees a sign-out).
    const undoDefinitive = faultRefresh(String(refreshed.session.refresh_token), 400, "refresh_token_not_found");
    try {
      await expireAccessToken(context);
      await page.goto("/patients");
      await page.waitForURL((url) => url.pathname === "/login", { timeout: 20_000 });
      await expect.poll(async () => (await authCookies(context)).length).toBe(0);
    } finally {
      undoDefinitive();
    }
  });
});

test.describe("M-REMOVED-R1 / L-R4: the device is pinned to the clinic it opened", () => {
  async function receptionistOfA(page: Page, context: BrowserContext) {
    const tag = `${readRunData().runTag} ${Date.now()}`;
    const a = await seedTenantWithOwner(`PWA Pin A ${tag}`);
    const member = await addMemberToTenant(a.tenantId, "receptionist");
    const pinned = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/session-status" && r.status() === 200, { timeout: 30_000 });
    await uiSignIn(page, { email: member.userEmail, password: seededUserPassword() });
    await pinned;
    // The first poll pinned clinic A (the test never set the cookie).
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === ACTIVE_TENANT_COOKIE)?.value ?? null)
      .toBe(a.tenantId);
    const cookie = (await context.cookies()).find((c) => c.name === ACTIVE_TENANT_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    const setStatus = async (tenantId: string, status: "removed") => {
      const { error } = await getAdminClient()
        .from("memberships")
        .update({ status, removed_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("user_id", member.userId);
      expect(error).toBeNull();
    };
    return { a, member, setStatus, tag };
  }

  async function expectPurgedAndSignedOut(page: Page, context: BrowserContext) {
    expect(await storage(page)).toEqual([null, null]);
    expect(await authCookies(context)).toEqual([]);
    expect((await context.cookies()).filter((c) => c.name === ACTIVE_TENANT_COOKIE), "the pinned clinic is forgotten").toEqual([]);
  }

  test("@golden never had the cookie, added to B, removed from A: the next resume signs out and purges; signing in again opens B", async ({
    page,
    context,
  }) => {
    const { a, member, setStatus, tag } = await receptionistOfA(page, context);
    const b = await seedTenantWithOwner(`PWA Pin B ${tag}`);
    const { error } = await getAdminClient().from("memberships").insert({ user_id: member.userId, tenant_id: b.tenantId, role: "receptionist" });
    expect(error).toBeNull();
    await expect(page.getByText(a.tenantName).first()).toBeAttached();
    await dirty(page);
    const offset = logOffset(SERVER_STDOUT_LOG);
    await setStatus(a.tenantId, "removed");
    await resumeUntilLogin(page);
    await expectPurgedAndSignedOut(page, context);
    expect(lines(SERVER_STDOUT_LOG, offset, '"event":"auth.signout.done"').length, "the session was ended on the server").toBeGreaterThan(0);

    await uiSignIn(page, { email: member.userEmail, password: seededUserPassword() });
    await expect(page.getByText(b.tenantName).first()).toBeAttached();
  });

  test("removed from the last clinic: a full page load signs out and purges (never /clinic/new)", async ({ page, context }) => {
    const { a, setStatus } = await receptionistOfA(page, context);
    await dirty(page);
    await setStatus(a.tenantId, "removed");
    const seen: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) seen.push(new URL(frame.url()).pathname);
    });
    await page.goto("/patients");
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 20_000 });
    expect(seen).not.toContain("/clinic/new");
    await expectPurgedAndSignedOut(page, context);
  });
});

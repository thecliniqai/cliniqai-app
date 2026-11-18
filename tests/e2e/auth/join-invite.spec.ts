/**
 * V2-05 05-07b (AUTH-06; R-31 minimal functional `/join`, R-46): the invitation page at 360, 820 and 1280 px.
 *
 * `/join?token=…` renders from `peek_invitation` (no side effect): a pending invitation shows the clinic, the role and
 * the masked address, the set-password form with the Turnstile widget (answered by the local stub) and "Sign in";
 * an unknown token shows the fixed "not valid" text. axe: 0 serious/critical (WCAG 2.0/2.1/2.2 A+AA) at every width,
 * no horizontal scroll at 360 px, screenshots attached.
 *
 * One functional pass end to end: the new invitee submits a password; the e2e server verifies the widget token
 * server-side against the loopback fake siteverify (R-46), checks FT-05 against the fake range API, creates the account
 * through the system path and redeems the invitation; the page says the account is ready and the address can sign in.
 * The invitation belongs to a clinic this spec creates (teardown removes it), so no shared e2e clinic gains a member.
 * Synthetic data only; the password is built at run time.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { readRunData } from "../support/run-data";

test.use({ storageState: { cookies: [], origins: [] } });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

function seriousOrCritical(results: AxeResults) {
  return results.violations
    .filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

async function check(page: Page, testInfo: TestInfo, name: string, width: number): Promise<void> {
  // The form keeps submit disabled until hydration, then fades it in (150 ms): scan the settled page (02-06 guard).
  const submits = page.locator('button[type="submit"]');
  if (await submits.count()) {
    await expect(submits.first()).toBeEnabled();
    await expect.poll(() => submits.first().evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  }
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify({ url: results.url.replace(/token=[0-9a-f]+/, "token=<redacted>"), violations: results.violations }, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach(`screenshot-${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(seriousOrCritical(results), "serious/critical axe violations on /join").toEqual([]);
  if (width === 360) {
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, "horizontal scroll at 360px").toBe(false);
  }
}

const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** A clinic of this spec with a pending invitation to `email` (only `peek_invitation` and the system path read it). */
async function seedInvitation(email: string, role: string): Promise<{ token: string; clinic: string }> {
  const admin = getAdminClient();
  const run = readRunData();
  const clinic = `Synthetic Join Clinic ${randomBytes(3).toString("hex")}`;
  const { data: tenant, error: tErr } = await admin.from("tenants").insert({ name: clinic }).select("id").single();
  if (tErr || !tenant) throw new Error(`seed clinic failed: ${tErr?.code}`);
  const token = randomBytes(32).toString("hex");
  const { error } = await admin.from("invitations").insert({
    tenant_id: tenant.id,
    role,
    invited_address: email,
    token_hash: sha256(token),
    expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
    // The run's tenant-A owner is a real auth user (created_by references auth.users).
    created_by: run.tenantA.users.owner.id,
  });
  if (error) throw new Error(`seed invitation failed: ${error.code}`);
  return { token, clinic };
}

test.describe("/join (invitation)", () => {
  test("a pending invitation: clinic, role, masked address, set-password form; axe and layout at 360/820/1280", async ({
    page,
  }, testInfo) => {
    const email = `join-view-${randomBytes(4).toString("hex")}@example.test`;
    const { token, clinic } = await seedInvitation(email, "doctor");
    await page.setViewportSize(WIDTHS[2]);
    await page.goto(`/join?token=${token}`);
    await expect(page.getByRole("heading", { name: "Join your clinic" })).toBeVisible();
    await expect(page.getByText(clinic, { exact: true })).toBeVisible();
    await expect(page.getByText("Doctor", { exact: true })).toBeVisible();
    await expect(page.getByText(`${email[0]}***@example.test`, { exact: true })).toBeVisible();
    await expect(page.getByLabel("New password")).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    // The page never shows the full address.
    await expect(page.getByText(email)).toHaveCount(0);

    for (const size of WIDTHS) {
      await page.setViewportSize(size);
      await expect(page.getByLabel("New password")).toBeVisible();
      await check(page, testInfo, `join-pending-${testInfo.project.name}-${size.width}`, size.width);
    }
  });

  test("an unknown token shows the fixed text; axe at 360/820/1280", async ({ page }, testInfo) => {
    await page.goto(`/join?token=${randomBytes(32).toString("hex")}`);
    await expect(page.getByText("This invitation link is not valid. Ask your clinic to send a new one.")).toBeVisible();
    await expect(page.getByLabel("New password")).toHaveCount(0);
    for (const size of WIDTHS) {
      await page.setViewportSize(size);
      await check(page, testInfo, `join-unknown-${testInfo.project.name}-${size.width}`, size.width);
    }
  });

  test("a new invitee sets a password: server-side Turnstile, FT-05, account created, invitation redeemed", async ({ page }) => {
    const email = `join-new-${randomBytes(4).toString("hex")}@example.test`;
    const { token } = await seedInvitation(email, "nurse");
    const password = `Join-${randomBytes(12).toString("base64url")}`;
    await page.goto(`/join?token=${token}`);
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account and join" }).click();
    await expect(page.getByText("Your account is ready. Sign in with your new password.")).toBeVisible();

    const admin = getAdminClient();
    const { data: inv } = await admin.from("invitations").select("consumed_at, consumed_by").eq("token_hash", sha256(token)).single();
    expect(inv?.consumed_at).not.toBeNull();
    const { data: membership } = await admin.from("memberships").select("role, status").eq("user_id", inv?.consumed_by ?? "").single();
    expect(membership).toEqual({ role: "nurse", status: "active" });

    // The same link now reads as used.
    await page.goto(`/join?token=${token}`);
    await expect(page.getByText("This invitation has already been used. Sign in to continue.")).toBeVisible();
  });
});

/**
 * V2-04 04-03b (R-26; P0-12): the developer-settings test ping is queued, not sent from the request. The owner sends a
 * test ping for a webhook endpoint seeded with the local service-role path (psql against the local stack); the
 * subscription row shows the polite status line "Test ping queued. The result appears in Delivery logs within about a
 * minute.", and exactly one `ping` delivery row with one `webhook.deliver` job exists (pg_cron is paused in the lane, so
 * the job stays pending; nothing contacts the endpoint). Then, at 360, 820 and 1280 px: the status line stays visible,
 * 0 serious/critical axe violations (WCAG 2.0/2.1/2.2 A+AA), no horizontal scroll at 360 px, full-page screenshots
 * attached for the visual check.
 *
 * Runs on desktop-chrome and pixel-7 (one ping per project: the clinic's limit is 5 per minute and both projects share
 * tenant A, so the widths are checked on one rendered result rather than one ping each).
 */
import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { psql } from "../../helpers/sql";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];
const QUEUED = "Test ping queued. The result appears in Delivery logs within about a minute.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

function seriousOrCritical(results: AxeResults) {
  return results.violations
    .filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

async function check(page: Page, testInfo: TestInfo, name: string, width: number): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify({ url: results.url, violations: results.violations }, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach(`screenshot-${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(seriousOrCritical(results), "serious/critical axe violations").toEqual([]);
  if (width === 360) {
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, "horizontal scroll at 360px").toBe(false);
  }
}

test.use({ storageState: storageStatePath("owner") });

let subscriptionId: string | undefined;

test.afterEach(() => {
  if (!subscriptionId) return;
  // The delivery rows go with the subscription (ON DELETE CASCADE); their jobs are removed so no later runner pass in
  // the lane picks them up.
  psql(
    `delete from ops.jobs where kind = 'webhook.deliver' and payload ->> 'delivery_id' in ` +
      `(select id::text from public.webhook_delivery_queue where subscription_id = '${subscriptionId}'); ` +
      `delete from public.webhook_subscriptions where id = '${subscriptionId}'`
  );
  subscriptionId = undefined;
});

test("the owner's test ping is queued: status line, one ping row and one job; axe and layout at 360/820/1280", async ({ page }, testInfo) => {
  const { tenantA } = readRunData();
  const endpoint = `https://e2e-ping-${randomBytes(4).toString("hex")}.example.test/hook`;
  const [id] = psql(
    `insert into public.webhook_subscriptions (tenant_id, endpoint_url, event_types, signing_secret, is_active, created_by) ` +
      `values ('${tenantA.id}', '${endpoint}', array['visit.completed'], '${["whsec", randomBytes(16).toString("hex")].join("_")}', ` +
      `true, '${tenantA.users.owner.id}') returning id`
  );
  expect(id).toMatch(UUID);
  subscriptionId = id;

  await page.setViewportSize(WIDTHS[2]);
  await page.goto("/settings/developer");
  const row = page.getByRole("row").filter({ hasText: endpoint });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Send test ping to ${endpoint}` }).click();
  const status = row.getByRole("status");
  await expect(status).toHaveText(QUEUED);
  await expect(status).toHaveAttribute("aria-live", "polite");

  const rows = psql(
    `select id || '|' || event_type || '|' || status from public.webhook_delivery_queue where subscription_id = '${id}'`
  );
  expect(rows).toHaveLength(1);
  const [deliveryId, eventType, rowStatus] = rows[0].split("|");
  expect([eventType, rowStatus]).toEqual(["ping", "pending"]);
  expect(
    psql(`select status || '|' || dedupe_key from ops.jobs where kind = 'webhook.deliver' and payload ->> 'delivery_id' = '${deliveryId}'`)
  ).toEqual([`pending|wh:${deliveryId}`]);

  for (const size of WIDTHS) {
    await page.setViewportSize(size);
    await expect(status).toHaveText(QUEUED);
    await check(page, testInfo, `developer-test-ping-${testInfo.project.name}-${size.width}`, size.width);
  }
});

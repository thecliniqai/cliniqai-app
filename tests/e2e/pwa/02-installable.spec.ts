/**
 * PWA spec 2 (PWA_STRATEGY §9.1; V2-06 06-05; roadmap acceptance "Chrome reports the app installable"). Chromium only:
 * signed in, once the service worker controls the page, the CDP `Page.getInstallabilityErrors` list is empty. The
 * result is written to `design-captures/06-05/installability-<project>.json` (git-ignored; copied into the plan's
 * evidence). Before 06-05: errors (no manifest, no service worker).
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, waitForServiceWorker } from "./fixtures";
import { storageStatePath } from "../support/run-data";
import { ROOT } from "../support/app-env";

test.use({ storageState: storageStatePath("owner") });

test("Chrome reports the signed-in app installable (Page.getInstallabilityErrors is empty)", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "CDP installability check is Chromium only");
  await page.goto("/");
  await waitForServiceWorker(page);
  const cdp = await page.context().newCDPSession(page);
  const result = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: Array<{ errorId: string }> };
  const manifest = (await cdp.send("Page.getAppManifest")) as { url: string; errors: unknown[] };
  const report = {
    project: testInfo.project.name,
    checkedAt: new Date().toISOString(),
    page: new URL(page.url()).pathname,
    manifestUrl: new URL(manifest.url).pathname,
    manifestErrors: manifest.errors,
    installabilityErrors: result.installabilityErrors,
  };
  const out = path.join(ROOT, "design-captures/06-05", `installability-${testInfo.project.name}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("installability.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  expect(manifest.errors).toEqual([]);
  expect(result.installabilityErrors).toEqual([]);
});

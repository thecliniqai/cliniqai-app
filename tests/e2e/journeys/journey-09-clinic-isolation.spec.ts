/**
 * TEST_STRATEGY journey 9 — clinic isolation (V2-02 plan 02-03b, RL-15).
 *
 * A signed-in clinic-A user pastes clinic B's patient and visit URLs (pages and the PDF routes). Each one must be
 * refused (not found / denied), and none of clinic B's data (clinic name, patient name, phone) may appear in the DOM
 * or in ANY network response the browser received while loading it.
 */
import type { Page, Response } from "@playwright/test";
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { readRunData, storageStatePath, type E2eRole } from "../support/run-data";

async function tenantBMarkers(): Promise<string[]> {
  const { tenantB } = readRunData();
  const { data, error } = await getAdminClient().from("patients").select("phone").eq("id", tenantB.patientId).single();
  if (error || !data) throw new Error(`journey 9: tenant B patient read failed: ${error?.message}`);
  const phone = (data as { phone: string }).phone;
  return [tenantB.name, tenantB.patientName, phone, phone.slice(3)];
}

/** Collects the text of every response the page receives until `stop()` is awaited. */
function captureResponses(page: Page): () => Promise<Array<{ url: string; body: string }>> {
  const pending: Array<Promise<{ url: string; body: string }>> = [];
  const onResponse = (response: Response) => {
    pending.push(
      response
        .body()
        .then((buf) => ({ url: response.url(), body: buf.toString("utf8") }))
        .catch(() => ({ url: response.url(), body: "" })),
    );
  };
  page.on("response", onResponse);
  return async () => {
    page.off("response", onResponse);
    return Promise.all(pending);
  };
}

for (const role of ["owner", "doctor", "receptionist"] as const satisfies readonly E2eRole[]) {
  test.describe(`clinic A ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });

    test(`${role}: clinic B's patient and visit URLs are refused with no B data in DOM or network`, async ({ page }) => {
      const { tenantB } = readRunData();
      const markers = await tenantBMarkers();
      const pages = [`/patients/${tenantB.patientId}`, `/consultation/${tenantB.visitId}`];

      for (const path of pages) {
        const stop = captureResponses(page);
        const response = await page.goto(path);
        await page.waitForLoadState("load");
        // Refused: not found (404) or sent elsewhere — never a page for B's record.
        const served = response?.status() === 200 && new URL(page.url()).pathname === path;
        expect(served, `${path} was served to a clinic A ${role}`).toBe(false);

        const html = await page.content();
        const bodies = await stop();
        for (const marker of markers) {
          expect(html, `DOM of ${path}`).not.toContain(marker);
          for (const { url, body } of bodies) expect(body, `response ${url} while loading ${path}`).not.toContain(marker);
        }
      }

      for (const path of [
        `/api/visits/${tenantB.visitId}/prescription-pdf`,
        `/api/invoices/${tenantB.visitId}/receipt-pdf`,
        `/api/patients/${tenantB.patientId}/export`,
      ]) {
        const response = await page.request.get(path, { maxRedirects: 0 });
        expect([401, 403, 404], `${path} status`).toContain(response.status());
        const body = (await response.body()).toString("utf8");
        for (const marker of markers) expect(body, `body of ${path}`).not.toContain(marker);
      }
    });
  });
}

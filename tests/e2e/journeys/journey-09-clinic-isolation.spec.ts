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

type Captured = { url: string; status: number; body: string; unreadable: boolean };

/** How long to wait for one response body. A streamed RSC prefetch can stay open after load (02-06 CI flake). */
const BODY_READ_MS = 5_000;

/**
 * Collects the text of every response the page receives until `stop()` is awaited. A body that cannot be read
 * (stream still open, evicted by the browser) is reported as `unreadable`, never as an empty, passing body.
 */
function captureResponses(page: Page): () => Promise<Captured[]> {
  const pending: Array<Promise<Captured>> = [];
  const onResponse = (response: Response) => {
    const url = response.url();
    const status = response.status();
    const timeout = new Promise<Captured>((resolve) =>
      setTimeout(() => resolve({ url, status, body: "", unreadable: true }), BODY_READ_MS),
    );
    pending.push(
      Promise.race([
        response
          .body()
          .then((buf) => ({ url, status, body: buf.toString("utf8"), unreadable: false }))
          .catch(() => ({ url, status, body: "", unreadable: true })),
        timeout,
      ]),
    );
  };
  page.on("response", onResponse);
  return async () => {
    page.off("response", onResponse);
    return Promise.all(pending);
  };
}

/**
 * An unreadable body is acceptable only where the content is checked another way:
 * - a Next.js RSC prefetch of a *different* route (the dashboard nav prefetches clinic-A pages, which cannot
 *   carry B's record);
 * - the probed page's own document, whose server HTML the test fetches directly (`serverHtml` below), because
 *   the browser discards it when the client redirects away.
 * Anything else must be readable so the "no B data" assertion is not vacuous.
 */
function unreadableIsAcceptable(capturedUrl: string, probedPath: string): boolean {
  const url = new URL(capturedUrl);
  if (url.pathname === probedPath && !url.searchParams.has("_rsc")) return true;
  return url.searchParams.has("_rsc") && url.pathname !== probedPath;
}

for (const role of ["owner", "doctor", "receptionist"] as const satisfies readonly E2eRole[]) {
  test.describe(`clinic A ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });

    test(`${role}: clinic B's patient and visit URLs are refused with no B data in DOM or network`, async ({ page }) => {
      // Two page loads with network capture plus three API probes: allow 3x the default budget so slow CI devices
      // don't time out mid-probe; each probe keeps its own 10 s limit so a hanging route fails by name.
      test.slow();
      const { tenantB } = readRunData();
      const markers = await tenantBMarkers();
      const pages = [`/patients/${tenantB.patientId}`, `/consultation/${tenantB.visitId}`];

      for (const path of pages) {
        // A fresh page per URL: a late response from the previous navigation must not land in this capture
        // (the context keeps the session and the loopback-only network block).
        const probe = await page.context().newPage();
        const stop = captureResponses(probe);
        const response = await probe.goto(path);
        await probe.waitForLoadState("load");
        // Refused: not found (404) or sent elsewhere — never a page for B's record.
        const served = response?.status() === 200 && new URL(probe.url()).pathname === path;
        expect(served, `${path} was served to a clinic A ${role}`).toBe(false);

        const html = await probe.content();
        // The server's own first response for B's URL, with this session, no redirects followed: the document the
        // browser may already have discarded.
        const serverHtml = (
          await (await probe.request.get(path, { maxRedirects: 0, timeout: 10_000 })).body()
        ).toString("utf8");
        const bodies = await stop();
        const unexpectedlyUnreadable = bodies
          .filter((b) => b.unreadable && !unreadableIsAcceptable(b.url, path))
          .map((b) => `${b.status} ${b.url}`);
        expect(unexpectedlyUnreadable, `responses while loading ${path} whose bodies could not be checked`).toEqual([]);
        for (const marker of markers) {
          expect(html, `DOM of ${path}`).not.toContain(marker);
          expect(serverHtml, `server HTML of ${path}`).not.toContain(marker);
          for (const { url, body } of bodies) expect(body, `response ${url} while loading ${path}`).not.toContain(marker);
        }
        await probe.close();
      }

      // Each PDF probe names a row that exists in clinic B (IR-F9: the receipt probe once sent a visit id, which can
      // never match an invoice, so its 404 proved nothing about isolation).
      const { data: bInvoice } = await getAdminClient()
        .from("invoices")
        .select("tenant_id")
        .eq("id", tenantB.invoiceId)
        .maybeSingle();
      expect((bInvoice as { tenant_id: string } | null)?.tenant_id, "the probed invoice is clinic B's").toBe(tenantB.id);

      for (const path of [
        `/api/visits/${tenantB.visitId}/prescription-pdf`,
        `/api/invoices/${tenantB.invoiceId}/receipt-pdf`,
        `/api/patients/${tenantB.patientId}/export`,
      ]) {
        await test.step(`probe ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, async () => {
          const response = await page.request.get(path, { maxRedirects: 0, timeout: 10_000 });
          expect([401, 403, 404], `${path} status`).toContain(response.status());
          const body = (await response.body()).toString("utf8");
          for (const marker of markers) expect(body, `body of ${path}`).not.toContain(marker);
        });
      }
    });
  });
}

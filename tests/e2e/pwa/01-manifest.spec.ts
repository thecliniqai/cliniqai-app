/**
 * PWA spec 1 (PWA_STRATEGY §9.1, §3.1 public-asset rule; V2-06 06-05) on the built app.
 *
 * With no cookies, every PWA asset answers 200 with no redirect (`maxRedirects: 0`) and its content type: browsers
 * fetch the manifest without credentials and the service worker precaches with `credentials: "omit"`, so a 307 to
 * `/login` here would break install or put a login page into the cache. Before 06-05: no manifest, and the proxy's
 * default deny answered 307 → `/login?next=…`.
 *
 * The same requests as a locked tenant's owner and receptionist (V2-05 05-10b fixtures) are written and run with 06-06
 * after the 05b merge-in (plan revision 2026-11-14).
 */
import { expect, test } from "../fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

test("signed out: /manifest.webmanifest answers 200 application/manifest+json with the PWA §3.1 fields", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^application\/manifest\+json/);
  const manifest = (await res.json()) as Record<string, unknown>;
  expect(manifest).toMatchObject({
    id: "/",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
  });
  expect(manifest).not.toHaveProperty("orientation");
  expect(manifest).not.toHaveProperty("shortcuts");
});

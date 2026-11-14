/**
 * PWA spec 1 (PWA_STRATEGY §9.1, §3.1 public-asset rule; V2-06 06-05) on the built app.
 *
 * With no cookies, every PWA asset answers 200 with no redirect (`maxRedirects: 0`) and its content type: browsers
 * fetch the manifest without credentials and the service worker precaches with `credentials: "omit"`, so a 307 to
 * `/login` here would break install or put a login page into the cache. The manifest carries the PWA §3.1 fields and a
 * 192, a 512 and a maskable 512 icon whose PNG header sizes match what it declares. Before 06-05: no manifest, no
 * worker, no offline page, and the proxy's default deny answered 307 → `/login?next=…`.
 *
 * 06-01b: the manifest carries the CliniQ AI brand (name and short name "CliniQ AI", theme and background `#FFFFFF`,
 * the approved token values) and `/offline` names the product (before: "ClinicQ" and the Wave A colours).
 *
 * The same requests as a locked tenant's owner and receptionist (V2-05 05-10b fixtures) are written and run with 06-06
 * after the 05b merge-in (plan revision 2026-11-14).
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

function pngSize(body: Buffer): { width: number; height: number } | null {
  if (body.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || body.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

async function getNoRedirect(request: APIRequestContext, url: string) {
  const res = await request.get(url, { maxRedirects: 0 });
  expect(res.status(), `${url} answers 200 without a redirect`).toBe(200);
  expect(res.headers()["location"], url).toBeUndefined();
  return res;
}

test("signed out: /manifest.webmanifest answers 200 application/manifest+json with the PWA §3.1 fields", async ({ request }) => {
  const res = await getNoRedirect(request, "/manifest.webmanifest");
  expect(res.headers()["content-type"]).toMatch(/^application\/manifest\+json/);
  const manifest = (await res.json()) as Record<string, unknown>;
  expect(manifest).toMatchObject({
    id: "/",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    theme_color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
    background_color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
  });
  expect(manifest.name).toBe("CliniQ AI");
  expect(manifest.short_name).toBe("CliniQ AI");
  expect((manifest.short_name as string).length).toBeLessThanOrEqual(12);
  expect((manifest.theme_color as string).toLowerCase()).toBe("#ffffff");
  expect((manifest.background_color as string).toLowerCase()).toBe("#ffffff");
  expect(manifest).not.toHaveProperty("orientation");
  expect(manifest).not.toHaveProperty("shortcuts");
});

test("signed out: every manifest icon is a PNG of its declared size; 192 any, 512 any and 512 maskable exist", async ({ request }) => {
  const manifest = (await (await getNoRedirect(request, "/manifest.webmanifest")).json()) as { icons: ManifestIcon[] };
  const kinds = manifest.icons.map((i) => `${i.sizes} ${i.purpose ?? "any"}`).sort();
  expect(kinds).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of manifest.icons) {
    const res = await getNoRedirect(request, icon.src);
    expect(res.headers()["content-type"], icon.src).toBe("image/png");
    const [w, h] = icon.sizes.split("x").map(Number);
    expect(pngSize(await res.body()), icon.src).toEqual({ width: w, height: h });
  }
});

test("signed out: /sw.js, /offline, /icon.svg and /apple-icon.png answer 200 with their content types", async ({ request }) => {
  const sw = await getNoRedirect(request, "/sw.js");
  expect(sw.headers()["content-type"]).toBe("application/javascript; charset=utf-8");
  expect(await sw.text()).toContain('addEventListener("fetch"');

  const offline = await getNoRedirect(request, "/offline");
  expect(offline.headers()["content-type"]).toMatch(/^text\/html/);
  const offlineHtml = await offline.text();
  expect(offlineHtml).toContain("Patient data isn");
  expect(offlineHtml).toContain("CliniQ AI");
  expect(offlineHtml).toMatch(/<title>Offline · CliniQ AI<\/title>/);
  expect(offlineHtml).not.toContain("ClinicQ");

  const svg = await getNoRedirect(request, "/icon.svg");
  expect(svg.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
  const apple = await getNoRedirect(request, "/apple-icon.png");
  expect(apple.headers()["content-type"]).toBe("image/png");
  expect(pngSize(await apple.body())).toEqual({ width: 180, height: 180 });
});

test("the root document links the manifest, the icons and the PWA viewport (no pinch-zoom lock)", async ({ request }) => {
  const html = await (await getNoRedirect(request, "/login")).text();
  expect(html).toMatch(/<html[^>]*lang="en-IN"/);
  expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
  expect(html).toMatch(/<link rel="icon" href="\/icon\.svg[^"]*"[^>]*type="image\/svg\+xml"/);
  expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-icon\.png[^"]*"/);
  expect(html).toMatch(/<meta name="theme-color" content="#ffffff"/i);
  expect(html).toMatch(/<title>CliniQ AI<\/title>|<title>[^<]* · CliniQ AI<\/title>/);
  expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="CliniQ AI"/);
  expect(html).toMatch(/<meta name="mobile-web-app-capable" content="yes"/);
  const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html)?.[1] ?? "";
  expect(viewport).toContain("viewport-fit=cover");
  expect(viewport).toContain("interactive-widget=resizes-content");
  expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
});

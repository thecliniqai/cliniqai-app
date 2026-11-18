/**
 * V2-03 03-12b (OA-5, R-28): the proxy's public-path allow-list, checked against the filesystem.
 *
 * Every `page.tsx` and `route.ts` under `app/` is enumerated (route groups dropped, dynamic segments filled), so:
 * - every dashboard and onboarding page is protected, and so is any page outside the known public directories
 *   (default deny: a new page is protected without editing anything);
 * - exactly the (auth), share-token, reschedule and `/offline` pages are public;
 * - no `/api` route is ever redirected (handlers authenticate themselves);
 * - every public prefix matches at least one existing page, route or PWA asset (no stale entries);
 * - V2-06 06-05 (PWA_STRATEGY §3.1): the manifest (`app/manifest.ts` → `/manifest.webmanifest`), every `public/**` file
 *   (`/sw.js`, the icons) and the `app/` icon files are reachable signed out: under a public prefix, or skipped by the
 *   proxy matcher (single-segment image files).
 * Encoded and look-alike paths cannot reach a protected page as public, and the login `next` value is always a plain
 * same-origin path.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";
import { isApiPath, loginNextValue, pageNeedsSession, PUBLIC_PAGE_PREFIXES } from "@/lib/auth/public-paths";

const APP = path.join(process.cwd(), "app");

interface AppFile {
  /** Path relative to the repo, e.g. `app/(dashboard)/patients/[id]/page.tsx`. */
  file: string;
  /** URL pattern, e.g. `/patients/[id]`. */
  pattern: string;
  /** Concrete URL with every dynamic segment filled. */
  url: string;
  kind: "page" | "route" | "asset";
}

function walk(dir: string, segments: string[] = []): AppFile[] {
  const out: AppFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...walk(path.join(dir, entry.name), [...segments, entry.name]));
    } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
      const visible = segments.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
      out.push({
        file: path.posix.join("app", ...segments, entry.name),
        pattern: `/${visible.join("/")}`,
        url: `/${visible.map((s) => (/^\[.*\]$/.test(s) ? "0123456789abcdef" : s)).join("/")}`,
        kind: entry.name === "page.tsx" ? "page" : "route",
      });
    }
  }
  return out;
}

/** The `app/` metadata files that become root assets (06-05): the manifest route and the icon files. */
const APP_ASSETS: Record<string, string> = {
  "manifest.ts": "/manifest.webmanifest",
  "icon.svg": "/icon.svg",
  "apple-icon.png": "/apple-icon.png",
};

/** `app/` root metadata assets and every file under `public/` (served at `/<path>`). */
function assets(): AppFile[] {
  const out: AppFile[] = [];
  for (const [name, pattern] of Object.entries(APP_ASSETS)) {
    if (fs.existsSync(path.join(APP, name))) out.push({ file: `app/${name}`, pattern, url: pattern, kind: "asset" });
  }
  const walkPublic = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walkPublic(path.join(dir, entry.name), [...segments, entry.name]);
      else {
        const pattern = `/${[...segments, entry.name].join("/")}`;
        out.push({ file: `public${pattern}`, pattern, url: pattern, kind: "asset" });
      }
    }
  };
  const publicDir = path.join(process.cwd(), "public");
  if (fs.existsSync(publicDir)) walkPublic(publicDir, []);
  return out;
}

const ASSETS = assets();
const FILES = [...walk(APP), ...ASSETS];
const PAGES = FILES.filter((f) => f.kind === "page");
const ROUTES = FILES.filter((f) => f.kind === "route");

/** The public pages R-28 names, by directory. Anything else must be protected. */
const PUBLIC_DIRS = ["app/(auth)/", "app/r/", "app/reports/", "app/reschedule/", "app/offline/"];
const PROTECTED_DIRS = ["app/(dashboard)/", "app/(onboarding)/"];

describe("03-12b public paths (enumerated from app/)", () => {
  it("the enumeration found the pages and routes (an empty walk would make every check vacuous)", () => {
    expect(PAGES.length).toBeGreaterThan(20);
    expect(PAGES.map((p) => p.pattern)).toEqual(
      expect.arrayContaining(["/", "/patients", "/patients/[id]", "/clinic/new", "/login", "/r/[token]"]),
    );
    expect(ROUTES.map((r) => r.pattern)).toEqual(expect.arrayContaining(["/auth/signout", "/api/auth/send-email"]));
  });

  it.each(PAGES.filter((p) => PROTECTED_DIRS.some((d) => p.file.startsWith(d))).map((p) => [p.pattern, p.url]))(
    "dashboard/onboarding page %s is protected",
    (_pattern, url) => {
      expect(pageNeedsSession(url)).toBe(true);
    },
  );

  it("exactly the (auth), share-token, reschedule and offline pages are public; every other page is protected", () => {
    const publicPages = PAGES.filter((p) => !pageNeedsSession(p.url)).map((p) => p.file).sort();
    expect(publicPages).toEqual(PAGES.filter((p) => PUBLIC_DIRS.some((d) => p.file.startsWith(d))).map((p) => p.file).sort());
    expect(publicPages.map((f) => f.replace(/\/page\.tsx$/, ""))).toEqual([
      "app/(auth)/forgot-password",
      "app/(auth)/join",
      "app/(auth)/login",
      "app/offline",
      "app/r/[token]",
      "app/reports/view",
      "app/reschedule/[token]",
    ]);
  });

  it.each(ROUTES.filter((r) => r.pattern.startsWith("/api")).map((r) => [r.pattern, r.url]))(
    "api route %s is never redirected (the handler authenticates)",
    (_pattern, url) => {
      expect(pageNeedsSession(url)).toBe(false);
    },
  );

  it("route handlers outside /api are the public sign-out and service-worker routes (a new one is reviewed here)", () => {
    // 06-09a (M-OFFLINE): `/sw.js` is a route handler (build-stamped worker), no longer a public/ file.
    expect(ROUTES.filter((r) => !isApiPath(r.pattern)).map((r) => [r.pattern, pageNeedsSession(r.url)])).toEqual([
      ["/auth/signout", false],
      ["/sw.js", false],
    ]);
  });

  it.each(PUBLIC_PAGE_PREFIXES.map((p) => [p]))("public prefix %s matches at least one existing page or route", (prefix) => {
    const hits = FILES.filter((f) => f.pattern === prefix || f.pattern.startsWith(`${prefix}/`));
    expect(hits.length, `stale public prefix ${prefix}`).toBeGreaterThan(0);
  });

  it("06-05: the PWA assets exist and each is reachable signed out (public prefix, or skipped by the proxy matcher)", () => {
    expect(ASSETS.map((a) => a.pattern)).toEqual(
      expect.arrayContaining([
        "/manifest.webmanifest",
        "/icon.svg",
        "/apple-icon.png",
        "/icon-192.png",
        "/icon-512.png",
        "/icon-maskable-512.png",
      ]),
    );
    // `public/icons.json` is the icon renderer's record (master SHA-256, sizes), not something a browser fetches; signed
    // out it is default-denied like any other unknown path (fails closed). Any other new public file must be reachable.
    const NOT_FETCHED_BY_BROWSERS = ["/icons.json"];
    for (const asset of ASSETS.filter((a) => !NOT_FETCHED_BY_BROWSERS.includes(a.pattern))) {
      const skipsProxy = !unstable_doesMiddlewareMatch({ config, url: asset.url });
      expect(skipsProxy || !pageNeedsSession(asset.url), `${asset.file} would be redirected signed out`).toBe(true);
    }
    // The three non-image assets run the proxy and are public by prefix; every public/ file stays one segment deep
    // (a nested file would run the proxy and be redirected).
    for (const url of ["/manifest.webmanifest", "/sw.js", "/offline"]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
      expect(pageNeedsSession(url), url).toBe(false);
    }
    expect(ASSETS.filter((a) => a.pattern.split("/").length > 2).map((a) => a.file)).toEqual([]);
    // 06-09a: the worker is the `app/sw.js/route.ts` handler; a `public/sw.js` next to it would not build (the kill
    // switch replaces the route with that file, docs/runbooks/pwa.md).
    expect(ROUTES.map((r) => r.file)).toContain("app/sw.js/route.ts");
    expect(ASSETS.map((a) => a.file)).not.toContain("public/sw.js");
  });

  it("an unknown page path defaults to protected", () => {
    for (const p of ["/settings/new-thing", "/admin", "/platform", "/onboarding", "/x/y/z", "/clinic/new"]) {
      expect(pageNeedsSession(p), p).toBe(true);
    }
  });

  it("prefixes match whole segments only", () => {
    for (const p of [
      "/loginx",
      "/login-help",
      "/rx",
      "/reports",
      "/reports/viewer",
      "/reschedulex",
      "/joined",
      "/authx",
      "/sw.jsx",
      "/sw",
      "/offlinex",
      "/offline-patients",
      "/manifest.webmanifestx",
      "/manifest",
    ]) {
      expect(pageNeedsSession(p), p).toBe(true);
    }
    for (const p of [
      "/login",
      "/login/",
      "/r/abc",
      "/reports/view",
      "/reschedule/abc",
      "/join",
      "/auth/signout",
      "/manifest.webmanifest",
      "/sw.js",
      "/offline",
    ]) {
      expect(pageNeedsSession(p), p).toBe(false);
    }
  });

  it("encoded separators and dot segments cannot make a protected page public", () => {
    for (const p of [
      "/r/..%2Fpatients",
      "/offline/..%2Fpatients",
      "/offline%2F..%2Fpatients",
      "/sw.js/..%2F..%2Fpatients",
      "/manifest.webmanifest/..%2Fqueue",
      "/r/x%2F..%2F..%2Fpatients",
      "/r%2F..%2Fpatients",
      "/login%2F..%2Fpatients",
      "/patients/..%2F..%2Flogin",
      "/patients/..%2F..%2Fapi/health",
      "/patients/%2e%2e%2f..%2fr/x",
      "/_next/..%2Fpatients",
      "/__nextjs%2F..%2Fpatients",
      "/api%2F..%2Fpatients",
      "/login\\..\\patients",
      "/%",
      "/patients/%E0%A4",
    ]) {
      expect(pageNeedsSession(p), p).toBe(true);
    }
  });

  it("Next internals and /api are passed through", () => {
    for (const p of ["/_next/data/build/x.json", "/__nextjs_original-stack-frame", "/api", "/api/health", "/api/v1/patients"]) {
      expect(pageNeedsSession(p), p).toBe(false);
    }
  });

  it("loginNextValue keeps the path and query, drops _rsc, and refuses off-site shapes", () => {
    const at = (u: string) => loginNextValue(new URL(`http://localhost:3100${u}`));
    expect(at("/patients")).toBe("/patients");
    expect(at("/patients/abc?tab=visits&x=1")).toBe("/patients/abc?tab=visits&x=1");
    expect(at("/queue?_rsc=abc123")).toBe("/queue");
    expect(at("/queue?date=2026-01-01&_rsc=abc")).toBe("/queue?date=2026-01-01");
    expect(at("/")).toBe("/");
    expect(loginNextValue(new URL("http://localhost:3100//evil.example/x"))).toBeNull();
    const backslash = new URL("http://localhost:3100/x");
    backslash.pathname = "/\\evil.example";
    expect(loginNextValue(backslash)).toBeNull();
  });
});

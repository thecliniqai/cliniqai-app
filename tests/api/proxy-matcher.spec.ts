/**
 * V2-03 03-13a (review D L-4): which paths run `proxy.ts`, through Next's own matcher logic
 * (`unstable_doesMiddlewareMatch` compiles `config.matcher` exactly as the build does).
 *
 * Fails without the fix: the 03-06 matcher excluded `.*\.(svg|png|jpg|jpeg|gif|webp)$` at ANY depth, so
 * `/patients/<id>.png` reached `app/(dashboard)/patients/[id]` without the proxy (no default-deny redirect, no session
 * refresh, no request id). Now only a single top-level segment with an image extension (`/logo.png`) is excluded.
 * The built-app proof (307 to /login with a request id) is `tests/e2e/security/unauth-pages.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";

const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe("proxy matcher (03-13a L-4)", () => {
  it.each([
    "/patients/abc.png",
    "/patients/0b9f1c1e-2a5d-4c1b-9d7e-1f2a3b4c5d6e.svg",
    "/consultation/x.jpg",
    "/settings/logo.jpeg",
    "/patients/x.webp",
    "/billing/a/b/c.gif",
    "/patients",
    "/",
    "/login",
    "/r/token.png",
    "/api/patients/abc.png",
    "/api/v%31/x.png",
  ])("runs the proxy for %s", (url) => {
    expect(runs(url)).toBe(true);
  });

  it.each(["/logo.png", "/icon.svg", "/og.webp", "/_next/static/chunks/app.js", "/_next/image", "/favicon.ico"])(
    "skips static asset %s",
    (url) => {
      expect(runs(url)).toBe(false);
    },
  );
});

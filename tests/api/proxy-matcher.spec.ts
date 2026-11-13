/**
 * V2-03 03-13a (review D L-4): which paths run `proxy.ts`, through Next's own matcher logic
 * (`unstable_doesMiddlewareMatch` compiles `config.matcher` exactly as the build does).
 *
 * Fails without the fix: the 03-06 matcher excluded `.*\.(svg|png|jpg|jpeg|gif|webp)$` at ANY depth, so
 * `/patients/<id>.png` reached `app/(dashboard)/patients/[id]` without the proxy (no default-deny redirect, no session
 * refresh, no request id). Now only a single top-level segment with an image extension (`/logo.png`) is excluded.
 * The built-app proof (307 to /login with a request id) is `tests/e2e/security/unauth-pages.spec.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";

/** V2-04 04-02: counts the session clients the proxy builds (each one is a Supabase Auth round trip per request). */
const sessionClients = vi.hoisted(() => ({ count: 0 }));
vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...actual,
    createServerClient: ((...args: Parameters<typeof actual.createServerClient>) => {
      sessionClients.count += 1;
      return actual.createServerClient(...args);
    }) as typeof actual.createServerClient,
  };
});

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

/**
 * V2-04 04-02: pg_cron calls `/api/jobs/run` every minute with a bearer, never a session. The proxy skips the session
 * refresh there (as for `/api/health` and `/api/ready`): no session client is built even when a cookie is present, and
 * the request still gets a fresh request id. Fails without the change (the runner path would build a client and call
 * `getClaims()` on every kick).
 */
describe("proxy: the job runner path skips the session refresh (04-02)", () => {
  const cookie = "sb-127-auth-token=base64-eyJub3QiOiJhIHNlc3Npb24ifQ";

  it.each(["/api/jobs/run", "/api/health", "/api/ready"])("%s: no session client, request id set", async (path) => {
    sessionClients.count = 0;
    for (const method of ["POST", "GET"]) {
      const res = await proxy(new NextRequest(`http://localhost${path}`, { method, headers: { cookie, "x-request-id": "caller-chosen" } }));
      expect(res.status, method).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(sessionClients.count).toBe(0);
  });

  it.each(["/api/jobs/run/x", "/api/jobs", "/api/patients/abc/export"])("%s still runs the session refresh (control)", async (path) => {
    sessionClients.count = 0;
    await proxy(new NextRequest(`http://localhost${path}`, { method: "POST", headers: { cookie } }));
    expect(sessionClients.count).toBe(1);
  });
});

/**
 * V2-03 03-09a (BACKEND H2, T-03-07): `proxy.ts` gives every request a fresh UUID in `x-request-id`, overwriting any
 * inbound value, forwards it to the handler and echoes it on the response, the early returns included. Server code
 * reads it with `getRequestId()`, and the v1 error envelope's `correlation_id` is that id.
 *
 * `NextResponse.next({ request: { headers } })` forwards a header as `x-middleware-request-<name>` on the response the
 * proxy returns; that is how the forwarded value is read here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ssr = vi.hoisted(() => ({ refreshCookie: null as null | { name: string; value: string }, signedIn: true }));
const requestHeaders = vi.hoisted(() => ({ current: null as Headers | null }));

// The session-refresh client is replaced so the page path runs offline; when `refreshCookie` is set, `getClaims()`
// calls `setAll` the way @supabase/ssr does on a refresh (new cookie + no-store headers). `signedIn` decides whether
// claims come back (03-12b: a signed-out page request is redirected to the login page).
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: { name: string; value: string; options: object }[], h: Record<string, string>) => void } }
  ) => ({
    auth: {
      getClaims: async () => {
        if (ssr.refreshCookie) {
          opts.cookies.setAll([{ ...ssr.refreshCookie, options: { path: "/" } }], { "Cache-Control": "private, no-store" });
        }
        // 03-13a (H-AUTH): a password session (`amr` password); a session without a readable `amr` is ended by the proxy.
        const claims = { sub: "00000000-0000-4000-8000-000000000001", amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] };
        return ssr.signedIn ? { data: { claims }, error: null } : { data: null, error: null };
      },
    },
  }),
}));

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return {
    ...actual,
    headers: async () => {
      if (!requestHeaders.current) throw new Error("`headers` was called outside a request scope");
      return requestHeaders.current;
    },
  };
});

import { proxy } from "@/proxy";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/log/request-id";
import { apiError } from "@/lib/api/envelope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORWARDED = `x-middleware-request-${REQUEST_ID_HEADER}`;

function spoofed(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { headers: { [REQUEST_ID_HEADER]: "spoofed" } });
}

beforeEach(() => {
  ssr.refreshCookie = null;
  ssr.signedIn = true;
  requestHeaders.current = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("proxy assigns and forwards x-request-id", () => {
  it.each([
    ["/api/health", 200],
    ["/api/ready", 200],
    ["/dashboard", 200],
  ])("%s: a fresh UUID replaces the spoofed inbound id and is forwarded to the handler", async (path, status) => {
    const res = await proxy(spoofed(path));
    expect(res.status).toBe(status);
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(UUID);
    expect(id).not.toBe("spoofed");
    expect(res.headers.get(FORWARDED)).toBe(id);
    expect(res.headers.get("x-middleware-override-headers")?.split(",")).toContain(REQUEST_ID_HEADER);
  });

  it("a blocked encoded /api path (404) still carries a fresh id", async () => {
    const res = await proxy(spoofed("/api/v%31/x"));
    expect(res.status).toBe(404);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
    expect(res.headers.get(REQUEST_ID_HEADER)).not.toBe("spoofed");
    expect(res.headers.get("x-middleware-next")).toBeNull();
  });

  it("/api/v1 with the switch off (404) still carries a fresh id", async () => {
    vi.stubEnv("API_V1_ENABLED", undefined);
    const res = await proxy(spoofed("/api/v1/x"));
    expect(res.status).toBe(404);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
    expect(res.headers.get(REQUEST_ID_HEADER)).not.toBe("spoofed");
  });

  it("/api/v1 with the switch on: forwarded with a fresh id", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_V1_ENABLED", "true");
    const res = await proxy(spoofed("/api/v1/patients"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(UUID);
    expect(res.headers.get(FORWARDED)).toBe(id);
  });

  it("a session refresh (setAll) keeps the id and forwards the refreshed cookie with it", async () => {
    ssr.refreshCookie = { name: "sb-local-auth-token", value: "synthetic-refreshed" };
    const res = await proxy(spoofed("/patients"));
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(UUID);
    expect(res.headers.get(FORWARDED)).toBe(id);
    expect(res.headers.get("x-middleware-request-cookie")).toContain("sb-local-auth-token=synthetic-refreshed");
    expect(res.cookies.get("sb-local-auth-token")?.value).toBe("synthetic-refreshed");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("03-12b: a signed-out page redirect (307 to /login) carries a fresh id and the cookies setAll wrote", async () => {
    ssr.signedIn = false;
    ssr.refreshCookie = { name: "sb-local-auth-token", value: "" };
    const res = await proxy(spoofed("/patients"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(UUID);
    expect(id).not.toBe("spoofed");
    expect(res.headers.get("x-middleware-next")).toBeNull();
    expect(res.headers.getSetCookie().some((c) => c.startsWith("sb-local-auth-token="))).toBe(true);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("two requests get two different ids", async () => {
    const a = (await proxy(spoofed("/api/health"))).headers.get(REQUEST_ID_HEADER);
    const b = (await proxy(spoofed("/api/health"))).headers.get(REQUEST_ID_HEADER);
    expect(a).not.toBe(b);
  });
});

describe("getRequestId and the v1 envelope", () => {
  const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

  it("returns the forwarded id when it is a UUID, otherwise undefined", async () => {
    requestHeaders.current = new Headers({ [REQUEST_ID_HEADER]: ID });
    expect(await getRequestId()).toBe(ID);
    requestHeaders.current = new Headers({ [REQUEST_ID_HEADER]: "spoofed" });
    expect(await getRequestId()).toBeUndefined();
    requestHeaders.current = new Headers();
    expect(await getRequestId()).toBeUndefined();
    requestHeaders.current = null; // outside a request scope `headers()` throws
    expect(await getRequestId()).toBeUndefined();
  });

  it("the 5xx envelope's correlation_id is the request id", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true); // the 5xx log line (lib/log, 03-09c)
    requestHeaders.current = new Headers({ [REQUEST_ID_HEADER]: ID });
    const res = await apiError("DATABASE_ERROR", "Key (phone)=(+919000000001) already exists", 500);
    const body = await res.json();
    expect(body.error.correlation_id).toBe(ID);
    expect(body.error.message).toBe("An internal database error occurred.");
  });

  it("outside a request scope the envelope still gets a fresh UUID", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true); // the 5xx log line (lib/log, 03-09c)
    const res = await apiError("INTERNAL_ERROR", "boom", 500);
    expect((await res.json()).error.correlation_id).toMatch(UUID);
  });
});

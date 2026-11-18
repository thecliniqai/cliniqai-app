/**
 * PWA D-4 / ruling R-20 (V2-06 06-05): `proxy.ts` marks every signed-in page and RSC response (GET/HEAD outside /api)
 * `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0` (+ `Expires: 0`, `Pragma: no-cache`) itself,
 * instead of relying on Next's default for dynamic pages. Against the local stack with a real synthetic session.
 *
 * Fails without the change: a signed-in page or RSC request passed through the proxy with no cache header at all.
 * Unchanged: `/api` (handlers own their headers), Server Action POSTs, and signed-out public pages.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "@supabase/supabase-js";
import { proxy } from "@/proxy";
import { publicEnv } from "@/lib/env";
import { createUnlinkedUser } from "../helpers/tenants";

const COOKIE = `sb-${new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const NO_STORE = "private, no-cache, no-store, must-revalidate, max-age=0";

let session: Session;

beforeAll(async () => {
  const user = await createUnlinkedUser();
  const { data, error } = await user.client.auth.getSession();
  if (error || !data.session) throw new Error(`no session for the synthetic user: ${error?.message ?? "none"}`);
  session = data.session;
});

function signedIn(path: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers = new Headers(init.headers);
  headers.set("cookie", `${COOKIE}=base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`);
  return new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers });
}

describe("06-05 proxy: signed-in pages and RSC are private/no-store (D-4)", () => {
  it.each([
    ["a page GET", "/patients", {}],
    ["a dynamic page GET", "/patients/0b9f1c1e-2a5d-4c1b-9d7e-1f2a3b4c5d6e", {}],
    ["the root page", "/", {}],
    ["a page HEAD", "/queue", { method: "HEAD" }],
    ["an RSC fetch", "/patients?_rsc=abc12", { headers: { RSC: "1", "Next-Router-State-Tree": "%5B%5D" } }],
    ["an RSC prefetch", "/queue?_rsc=x", { headers: { RSC: "1", "Next-Router-Prefetch": "1" } }],
  ])("%s carries the no-store headers", async (_name, path, init) => {
    const res = await proxy(signedIn(path, init));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
    expect(res.headers.get("expires")).toBe("0");
    expect(res.headers.get("pragma")).toBe("no-cache");
  });

  it("/api requests and Server Action POSTs are left to their handlers", async () => {
    for (const req of [
      signedIn("/api/patients/abc/export"),
      signedIn("/api/visits/abc/prescription-pdf"),
      signedIn("/patients", { method: "POST", headers: { "Next-Action": "abc" } }),
    ]) {
      const res = await proxy(req);
      expect(res.headers.get("cache-control"), req.nextUrl.pathname).toBeNull();
    }
  });

  it("a signed-out request for a public page or PWA asset gets no cache header from the proxy", async () => {
    for (const path of ["/login", "/offline", "/manifest.webmanifest", "/sw.js"]) {
      const res = await proxy(new NextRequest(`http://localhost${path}`));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBeNull();
    }
  });
});

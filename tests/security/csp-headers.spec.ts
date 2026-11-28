/**
 * V2-14 14-01 (P1-18, plan D-4): the page security headers (lib/security/headers.ts) and their use by `proxy.ts`. No
 * database: the requests below carry no session, so the proxy decides without calling Supabase Auth.
 *
 * The browser half (scripts carry the nonce, an injected inline script is blocked, the PR lane runs with zero violations)
 * is tests/e2e/security/csp.spec.ts and the violation check in tests/e2e/fixtures.ts.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { contentSecurityPolicy, isPagePath, newNonce, pageSecurityHeaders } from "@/lib/security/headers";

const SUPABASE = "https://abcdefgh.supabase.co";

function directive(policy: string, name: string): string[] | undefined {
  const found = policy
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name);
  return found?.slice(1);
}

describe("contentSecurityPolicy", () => {
  const policy = contentSecurityPolicy({ nonce: "bm9uY2U=", pathname: "/today", supabaseUrl: SUPABASE });

  it("scripts: the nonce and strict-dynamic, never unsafe-inline or unsafe-eval in a build", () => {
    expect(directive(policy, "script-src")).toEqual(["'self'", "'nonce-bm9uY2U='", "'strict-dynamic'"]);
    expect(policy).not.toContain("unsafe-eval");
    expect(directive(policy, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("only next dev adds unsafe-eval", () => {
    const dev = contentSecurityPolicy({ nonce: "x", pathname: "/today", supabaseUrl: SUPABASE, dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("locks down plugins, base, framing, workers and the manifest", () => {
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'none'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(policy, "form-action")).toEqual(["'self'"]);
    expect(directive(policy, "worker-src")).toEqual(["'self'"]);
    expect(directive(policy, "manifest-src")).toEqual(["'self'"]);
    expect(directive(policy, "default-src")).toEqual(["'self'"]);
  });

  it("allows the Supabase origin over https and Realtime over wss, and Turnstile frames", () => {
    expect(directive(policy, "connect-src")).toEqual(["'self'", SUPABASE, "wss://abcdefgh.supabase.co"]);
    expect(directive(policy, "img-src")).toContain(SUPABASE);
    expect(directive(policy, "frame-src")).toEqual(expect.arrayContaining([SUPABASE, "https://challenges.cloudflare.com"]));
  });

  it("the loopback stack maps to http and ws", () => {
    const local = contentSecurityPolicy({ nonce: "x", pathname: "/login", supabaseUrl: "http://127.0.0.1:54321" });
    expect(directive(local, "connect-src")).toEqual(["'self'", "http://127.0.0.1:54321", "ws://127.0.0.1:54321"]);
  });

  it("an unusable Supabase URL adds no source (fails closed)", () => {
    for (const bad of ["", "not a url", "javascript:alert(1)", "ftp://x.example.test"]) {
      const p = contentSecurityPolicy({ nonce: "x", pathname: "/today", supabaseUrl: bad });
      expect(directive(p, "connect-src")).toEqual(["'self'"]);
    }
  });

  it("Razorpay only on the billing pages", () => {
    expect(policy).not.toContain("razorpay");
    for (const path of ["/onboarding/billing", "/settings/billing", "/billing/locked", "/billing/locked/staff"]) {
      const p = contentSecurityPolicy({ nonce: "x", pathname: path, supabaseUrl: SUPABASE });
      expect(directive(p, "connect-src"), path).toEqual(expect.arrayContaining(["https://api.razorpay.com", "https://lumberjack.razorpay.com"]));
      expect(directive(p, "frame-src"), path).toContain("https://api.razorpay.com");
    }
    const lookalike = contentSecurityPolicy({ nonce: "x", pathname: "/settings/billing-export", supabaseUrl: SUPABASE });
    expect(lookalike).not.toContain("razorpay");
  });
});

describe("pageSecurityHeaders", () => {
  const base = { nonce: "x", supabaseUrl: SUPABASE };

  it("default page: strict-origin referrer, same-origin COOP, no camera, DENY framing, no extra cache header", () => {
    const h = pageSecurityHeaders({ ...base, pathname: "/today" });
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    expect(h["permissions-policy"]).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["cache-control"]).toBeUndefined();
  });

  it("token, patient and onboarding pages send no referrer; token pages are never stored", () => {
    for (const path of ["/r/abc", "/reschedule/abc", "/join", "/reports/view"]) {
      const h = pageSecurityHeaders({ ...base, pathname: path });
      expect(h["referrer-policy"], path).toBe("no-referrer");
      expect(h["cache-control"], path).toContain("no-store");
    }
    for (const path of ["/patients", "/patients/1", "/consultation/1", "/visits", "/onboarding/billing", "/clinic/new"]) {
      expect(pageSecurityHeaders({ ...base, pathname: path })["referrer-policy"], path).toBe("no-referrer");
    }
    expect(pageSecurityHeaders({ ...base, pathname: "/joined-later" })["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("the camera only on the report-upload pages; payment and popups only on billing pages", () => {
    expect(pageSecurityHeaders({ ...base, pathname: "/consultation/1" })["permissions-policy"]).toContain("camera=(self)");
    expect(pageSecurityHeaders({ ...base, pathname: "/patients/1" })["permissions-policy"]).toContain("camera=(self)");
    expect(pageSecurityHeaders({ ...base, pathname: "/patients" })["permissions-policy"]).toContain("camera=()");
    const billing = pageSecurityHeaders({ ...base, pathname: "/settings/billing" });
    expect(billing["permissions-policy"]).toContain('payment=(self "https://api.razorpay.com")');
    expect(billing["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  });

  it("isPagePath: /api and the worker script are not pages; their case variants are (Next serves them as HTML pages)", () => {
    expect(isPagePath("/api/health")).toBe(false);
    expect(isPagePath("/sw.js")).toBe(false);
    expect(isPagePath("/API/v1/x")).toBe(true);
    expect(isPagePath("/SW.JS")).toBe(true);
    expect(isPagePath("/apix")).toBe(true);
    expect(isPagePath("/login")).toBe(true);
  });

  it("newNonce: 128 random bits, base64, different every call", () => {
    const seen = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(seen.size).toBe(50);
    for (const n of seen) expect(Buffer.from(n, "base64")).toHaveLength(16);
  });
});

describe("proxy.ts applies the headers", () => {
  const forged = "Zm9yZ2Vk";

  it("a page response and its forwarded request carry the same fresh policy; a forged inbound policy or nonce is dropped", async () => {
    const request = new NextRequest("http://127.0.0.1:3000/login", {
      headers: { "content-security-policy": `script-src 'nonce-${forged}'`, "x-nonce": forged },
    });
    const response = await proxy(request);
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain(forged);
    // NextResponse.next({ request: { headers } }) forwards the request headers as x-middleware-request-*.
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");

    const again = await proxy(new NextRequest("http://127.0.0.1:3000/login"));
    expect(again.headers.get("content-security-policy")).not.toBe(policy);
  });

  it("the sign-in redirect of a protected page carries the policy too", async () => {
    const response = await proxy(new NextRequest("http://127.0.0.1:3000/today"));
    expect(response.status).toBe(307);
    expect(response.headers.get("content-security-policy")).toContain("'strict-dynamic'");
  });

  it("route handlers and the worker script get no page policy, and a forged policy never reaches them", async () => {
    for (const path of ["/api/health", "/sw.js"]) {
      const response = await proxy(
        new NextRequest(`http://127.0.0.1:3000${path}`, { headers: { "content-security-policy": `script-src 'nonce-${forged}'` } }),
      );
      expect(response.headers.get("content-security-policy"), path).toBeNull();
      expect(response.headers.get("x-middleware-request-content-security-policy"), path).toBeNull();
    }
  });
});

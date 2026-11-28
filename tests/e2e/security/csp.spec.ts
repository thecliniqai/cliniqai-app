/**
 * V2-14 14-01 (P1-18, plan D-4): the nonce Content-Security-Policy and the security headers on the built app (`next start`
 * on the loopback e2e server). Every other PR-lane test also runs under the policy: tests/e2e/fixtures.ts fails any test
 * whose pages reported a CSP violation.
 *
 * Fails-without: with `'unsafe-inline'` (and no nonce) in `script-src`, the injected inline script and the inline event
 * handler below run and set their markers, and no violation is reported.
 */
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";

const SIGNED_OUT = { cookies: [], origins: [] };

function directive(policy: string, name: string): string[] {
  const found = policy
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name);
  return found ? found.slice(1) : [];
}

function nonceOf(policy: string): string {
  const match = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy);
  expect(match, "script-src carries a nonce").not.toBeNull();
  return match![1];
}

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("a page gets a fresh nonce per response, on every one of its scripts, and a strict script-src", async ({ request }) => {
    const first = await request.get("/login");
    const second = await request.get("/login");
    expect(first.status()).toBe(200);
    const policy = first.headers()["content-security-policy"];
    expect(policy).toBeTruthy();
    const scriptSrc = directive(policy, "script-src");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'none'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(policy, "worker-src")).toEqual(["'self'"]);
    expect(directive(policy, "manifest-src")).toEqual(["'self'"]);
    // The loopback stack's REST/Auth and Realtime origins (a hosted deployment: https and wss).
    expect(directive(policy, "connect-src")).toEqual(expect.arrayContaining(["'self'", "http://127.0.0.1:54321", "ws://127.0.0.1:54321"]));

    const nonce = nonceOf(policy);
    expect(nonceOf(second.headers()["content-security-policy"])).not.toBe(nonce);

    const html = await first.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag, "every server-rendered script carries the response's nonce").toContain(`nonce="${nonce}"`);
  });

  test("a caller cannot choose the nonce", async ({ request }) => {
    const forged = "Zm9yZ2VkLW5vbmNlLTEyMzQ1";
    const res = await request.get("/login", {
      headers: { "content-security-policy": `script-src 'nonce-${forged}'`, "x-nonce": forged },
    });
    expect(nonceOf(res.headers()["content-security-policy"])).not.toBe(forged);
    expect(await res.text()).not.toContain(forged);
  });

  test("an injected inline script and inline event handler are blocked and reported", async ({ page, cspViolations }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.__e2eInlineRan = true;";
      document.head.appendChild(script);
      const holder = document.createElement("div");
      holder.innerHTML = '<button type="button" id="e2e-forged" onclick="window.__e2eHandlerRan = true">x</button>';
      document.body.appendChild(holder);
      document.getElementById("e2e-forged")?.click();
    });
    await expect.poll(() => cspViolations.length).toBeGreaterThanOrEqual(2);
    const ran = await page.evaluate(() => {
      const w = window as unknown as { __e2eInlineRan?: boolean; __e2eHandlerRan?: boolean };
      return { inline: w.__e2eInlineRan === true, handler: w.__e2eHandlerRan === true };
    });
    expect(ran).toEqual({ inline: false, handler: false });
    expect(cspViolations.every((v) => v.startsWith("script-src"))).toBe(true);
    // Provoked on purpose and asserted: cleared so the fixture's zero-violation check covers the rest of the test only.
    cspViolations.length = 0;
  });

  test("security headers on pages, token pages, /api and static assets", async ({ request }) => {
    const login = await request.get("/login");
    const headers = login.headers();
    expect(headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["permissions-policy"]).toContain("microphone=()");

    // A share-token page: no referrer at all and never stored, whatever the token.
    const share = await request.get("/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(share.headers()["referrer-policy"]).toBe("no-referrer");
    expect(share.headers()["cache-control"]).toContain("no-store");
    expect(share.headers()["content-security-policy"]).toContain("'strict-dynamic'");

    // Route handlers keep their own headers: no page CSP, the static ones from next.config.ts.
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(health.headers()["content-security-policy"]).toBeUndefined();
    expect(health.headers()["x-content-type-options"]).toBe("nosniff");

    // A case variant of the worker script is never the worker: a page answer (the sign-in redirect while signed out)
    // under the page policy.
    const upper = await request.get("/SW.JS", { maxRedirects: 0 });
    expect(upper.status()).not.toBe(200);
    expect(upper.headers()["content-type"] ?? "").not.toContain("javascript");
    expect(upper.headers()["content-security-policy"]).toContain("'strict-dynamic'");
  });
});

test.describe("signed in", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("the clinic pages carry the policy; patient pages send no referrer and allow the camera for the report upload", async ({ page }) => {
    const today = await page.goto("/today");
    expect(today?.status()).toBe(200);
    expect(today?.headers()["content-security-policy"]).toContain("'strict-dynamic'");
    expect(today?.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");

    const patients = await page.request.get("/patients");
    expect(patients.headers()["referrer-policy"]).toBe("no-referrer");
    expect(patients.headers()["permissions-policy"]).toContain("camera=()");
  });
});

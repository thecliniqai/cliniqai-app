/**
 * The e2e `test` (V2-02 plan 02-03a). Every spec imports `test`/`expect` from here, never from @playwright/test.
 *
 * Browser network block: per browser context, every HTTP(S) request and WebSocket may reach only loopback
 * (127.0.0.1 / localhost / ::1) or a `data:`/`blob:` URL; anything else is aborted and its host recorded. After the
 * test body, the fixture FAILS the test if anything was blocked, naming the hosts — so an external call can neither
 * leave the machine nor pass silently. Service workers are blocked in the config (`serviceWorkers: "block"`).
 *
 * Turnstile (V2-03 03-12c, R-22): the one exception to "abort" is Cloudflare's widget script,
 * `https://challenges.cloudflare.com/turnstile/v0/api.js`, which is FULFILLED from `support/turnstile-stub.js` (no
 * request leaves the machine; the stub behaves as Cloudflare's documented test site keys do). Every other Cloudflare
 * URL is still aborted and fails the test. Contexts made outside this fixture use {@link routeLoopbackOnly}.
 *
 * `consoleErrors` collects `console.error` messages and uncaught page errors for specs that assert a clean console.
 *
 * `ux` (V2-02 plan 02-03b) counts a characterisation flow's user actions and keystrokes (support/ux-counter.ts); after
 * a passing test on the desktop-chrome project it writes the flow's counts for the M0 baseline report.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test as base, expect, type BrowserContext } from "@playwright/test";
import { COUNTS_PROJECT, UxCounter } from "./support/ux-counter";

const { isLoopbackHost } = createRequire(__filename)("../setup/loopback.cjs") as {
  isLoopbackHost: (host: unknown) => boolean;
};

/** True when the browser may load `url`: loopback HTTP(S)/WS, or an in-page `data:`/`blob:` URL. */
export function isAllowedBrowserUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;
  return isLoopbackHost(parsed.hostname);
}

/** Cloudflare's Turnstile script, as @marsidev/react-turnstile requests it (any query string). */
export const TURNSTILE_SCRIPT_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_SCRIPT_PATH = "/turnstile/v0/api.js";
const TURNSTILE_STUB_FILE = path.join(__dirname, "support/turnstile-stub.js");

/** True only for the Turnstile script URL (exact origin and path); the stub answers it locally. */
export function isTurnstileScriptUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === TURNSTILE_SCRIPT_ORIGIN && parsed.pathname === TURNSTILE_SCRIPT_PATH;
  } catch {
    return false;
  }
}

let stubBody: string | undefined;
function turnstileStubBody(): string {
  stubBody ??= fs.readFileSync(TURNSTILE_STUB_FILE, "utf8");
  return stubBody;
}

/**
 * The loopback-only network block on `context`: loopback and `data:`/`blob:` continue, the Turnstile script is
 * fulfilled from the local stub, everything else is aborted and its host pushed to `blocked`.
 */
export async function routeLoopbackOnly(context: BrowserContext, blocked: string[]): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isAllowedBrowserUrl(url)) return route.continue();
    if (isTurnstileScriptUrl(url)) {
      return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: turnstileStubBody() });
    }
    blocked.push(hostOf(url));
    return route.abort("blockedbyclient");
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

interface E2eFixtures {
  /** Hosts the network block refused during this test. */
  blockedHosts: string[];
  /** `console.error` messages and uncaught page errors seen during this test. */
  consoleErrors: string[];
  /** Counts the user actions of an M0 characterisation flow. */
  ux: UxCounter;
}

export const test = base.extend<E2eFixtures>({
  // (`provide` is Playwright's `use` callback, renamed so the React hooks lint rule does not mistake it for a hook.)
  blockedHosts: async ({}, provide) => {
    await provide([]);
  },

  context: async ({ context, blockedHosts }, provide) => {
    await routeLoopbackOnly(context, blockedHosts);
    await context.routeWebSocket(/.*/, (ws) => {
      if (isAllowedBrowserUrl(ws.url())) {
        ws.connectToServer();
        return;
      }
      blockedHosts.push(hostOf(ws.url()));
      void ws.close({ code: 1008, reason: "blocked by the e2e network block" });
    });
    await provide(context);
    expect(
      [...new Set(blockedHosts)],
      "the page tried to reach non-loopback hosts (V2-02: the e2e browser never leaves 127.0.0.1)",
    ).toEqual([]);
  },

  consoleErrors: async ({ page }, provide) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    await provide(errors);
  },

  ux: async ({}, provide, testInfo) => {
    const ux = new UxCounter();
    await provide(ux);
    // Only a clean pass of the expected-to-pass flow on the M0 source-of-truth project is a baseline measurement.
    if (
      testInfo.project.name === COUNTS_PROJECT &&
      testInfo.expectedStatus === "passed" &&
      testInfo.status === "passed" &&
      testInfo.retry === 0
    ) {
      ux.write();
    }
  },
});

export { expect };

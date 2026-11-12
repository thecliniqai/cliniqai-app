/**
 * The e2e `test` (V2-02 plan 02-03a). Every spec imports `test`/`expect` from here, never from @playwright/test.
 *
 * Browser network block: per browser context, every HTTP(S) request and WebSocket may reach only loopback
 * (127.0.0.1 / localhost / ::1) or a `data:`/`blob:` URL; anything else is aborted and its host recorded. After the
 * test body, the fixture FAILS the test if anything was blocked, naming the hosts — so an external call can neither
 * leave the machine nor pass silently. Service workers are blocked in the config (`serviceWorkers: "block"`).
 *
 * `consoleErrors` collects `console.error` messages and uncaught page errors for specs that assert a clean console.
 */
import { createRequire } from "node:module";
import { test as base, expect } from "@playwright/test";

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
}

export const test = base.extend<E2eFixtures>({
  // (`provide` is Playwright's `use` callback, renamed so the React hooks lint rule does not mistake it for a hook.)
  blockedHosts: async ({}, provide) => {
    await provide([]);
  },

  context: async ({ context, blockedHosts }, provide) => {
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (isAllowedBrowserUrl(url)) return route.continue();
      blockedHosts.push(hostOf(url));
      return route.abort("blockedbyclient");
    });
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
});

export { expect };

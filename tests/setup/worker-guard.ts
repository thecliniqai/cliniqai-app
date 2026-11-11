/**
 * Runs in every Vitest worker before its test file is imported (V2-01a).
 *
 * 1. Re-checks the environment guard now, and again in `beforeAll`, i.e. after the test file and everything it
 *    imports have loaded — so a module that loads env files at import time cannot smuggle hosted config in.
 * 2. Refuses any `fetch` to a non-loopback host. Specs that stub `fetch` replace this wrapper and are unaffected;
 *    anything that would otherwise leave the machine (a provider built by name, an un-awaited webhook send)
 *    fails instead of reaching the internet.
 */
import { beforeAll } from "vitest";
import { assertLocalTestEnv } from "./test-env";

assertLocalTestEnv();

beforeAll(() => {
  assertLocalTestEnv();
});

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export class NonLocalNetworkError extends Error {
  constructor(host: string) {
    super(`Test lane blocked a network request to non-local host "${host}" (V2-01a: tests never leave 127.0.0.1)`);
    this.name = "NonLocalNetworkError";
  }
}

function requestHost(input: Parameters<typeof fetch>[0]): string | null {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const realFetch = globalThis.fetch;
if (realFetch && !(realFetch as { __localOnly?: boolean }).__localOnly) {
  const localOnlyFetch: typeof fetch = (input, init) => {
    const host = requestHost(input);
    if (host !== null && !LOOPBACK.has(host)) {
      return Promise.reject(new NonLocalNetworkError(host));
    }
    return realFetch(input, init);
  };
  (localOnlyFetch as { __localOnly?: boolean }).__localOnly = true;
  globalThis.fetch = localOnlyFetch;
}

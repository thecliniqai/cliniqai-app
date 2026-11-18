/**
 * Runs in every Vitest worker before its test file is imported (V2-01a).
 *
 * 1. Re-checks the environment guard now, and again in `beforeAll`, i.e. after the test file and everything it
 *    imports have loaded — so a module that loads env files at import time cannot smuggle hosted config in.
 * 2. `process.loadEnvFile` refuses any `.env*` file other than `.env.test` in workers.
 * 3. Network stays on this machine:
 *    - every TCP/TLS socket (fetch/undici, node:http/https, AWS SDK, websockets) may connect only to loopback;
 *    - `fetch` to a non-loopback host is rejected up front with a readable error;
 *    - DNS lookups of non-loopback names never reach a resolver: they return a fixed public test address
 *      (TEST_PUBLIC_ADDRESS), so code that validates hostnames (e.g. the webhook SSRF check) behaves
 *      deterministically offline, and any attempt to then connect is refused by the socket block.
 *    - (02-06, AR-L5) the c-ares resolver (`dns.resolve*`, `dns.Resolver`, `dns.promises`) and `dgram` refuse
 *      non-loopback names and addresses without sending a query (tests/setup/dns-udp-guard.cjs).
 *    Specs that stub `fetch` or `dns` themselves replace these wrappers and are unaffected.
 */
import dns from "node:dns";
import net from "node:net";
import path from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { beforeAll } from "vitest";
import { assertLocalTestEnv } from "./test-env";

assertLocalTestEnv();

beforeAll(() => {
  assertLocalTestEnv();
});

// Shared with the e2e server guard (tests/e2e/support/server-net-guard.cjs), loaded with Node's own require.
const loopback = createRequire(__filename)("./loopback.cjs") as { isLoopbackHost: (host: unknown) => boolean };

/** Fixed public address (documentation-adjacent, never contacted: sockets to it are refused). */
export const TEST_PUBLIC_ADDRESS = "93.184.216.34";

export class NonLocalNetworkError extends Error {
  constructor(host: string) {
    super(`Test lane blocked a network request to non-local host "${host}" (V2-01a: tests never leave 127.0.0.1)`);
    this.name = "NonLocalNetworkError";
  }
}

export function isLoopbackHost(host: string | undefined | null): boolean {
  return loopback.isLoopbackHost(host);
}

// --- 2. env files ---------------------------------------------------------------------------------------------
const realLoadEnvFile = process.loadEnvFile?.bind(process);
if (realLoadEnvFile) {
  process.loadEnvFile = (file?: string | URL) => {
    const name = path.basename(String(file ?? ".env"));
    if (name.startsWith(".env") && name !== ".env.test") {
      throw new Error(`Test lane refused to load ${name} (V2-01a: tests never read .env files other than .env.test)`);
    }
    return realLoadEnvFile(file as string);
  };
}

// --- 3a. sockets ----------------------------------------------------------------------------------------------
type ConnectArgs = Parameters<net.Socket["connect"]>;
const realConnect = net.Socket.prototype.connect as (...args: unknown[]) => net.Socket;
function connectTarget(args: unknown[]): { host?: string; path?: string } {
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (first && typeof first === "object") {
    const o = first as { host?: string; path?: string };
    return { host: o.path ? undefined : (o.host ?? "localhost"), path: o.path };
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return { path: first };
  return { host: typeof args[1] === "string" ? args[1] : "localhost" };
}
/** Hosts an MSW spec mocks (see `mswFetch`): a connect to one of them dials 127.0.0.1 instead, never the host. */
const mockedHosts = new Set<string>();
function toLoopback(args: unknown[]): unknown[] {
  const swap = (o: unknown) => (o && typeof o === "object" ? { ...(o as object), host: "127.0.0.1" } : o);
  if (Array.isArray(args[0])) return [[swap((args[0] as unknown[])[0]), ...(args[0] as unknown[]).slice(1)], ...args.slice(1)];
  if (args[0] && typeof args[0] === "object") return [swap(args[0]), ...args.slice(1)];
  return typeof args[1] === "string" ? [args[0], "127.0.0.1", ...args.slice(2)] : args;
}
net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: ConnectArgs) {
  const target = connectTarget(args);
  if (!target.path && target.host && mockedHosts.has(target.host)) {
    return realConnect.apply(this, toLoopback(args as unknown[]));
  }
  if (!target.path && !isLoopbackHost(target.host)) {
    const err = new NonLocalNetworkError(String(target.host));
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return realConnect.apply(this, args as unknown[]);
} as net.Socket["connect"];

// --- 3b. DNS --------------------------------------------------------------------------------------------------
type LookupAll = { address: string; family: number }[];
const realPromiseLookup = dns.promises.lookup.bind(dns.promises);
const fakeAnswer = (all: boolean | undefined): LookupAll | { address: string; family: number } =>
  all ? [{ address: TEST_PUBLIC_ADDRESS, family: 4 }] : { address: TEST_PUBLIC_ADDRESS, family: 4 };

dns.promises.lookup = (async (hostname: string, options?: unknown) => {
  if (isLoopbackHost(hostname) || net.isIP(hostname)) return realPromiseLookup(hostname, options as never);
  const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
  return fakeAnswer(all);
}) as typeof dns.promises.lookup;

const realLookup = dns.lookup.bind(dns);
dns.lookup = ((hostname: string, options: unknown, callback?: unknown) => {
  const cb = (typeof options === "function" ? options : callback) as (...a: unknown[]) => void;
  const opts = typeof options === "function" ? undefined : options;
  if (isLoopbackHost(hostname) || net.isIP(hostname)) {
    return (realLookup as (...a: unknown[]) => void)(hostname, opts ?? {}, cb);
  }
  const all = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all;
  process.nextTick(() =>
    all ? cb(null, fakeAnswer(true)) : cb(null, TEST_PUBLIC_ADDRESS, 4),
  );
}) as typeof dns.lookup;
syncBuiltinESMExports();

// --- 3b'. resolver and UDP (shared with the e2e server guard) ------------------------------------------------------
(createRequire(__filename)("./dns-udp-guard.cjs") as { installDnsUdpGuard: (label: string) => void }).installDnsUdpGuard(
  "Test lane",
);

// --- 3c. fetch (readable error before any socket work) --------------------------------------------------------
function requestHost(input: Parameters<typeof fetch>[0]): string | null {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const REAL_FETCH = Symbol.for("clinicos.test.realFetch");
const realFetch = globalThis.fetch;
if (realFetch && !(realFetch as { __localOnly?: boolean }).__localOnly) {
  const localOnlyFetch: typeof fetch = (input, init) => {
    const host = requestHost(input);
    if (!isLoopbackHost(host)) return Promise.reject(new NonLocalNetworkError(String(host)));
    return realFetch(input, init);
  };
  (localOnlyFetch as { __localOnly?: boolean }).__localOnly = true;
  // V2-04 04-03a: MSW 3 intercepts below `fetch` (at the socket), so a spec that mocks an external API with MSW installs
  // `mswFetch` (below) for the hosts it mocks. The socket and DNS guards above stay in force for everything.
  Object.defineProperty(localOnlyFetch, REAL_FETCH, { value: realFetch, enumerable: false });
  globalThis.fetch = localOnlyFetch;
}

/**
 * For MSW specs (V2-04 04-03a, MSG91 contract). MSW 3 answers mocked requests at the socket, below `fetch`, so for
 * exactly `hosts`: `fetch` passes the request down to Node's fetch, and the socket guard rewrites a connect to one of
 * these hosts to dial 127.0.0.1 instead (MSW's own mock connection does the same). Whatever MSW does with the
 * request, no socket ever dials the real host; every other non-loopback host is still refused. Undo with `restore()`.
 */
export function mswFetch(hosts: string[]): { restore: () => void } {
  const guarded = globalThis.fetch;
  const real = (guarded as unknown as Record<symbol, typeof fetch>)[REAL_FETCH];
  if (!real) throw new Error("mswFetch: the worker fetch guard is not installed");
  for (const host of hosts) mockedHosts.add(host);
  globalThis.fetch = ((input, init) => {
    const host = requestHost(input);
    if (host !== null && hosts.includes(host)) return real(input, init);
    return guarded(input, init);
  }) as typeof fetch;
  return {
    restore: () => {
      for (const host of hosts) mockedHosts.delete(host);
      globalThis.fetch = guarded;
    },
  };
}

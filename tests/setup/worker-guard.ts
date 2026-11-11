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
 *    Specs that stub `fetch` or `dns` themselves replace these wrappers and are unaffected.
 */
import dns from "node:dns";
import net from "node:net";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { beforeAll } from "vitest";
import { assertLocalTestEnv } from "./test-env";

assertLocalTestEnv();

beforeAll(() => {
  assertLocalTestEnv();
});

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** Fixed public address (documentation-adjacent, never contacted: sockets to it are refused). */
export const TEST_PUBLIC_ADDRESS = "93.184.216.34";

export class NonLocalNetworkError extends Error {
  constructor(host: string) {
    super(`Test lane blocked a network request to non-local host "${host}" (V2-01a: tests never leave 127.0.0.1)`);
    this.name = "NonLocalNetworkError";
  }
}

export function isLoopbackHost(host: string | undefined | null): boolean {
  if (!host) return false;
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_NAMES.has(h) || h === "localhost.") return true;
  if (net.isIPv4(h)) return h.startsWith("127.");
  if (net.isIPv6(h)) return h === "::1" || /^::ffff:127\./.test(h);
  return false;
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
net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: ConnectArgs) {
  const target = connectTarget(args);
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

// --- 3c. fetch (readable error before any socket work) --------------------------------------------------------
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
    if (!isLoopbackHost(host)) return Promise.reject(new NonLocalNetworkError(String(host)));
    return realFetch(input, init);
  };
  (localOnlyFetch as { __localOnly?: boolean }).__localOnly = true;
  globalThis.fetch = localOnlyFetch;
}

/**
 * V2-09d (request speed): counts the Supabase API calls a stretch of an e2e test caused, from the local stack's Kong
 * access log (`docker logs supabase_kong_<project_id>`, the project id read from `supabase/config.toml`, as the Supabase
 * CLI names the container). Every call the app server, the browser or the runner makes to Supabase passes through Kong,
 * so its log is the one place that sees them all.
 *
 * 09D-01a (A-5): only Kong's stdout (its access log) is read. Its stderr is the error log: concatenated after stdout, a
 * marker path quoted in an error line would land after the access lines and break the window's order. A failed
 * `docker logs` (a transient daemon error) is retried like a late marker.
 *
 * A window is delimited by two marker requests the runner sends to Kong itself (`GET /__clinicos_perf_mark/<id>`,
 * answered 404 by Kong and logged like any other request), so the count never depends on the clocks of the host and
 * the Docker VM. Each logged request is attributed to the browser (a `Mozilla/…` user agent) or to a server (any other
 * agent: the Next server's supabase-js, or the runner); a measured stretch must keep the runner idle, so "server" is
 * the app server. Paths are reported without their query string (ids and filters never reach the report).
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LOCAL_SUPABASE_URL } from "./app-env";

/** `supabase_kong_<project_id>`: the Supabase CLI's container name for this project's Kong. */
export function kongContainerName(configToml: string = readFileSync(path.resolve(__dirname, "../../../supabase/config.toml"), "utf8")): string {
  const id = /^\s*project_id\s*=\s*"([A-Za-z0-9_.-]+)"/m.exec(configToml)?.[1];
  if (!id) throw new Error("kong-calls: no project_id in supabase/config.toml");
  return `supabase_kong_${id}`;
}

const KONG_CONTAINER = kongContainerName();
const MARK_PATH = "/__clinicos_perf_mark/";
/** `"<METHOD> <path> HTTP/x" <status> <bytes> "<referer>" "<user agent>"` of the combined log format. */
const ACCESS_LINE = /"([A-Z]+) (\S+) HTTP\/[\d.]+" (\d{3}) \S+ "[^"]*" "([^"]*)"/;

export interface KongCall {
  method: string;
  path: string;
  status: number;
  from: "browser" | "server";
}

export interface KongWindow {
  calls: KongCall[];
  server: number;
  browser: number;
  /** `METHOD path` → count, server calls only. */
  serverByPath: Record<string, number>;
  browserByPath: Record<string, number>;
}

/**
 * Sends one marker. Kong answers 404 (no route); the request is logged, which is all a marker needs. A marker that never
 * reached Kong would make the window unreadable, so a failed or stalled send (a keep-alive socket Kong had already closed)
 * is bounded, retried and, if it keeps failing, reported instead of swallowed.
 */
export async function mark(id: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Bounded: a stalled keep-alive socket otherwise holds the request for undici's 300 s header timeout (seen once:
      // a 4.4 min test that then found no end marker).
      const res = await fetch(`${LOCAL_SUPABASE_URL}${MARK_PATH}${id}`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      await res.arrayBuffer();
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`kong-calls: marker request failed (${lastError instanceof Error ? lastError.name : "unknown"})`);
}

/** Kong's access log since `sinceIso`, from its stdout only (see the header); throws when `docker logs` fails. */
export function readKongLog(sinceIso: string): string {
  const r = spawnSync("docker", ["logs", "--since", sinceIso, KONG_CONTAINER], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`docker logs ${KONG_CONTAINER} exited ${r.status} (is the local stack up and docker reachable?)`);
  return r.stdout ?? "";
}

/** Normalises a request path for the report: no query string; uuids, numbers and long tokens collapsed. */
export function reportPath(rawPath: string): string {
  const path = rawPath.split("?")[0];
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:n");
}

export function parseWindow(log: string, startId: string, endId: string): KongWindow {
  const lines = log.split("\n");
  // The first of each marker (a marker re-sent after a stalled socket can be logged twice; nothing of the body runs
  // between the copies of the start marker, and the first end marker closes the window). The trailing space ends the id.
  const start = lines.findIndex((l) => l.includes(`${MARK_PATH}${startId} `));
  const end = lines.findIndex((l) => l.includes(`${MARK_PATH}${endId} `));
  if (start < 0 || end < 0 || end < start) throw new Error("kong-calls: window markers not found in the Kong log");
  const calls: KongCall[] = [];
  for (const line of lines.slice(start + 1, end)) {
    const m = ACCESS_LINE.exec(line);
    if (!m || m[2].startsWith(MARK_PATH)) continue;
    calls.push({ method: m[1], path: reportPath(m[2]), status: Number(m[3]), from: m[4].startsWith("Mozilla/") ? "browser" : "server" });
  }
  const tally = (from: KongCall["from"]) =>
    calls.filter((c) => c.from === from).reduce<Record<string, number>>((acc, c) => {
      const key = `${c.method} ${c.path}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  return {
    calls,
    server: calls.filter((c) => c.from === "server").length,
    browser: calls.filter((c) => c.from === "browser").length,
    serverByPath: tally("server"),
    browserByPath: tally("browser"),
  };
}

/**
 * Runs `body` between two Kong markers and returns the Supabase calls logged in between. `settleMs` waits after the
 * body so calls the page makes right after it (a status poll on load) are counted, then lets Kong flush its log.
 */
export async function countKongCalls(body: () => Promise<void>, settleMs = 750): Promise<KongWindow> {
  const sinceIso = new Date(Date.now() - 60_000).toISOString();
  const id = randomUUID();
  await mark(`${id}-start`);
  await body();
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  await mark(`${id}-end`);
  // The access log reaches `docker logs` asynchronously; read until the end marker is there (bounded, 10 s). A failed read
  // is retried within the same bound and reported if it never succeeds.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const log = readKongLog(sinceIso);
      if (log.includes(`${MARK_PATH}${id}-end `)) return parseWindow(log, `${id}-start`, `${id}-end`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    lastError instanceof Error ? `kong-calls: reading the Kong log failed: ${lastError.message}` : "kong-calls: end marker never reached the Kong log",
  );
}

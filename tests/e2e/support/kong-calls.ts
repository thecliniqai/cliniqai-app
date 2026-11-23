/**
 * V2-09d (request speed): counts the Supabase API calls a stretch of an e2e test caused, from the local stack's Kong
 * access log (`docker logs supabase_kong_clinicos`). Every call the app server, the browser or the runner makes to
 * Supabase passes through Kong, so its log is the one place that sees them all.
 *
 * A window is delimited by two marker requests the runner sends to Kong itself (`GET /__clinicos_perf_mark/<id>`,
 * answered 404 by Kong and logged like any other request), so the count never depends on the clocks of the host and
 * the Docker VM. Each logged request is attributed to the browser (a `Mozilla/…` user agent) or to a server (any other
 * agent: the Next server's supabase-js, or the runner); a measured stretch must keep the runner idle, so "server" is
 * the app server. Paths are reported without their query string (ids and filters never reach the report).
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { LOCAL_SUPABASE_URL } from "./app-env";

const KONG_CONTAINER = "supabase_kong_clinicos";
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

async function mark(id: string): Promise<void> {
  // Kong answers 404 (no route); the request is logged, which is all a marker needs.
  await fetch(`${LOCAL_SUPABASE_URL}${MARK_PATH}${id}`).then((r) => r.arrayBuffer()).catch(() => undefined);
}

function readKongLog(sinceIso: string): string {
  const r = spawnSync("docker", ["logs", "--since", sinceIso, KONG_CONTAINER], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`docker logs ${KONG_CONTAINER} exited ${r.status}`);
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
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
  const start = lines.findIndex((l) => l.includes(`${MARK_PATH}${startId}`));
  const end = lines.findIndex((l) => l.includes(`${MARK_PATH}${endId}`));
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
  // Kong writes its access log asynchronously; read until the end marker is there (bounded).
  for (let attempt = 0; attempt < 20; attempt++) {
    const log = readKongLog(sinceIso);
    if (log.includes(`${MARK_PATH}${id}-end`)) return parseWindow(log, `${id}-start`, `${id}-end`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("kong-calls: end marker never reached the Kong log");
}

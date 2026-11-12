import { isDeployTier } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";

/**
 * PO-16 / V2-01 D8: the public REST API (`/api/v1/**`) is off unless `API_V1_ENABLED` is exactly `"true"`, and it is
 * never on in a production build or a deployed tier until P1-37 (the env schema in `lib/env.ts` refuses both at
 * boot). Enforced in two layers (AR2-H2): the proxy (`apiRequestBlocked`, on the normalised path) and every v1 handler
 * (`authenticateApiKey`, the docs and openapi.json routes, the export route), so a proxy bypass alone does not reach
 * the API. Reads the typed accessor (03-01); an environment the schema refuses keeps the API off (fail closed).
 */
export function apiV1Enabled(): boolean {
  try {
    const env = serverEnv();
    return env.API_V1_ENABLED && env.NODE_ENV !== "production" && !isDeployTier(env.APP_ENV);
  } catch {
    return false;
  }
}

/** True for `/api/v1` and every path below it (exact, already-normalised pathname). */
export function isApiV1Path(pathname: string): boolean {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

const MAX_DECODE_ROUNDS = 5;

/**
 * Percent-decodes `pathname` until it is stable (double and triple encoding included). Returns null when a round
 * cannot be decoded (malformed `%`) or the path is still changing after MAX_DECODE_ROUNDS rounds.
 */
export function fullyDecodePath(pathname: string): string | null {
  let current = pathname;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    if (!current.includes("%")) return current;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return current.includes("%") ? null : current;
}

/**
 * The route a request path could reach once Next (or anything after it) decodes and tidies it: fully decoded,
 * backslashes as `/`, repeated slashes collapsed, `.`/`..` segments resolved, trailing slash dropped, lower case.
 * Null when the path cannot be decoded.
 */
export function normaliseRequestPath(pathname: string): string | null {
  const decoded = fullyDecodePath(pathname);
  if (decoded === null) return null;
  const out: string[] = [];
  for (const segment of decoded.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `/${out.join("/")}`.toLowerCase();
}

/**
 * AR2-H2: true when the middleware must answer 404 before anything else runs.
 * - Any `/api` path (raw or normalised, any letter case) that cannot be decoded, or that still contains `%` or a
 *   backslash after decoding: no legitimate API route has either, and Next decodes paths when matching app routes
 *   (`/api/v%31/patients` reaches `/api/v1/patients`).
 * - Any path whose normalised form is under `/api/v1` while the API is off (`/api%2Fv1/...`, `/API/v1`, `/api/v1/`).
 */
export function apiRequestBlocked(pathname: string): boolean {
  const normalised = normaliseRequestPath(pathname);
  const rawLower = pathname.toLowerCase();
  const underApi = (p: string) => p === "/api" || p.startsWith("/api/") || p.startsWith("/api%") || p.startsWith("/api\\");

  if (normalised === null) {
    return underApi(rawLower);
  }
  if (underApi(rawLower) || underApi(normalised)) {
    const decoded = fullyDecodePath(pathname) ?? "";
    if (decoded.includes("%") || decoded.includes("\\")) return true;
  }
  return isApiV1Path(normalised) && !apiV1Enabled();
}

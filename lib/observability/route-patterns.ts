import { SERVER_ROUTE_PATTERNS } from "./server-routes";

/** Written for a path no page or route handler of the app answers (a 404): never the concrete path. */
export const UNMATCHED_ROUTE = "/_not-found";

interface Compiled {
  pattern: string;
  segments: string[];
  statics: number;
  catchAll: boolean;
}

const COMPILED: Compiled[] = SERVER_ROUTE_PATTERNS.map((pattern) => {
  const segments = pattern === "/" ? [] : pattern.slice(1).split("/");
  return {
    pattern,
    segments,
    statics: segments.filter((s) => !s.startsWith("[")).length,
    catchAll: segments.some((s) => s.startsWith("[...") || s.startsWith("[[...")),
  };
});

function matches(entry: Compiled, parts: string[]): boolean {
  for (let i = 0; i < entry.segments.length; i++) {
    const seg = entry.segments[i]!;
    if (seg.startsWith("[...") || seg.startsWith("[[...")) return parts.length > i || seg.startsWith("[[...");
    const part = parts[i];
    if (part === undefined) return false;
    if (!seg.startsWith("[") && seg !== part) return false;
  }
  return entry.catchAll || entry.segments.length === parts.length;
}

/**
 * The route pattern the app has for a concrete request path (`/patients/<uuid>` → `/patients/[id]`), or
 * {@link UNMATCHED_ROUTE}. Only patterns of the generated list are ever returned, so a segment of the path (an id, a token, a
 * phone number) can never reach a log line. Static segments win over dynamic ones.
 */
export function routePatternOfPath(pathname: string): string {
  const parts = pathname.split("/").filter((p) => p.length > 0);
  let best: Compiled | null = null;
  for (const entry of COMPILED) {
    if (!matches(entry, parts)) continue;
    if (best === null || entry.statics > best.statics) best = entry;
  }
  return best?.pattern ?? UNMATCHED_ROUTE;
}

/** Whether `value` is one of the app's own route patterns (the reader of the forwarded header). */
export function isKnownRoutePattern(value: unknown): value is string {
  return typeof value === "string" && (value === UNMATCHED_ROUTE || (SERVER_ROUTE_PATTERNS as readonly string[]).includes(value));
}

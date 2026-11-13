/**
 * A log-safe tag for an error: its code (database errors) or class name, never its message (V2-03 03-09a/03-09c).
 * Isomorphic and dependency-free so both the server logger (`lib/log`) and `reportClientError` can use it.
 */
export function errorTag(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    if (err instanceof Error) return err.name;
  }
  return "unknown";
}

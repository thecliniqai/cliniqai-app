/**
 * Client-side error reporting (V2-03 03-09a, ruling R-29). Browser error capture is V2-06; until then a client
 * component reports through this function instead of `console.*`.
 *
 * Development: one `console.warn` with the event and the error's log-safe tag (code or class name, never its message).
 * Production build: a no-op. `NODE_ENV` is inlined by the bundler at build time; it is the only environment value read.
 */
import { errorTag } from "@/lib/errors/client-message";

export function reportClientError(event: `${string}.${string}`, err: unknown): void {
  if (process.env.NODE_ENV !== "development") return;
  console.warn(`[${event}]`, errorTag(err));
}

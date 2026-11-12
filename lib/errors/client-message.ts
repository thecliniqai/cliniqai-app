import { PermissionDeniedError } from "@/lib/permissions";
import { log, type LogFields } from "@/lib/log";
import { errorTag } from "./error-tag";

export { errorTag };

/**
 * The message a service may return to the client for an unexpected error (IR-L1/L2, AD-7). Only a permission
 * refusal keeps its own (fixed, data-free) text; anything else, including Supabase/PostgREST and Postgres errors whose
 * text can carry row data, becomes `fallback`. When `logEvent` is given, the server log gets one line with that event
 * and the error's code or class name (`errorTag`), never its message (V2-03 03-09c).
 */
export function clientErrorMessage(err: unknown, fallback: string, logEvent?: LogFields["event"]): string {
  if (err instanceof PermissionDeniedError) return err.message;
  if (logEvent) log.error({ event: logEvent, code: errorTag(err) });
  return fallback;
}

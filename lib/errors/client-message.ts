import { PermissionDeniedError } from "@/lib/permissions";

/**
 * The message a service may return to the client for an unexpected error (IR-L1/L2, AD-7). Only a permission
 * refusal keeps its own (fixed, data-free) text; anything else, including Supabase/PostgREST and Postgres errors whose
 * text can carry row data, becomes `fallback`. The server log gets the error name or code, never its message.
 */
export function clientErrorMessage(err: unknown, fallback: string, logTag?: string): string {
  if (err instanceof PermissionDeniedError) return err.message;
  if (logTag) console.error(`[${logTag}]`, errorTag(err));
  return fallback;
}

/** A log-safe tag for an error: its code (database errors) or name, never its message. */
export function errorTag(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    if (err instanceof Error) return err.name;
  }
  return "unknown";
}

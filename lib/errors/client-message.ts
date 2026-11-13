import { PermissionDeniedError } from "@/lib/permissions";
import { log, type LogFields } from "@/lib/log";
import { errorTag } from "./error-tag";

export { errorTag };

/**
 * The message a service may return to the client for an unexpected error (IR-L1/L2, AD-7). Only a permission
 * refusal and the session refusals below keep their own (fixed, data-free) text; anything else, including Supabase/PostgREST and Postgres errors whose
 * text can carry row data, becomes `fallback`. When `logEvent` is given, the server log gets one line with that event
 * and the error's code or class name (`errorTag`), never its message (V2-03 03-09c).
 */
/**
 * Session refusals `lib/auth/tenant.ts` throws, by error identity → their fixed text (03-13d M-ERRMSG): a caller with
 * no session or no clinic must still be told so, never get the generic fallback. Matched by class name or the exact
 * fixed message, and answered with the text here, so no other error's message can pass through.
 */
const SESSION_REFUSALS: ReadonlyArray<{ matches: (err: Error) => boolean; text: string }> = [
  { matches: (err) => err.message === "Unauthenticated", text: "Unauthenticated" },
  { matches: (err) => err.name === "NoClinicMembershipError", text: "Your account is not linked to a clinic yet" },
  {
    matches: (err) => err.name === "MultipleClinicsSelectionRequiredError",
    text: "Multiple clinics found. Please select an active clinic.",
  },
];

export function clientErrorMessage(err: unknown, fallback: string, logEvent?: LogFields["event"]): string {
  if (err instanceof PermissionDeniedError) return err.message;
  if (err instanceof Error) {
    const refusal = SESSION_REFUSALS.find((r) => r.matches(err));
    if (refusal) return refusal.text;
  }
  if (logEvent) log.error({ event: logEvent, code: errorTag(err) });
  return fallback;
}

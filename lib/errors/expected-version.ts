import { z } from "zod";
import { appError, type AppError } from "./app-error";

/**
 * 09E-14a (E): the row version a queue, billing or scheduling action takes is required at run time, not only by its TypeScript type: a client that leaves it out, sends
 * a string or a negative or fractional number would otherwise skip the stale-write check (`versionArg` treats a missing one as "none known", which is for the system and
 * API callers that reach the services directly). Checked after the session, the permission and the tenant, before any read or write.
 */
const expectedVersionSchema = z.number().int().nonnegative().safe();

export const EXPECTED_VERSION_MESSAGE = "This screen is out of date. Refresh and try again.";

/** The refusal for a missing or malformed expected version; null when it is a non-negative whole number. */
export function expectedVersionError(version: unknown): AppError | null {
  return expectedVersionSchema.safeParse(version).success ? null : appError("VALIDATION_FAILED", { message: EXPECTED_VERSION_MESSAGE, reason: "EXPECTED_VERSION_REQUIRED" });
}

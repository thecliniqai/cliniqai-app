import { z } from "zod";
import { isYmd } from "@/lib/datetime";

// Guards for values that are interpolated into PostgREST filter strings (`.or(...)`). supabase-js passes the
// whole string through as filter syntax, so a caller-supplied value there must be validated first (V2-01 R7).

const uuidSchema = z.string().uuid();

/** True when `value` is a UUID (any version), the only shape an id may take inside a filter string. */
export function isUuid(value: unknown): value is string {
  return uuidSchema.safeParse(value).success;
}

/** True when `value` is a calendar date in `YYYY-MM-DD` form (the format every date-scoped query uses). */
export function isDateOnly(value: unknown): value is string {
  return isYmd(value);
}

/**
 * V2-14 14-02 (P2-06, SEC-20; Semgrep `postgrest-or-interpolation`): a date or an ISO-8601 instant as `/api/v1` list
 * filters take it (`2026-11-28`, `2026-11-28T09:30:00Z`, `2026-11-28T09:30:00.000+05:30`). Only digits, `-`, `:`, `.`,
 * `T`, `Z` and `+` can appear, so no PostgREST filter syntax (`,` `(` `)`) survives, and the value must be a real date.
 */
const ISO_FILTER = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

export function isIsoDateParam(value: unknown): value is string {
  return typeof value === "string" && ISO_FILTER.test(value) && isYmd(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
}

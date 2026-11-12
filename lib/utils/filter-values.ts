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
